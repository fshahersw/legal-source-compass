/**
 * Build the next limitations release from the live protected bundle plus (a) a currency recheck of every
 * official source and (b) new mechanically verified matrix entries. Output stays outside the repository;
 * publishing goes through scripts/admin/stage-limitations-release.mjs and the activation step.
 *
 * Usage: bun scripts/limitations/backfill/build-release.ts
 * Env:  LIM_BUNDLE   live limitations dir (rules/sources/coverage/case-references + text/)
 *       LIM_RECHECK  recheck results JSON from the currency pass (optional)
 *       LIM_RECHECK_CAPTURES  dir with <sourceId>.{raw,txt,json} fresh copies (optional)
 *       LIM_RECHECK_CODE   code-capture recheck results (recheck-via-code-capture.ts, optional)
 *       LIM_RECHECK_PROXY  proxied recheck results (recheck-via-proxy.ts, optional)
 *       LIM_RECHECK_PROXY_CAPTURES  dir with <sourceId>.{raw,txt,json} proxied fresh copies (optional)
 *       LIM_WORK     entries/<st>.json, captures/<ST>/<id>.{json,txt,raw}, time/<st>.json (optional)
 *       LIM_OUT      output dir
 *       LIM_SNAPSHOT_DATE, LIM_RULE_SEQ
 *
 * Invariants: no rule is silently changed. A rule whose literal evidence disappeared from the official page
 * stops computing; a page that changed around intact evidence is recorded on the rule; a cell with an
 * existing rule and a different period is reported as a discrepancy and left alone.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import {
  checkEntry,
  checkTimeRule,
  containsLiteral,
  type MatrixEntryInput,
  type TimeRuleInput,
} from "../../../src/lib/limitations/backfill/entries";
import { matchPassage } from "../../../src/lib/limitations/backfill/passageMatch";
import {
  isIntermediaryOnlyCapture,
  ruleFromEntry,
  type EntryCaptureMeta,
} from "../../../src/lib/limitations/backfill/entryRule";
import { gradeRule, ruleFingerprint } from "../../../src/lib/limitations/backfill/grades";
import { claimCoverageFor } from "../../../src/lib/limitations/backfill/cellCoverage";
import {
  applyCorrections,
  type CorrectionInput,
} from "../../../src/lib/limitations/backfill/corrections";
import {
  applyEvidenceAttachments,
  type EvidenceAttachmentInput,
} from "../../../src/lib/limitations/backfill/attachments";
import {
  CLAIM_LABELS,
  CLAIM_TYPES,
  type ClaimCoverage,
  type ClaimType,
  type CoverageRow,
  type LimitationRule,
  type LimitationSource,
  type LimitationsSnapshot,
  type RuleCurrency,
  type SourceCurrency,
} from "../../../src/lib/limitations/types";
import { validateLimitationsSnapshot } from "../../../src/lib/limitations/validation";

const bundle = process.env["LIM_BUNDLE"] ?? "/tmp/lim/data/limitations";
const recheckFile = process.env["LIM_RECHECK"] ?? "/tmp/lim/recheck/results.json";
const recheckCaptures = process.env["LIM_RECHECK_CAPTURES"] ?? "/tmp/lim/recheck/captures";
const work = process.env["LIM_WORK"] ?? "/tmp/lim/work";
const out = process.env["LIM_OUT"] ?? "/tmp/lim/out/limitations";
const snapshotDate = process.env["LIM_SNAPSHOT_DATE"] ?? "2026-10-08";
const ruleVersion = `${snapshotDate}.${process.env["LIM_RULE_SEQ"] ?? "1"}`;
const idStamp = snapshotDate.replaceAll("-", "");
const sha = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");

const readJson = (file: string) => JSON.parse(readFileSync(join(bundle, file), "utf8"));
const rulesDoc = readJson("rules.json");
const sourcesDoc = readJson("sources.json");
const coverageDoc = readJson("coverage.json");
const casesDoc = readJson("case-references.json");
const previousVersion: string = rulesDoc.ruleVersion;

const rules: LimitationRule[] = rulesDoc.rules as LimitationRule[];
const sources: LimitationSource[] = sourcesDoc.sources as LimitationSource[];
const sourceById = new Map(sources.map((s) => [s.id, s]));
const previousFingerprint = new Map(rules.map((r) => [r.id, ruleFingerprint(r)]));
const previousVerification = new Map(rules.map((r) => [r.id, r.verification]));
const storedText = new Map<string, string>();
const newTexts = new Map<string, string>();
const textOf = (id: string) => {
  if (newTexts.has(id)) return newTexts.get(id)!;
  if (!storedText.has(id))
    storedText.set(id, readFileSync(join(bundle, "text", `${id}.txt`), "utf8"));
  return storedText.get(id)!;
};
const report: Record<string, unknown> = { previousVersion, ruleVersion, snapshotDate };
const discrepancies: Record<string, unknown>[] = [];
const rejected: { state: string; claim: string; reason: string }[] = [];

// ---------------------------------------------------------------------------------------------------------
// 1. Currency: which sources carry each rule's literal evidence, and what the fresh official copy showed.
// ---------------------------------------------------------------------------------------------------------
type RecheckResult = {
  url: string;
  sourceIds: string[];
  checkedAt: string | null;
  status: string;
  http?: number;
  rawSha256?: string;
  textSha256?: string;
  textBytes?: number;
  error?: string;
  probe?: string;
  evidence?: { sourceId: string; ruleId: string; kind: string; found: boolean; matchMode?: string }[];
  sameRaw?: boolean;
  sameText?: boolean;
  /** Disclosure appended to the verdict (browser engine used, automated check completed, plain-HTTP read…). */
  note?: string;
  /** Composite sources only (recheck-direct-browser.py --composite): the component source ids compared. */
  components?: string[];
  componentsNotIdentical?: string[];
  /** Composite sources only: what the concatenation holds beyond the named components (never quoted by a rule). */
  componentsNote?: string;
};
const recheck: RecheckResult[] = existsSync(recheckFile)
  ? JSON.parse(readFileSync(recheckFile, "utf8"))
  : [];
const recheckByUrl = new Map(recheck.flatMap((r) => r.sourceIds.map((id) => [id, r] as const)));
const checkedAt = recheck[0]?.checkedAt ?? `${snapshotDate}T00:00:00.000Z`;

/** Source ids that literally contain each evidence string of a rule (same matcher as the entry checks). */
function evidenceSources(rule: LimitationRule): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const p = rule.provenance;
  if (!p) return found;
  const needles: [string, string][] = [
    ["excerpt", p.excerpt],
    ["period", p.periodEvidence],
    ...p.tolling.map((t) => ["tolling", t.text] as [string, string]),
  ];
  for (const sid of rule.sourceIds) {
    if (!sourceById.has(sid) || (!newTexts.has(sid) && !existsSync(join(bundle, "text", `${sid}.txt`)))) continue;
    const text = textOf(sid);
    const kinds = needles.filter(([, n]) => containsLiteral(text, n)).map(([k]) => k);
    if (kinds.length) found.set(sid, kinds);
  }
  return found;
}

/**
 * Whether a source's retained text came from a direct read of the page (as opposed to a proxy's or an
 * extraction service's rendering). Only then does a differing fresh text say anything about the page itself;
 * two renderings of one unchanged page routinely differ.
 */
const originalWasDirect = (s: LimitationSource): boolean =>
  s.fetchRoute?.kind === "direct" || (!s.fetchRoute && !/extraction|intermediary|proxied|proxy/i.test(s.method));

const describeUnavailable = (r: RecheckResult) => {
  if (r.status === "unreachable_from_workspace")
    return `Official host did not answer from the review environment (${r.probe ?? "connection blocked"}); the retained capture stands.`;
  if (r.status === "access_blocked_cloudflare")
    return "Official host returned an access-control block page (HTTP 403); not bypassed; the retained capture stands.";
  if (r.status === "gated_publisher_not_attempted")
    return "Publisher terms gate; no recheck attempted; the retained capture stands.";
  if (r.status === "js_shell_or_empty")
    return "Direct response was an empty or script-only shell; the retained capture stands.";
  if (r.status === "redirected_to_secondary")
    return "Request redirected to a non-official host; not used; the retained capture stands.";
  if (r.status === "fetch_error")
    return `Connection failed (${(r.error ?? "").split(":")[0]}); the retained capture stands.`;
  if (r.status.startsWith("http_"))
    return `Official host answered HTTP ${r.http}; the retained capture stands.`;
  return `Recheck did not yield a usable copy (${r.status}); the retained capture stands.`;
};

// Second route: the publisher's current section text as landed by the full-code intake, used only where the
// direct fetch yielded nothing (see recheck-via-code-capture.ts). It never issues evidence_lost on its own.
type CodeCaptureRecheck = RecheckResult & {
  route: "official_code_capture";
  codeCapture: NonNullable<SourceCurrency["codeCapture"]>;
  evidence?: { sourceId: string; ruleId: string; kind: string; found: boolean; matchMode?: string }[];
};
const codeRecheckFile = process.env["LIM_RECHECK_CODE"] ?? "/tmp/lim/recheck/results-code-capture.json";
const codeRecheck: CodeCaptureRecheck[] = existsSync(codeRecheckFile)
  ? JSON.parse(readFileSync(codeRecheckFile, "utf8"))
  : [];
const codeRecheckBySource = new Map(
  codeRecheck.flatMap((r) => r.sourceIds.map((id) => [id, r] as const)),
);
const CODE_CAPTURE_USABLE = new Set(["changed_evidence_intact", "changed_no_evidence_tracked"]);

// Third route: the same official URL fetched through a proxy (see recheck-via-proxy.ts).
type ProxyRecheck = {
  url: string;
  sourceIds: string[];
  checkedAt: string;
  status: "proxied_evidence_intact" | "proxied_no_evidence_tracked" | "proxied_passage_missing" | "proxy_failed";
  route: "proxied";
  proxy: string;
  rawSha256?: string;
  textSha256?: string;
  http?: number;
  evidence: { sourceId: string; ruleId: string; kind: string; found: boolean; matchMode?: string }[];
};
const proxyRecheckFile = process.env["LIM_RECHECK_PROXY"] ?? "/tmp/lim/recheck/results-proxy.json";
const proxyRecheckCaptures = process.env["LIM_RECHECK_PROXY_CAPTURES"] ?? "/tmp/lim/recheck/captures-proxy";
const proxyRecheck: ProxyRecheck[] = existsSync(proxyRecheckFile)
  ? JSON.parse(readFileSync(proxyRecheckFile, "utf8"))
  : [];
const proxyRecheckBySource = new Map(
  proxyRecheck.flatMap((r) => r.sourceIds.map((id) => [id, r] as const)),
);
const PROXY_USABLE = new Set(["proxied_evidence_intact", "proxied_no_evidence_tracked"]);
/**
 * Release text files are bounded by the staging script (16 MiB per object). A fresh re-read larger than
 * this (for example North Dakota's whole-code JSON) is kept only as its content-addressed raw capture; the
 * source's currency detail says so instead of projecting an oversized text file.
 */
const FRESH_TEXT_MAX_BYTES = 15 * 1024 * 1024;
const oversizedFresh = new Set<string>();

const sourceCurrency = new Map<string, SourceCurrency>();
const codeCaptureConfirmed = new Set<string>();
const proxyConfirmed = new Set<string>();
const proxyReviewed = new Set<string>();
/**
 * Sources not rechecked in this run keep the currency the previous release recorded for them (same
 * checkedAt, status, route and detail). A build that adds entries without a new recheck pass must never
 * downgrade last round's confirmed sources to "not_rechecked".
 */
const carriedForward = new Set<string>();
let freshTextFiles = 0;
for (const s of sources) {
  const r = recheckByUrl.get(s.id);
  const usable = ["unchanged", "changed_evidence_intact", "changed_evidence_lost", "changed_no_evidence_tracked"];
  if (!r || !usable.includes(r.status)) {
    const cc = codeRecheckBySource.get(s.id);
    if (cc && CODE_CAPTURE_USABLE.has(cc.status) && cc.evidence?.every((e) => e.sourceId !== s.id || e.found)) {
      const mine = (cc.evidence ?? []).filter((e) => e.sourceId === s.id);
      const when = cc.checkedAt ?? checkedAt;
      const landed = cc.codeCapture.landedAt ? cc.codeCapture.landedAt.slice(0, 10) : "an unrecorded date";
      const run = cc.codeCapture.runId ? ` (intake run ${cc.codeCapture.runId})` : "";
      sourceCurrency.set(s.id, {
        checkedAt: when,
        status: "confirmed_evidence_intact",
        route: "official_code_capture",
        detail:
          mine.length > 0
            ? `The official page did not answer the review environment, so on ${when.slice(0, 10)} the ${mine.length} quoted passage(s) relied on from this source were matched against the publisher's current text for ${cc.codeCapture.sectionNativeIds.join(", ")} as landed by the full-code intake on ${landed}${run}; every passage is still present. This confirms the passages, not the whole page.`
            : `The official page did not answer the review environment; no rule quotes this source literally. On ${when.slice(0, 10)} the publisher's current code, as landed by the full-code intake on ${landed}${run}, still printed ${cc.codeCapture.sectionNativeIds.join(", ")}. No passage was compared.`,
        codeCapture: cc.codeCapture,
      });
      codeCaptureConfirmed.add(s.id);
      continue;
    }
    // Third route: the same official URL re-read through a fetch proxy (recheck-via-proxy.ts). Used only
    // where neither the direct fetch nor the code capture produced a verdict, and never to issue evidence_lost.
    const pr = proxyRecheckBySource.get(s.id);
    const otherwiseUnchecked = !s.currency || s.currency.status === "not_rechecked";
    if (pr && otherwiseUnchecked) {
      const when = pr.checkedAt;
      const day = when.slice(0, 10);
      const mine = pr.evidence.filter((e) => e.sourceId === s.id);
      const missing = mine.filter((e) => !e.found);
      const freshTxt = join(proxyRecheckCaptures, `${s.id}.txt`);
      const retainFresh = () => {
        if (!existsSync(freshTxt)) return undefined;
        if (statSync(freshTxt).size > FRESH_TEXT_MAX_BYTES) {
          oversizedFresh.add(s.id);
          return undefined;
        }
        const id = `${s.id}.rechecked-${day}`;
        newTexts.set(id, readFileSync(freshTxt, "utf8"));
        freshTextFiles++;
        return `/data/limitations/text/${id}.txt`;
      };
      const oversizedNote = () =>
        oversizedFresh.has(s.id)
          ? ` The proxied text (${(statSync(freshTxt).size / 1048576).toFixed(1)} MiB) exceeds the release text bound, so it is retained only as the raw capture named here, not as a release text file.`
          : "";
      if (PROXY_USABLE.has(pr.status) && missing.length === 0 && pr.rawSha256) {
        const freshTextPath = retainFresh();
        sourceCurrency.set(s.id, {
          checkedAt: when,
          status: "confirmed_evidence_intact",
          route: "proxied",
          httpStatus: 200,
          rawSha256: pr.rawSha256,
          ...(pr.textSha256 ? { textSha256: pr.textSha256 } : {}),
          rawStorageKey: `limitations-raw-captures/sha256/${pr.rawSha256.slice(0, 2)}/${pr.rawSha256}.bin`,
          ...(freshTextPath ? { freshTextPath } : {}),
          detail:
            mine.length > 0
              ? `The official host did not answer the review environment directly, so on ${day} the same official URL was re-read through a fetch proxy (${pr.proxy}); the proxy's response is retained byte-for-byte and its text was compared: every quoted passage relied on from this source (${mine.length}) is still present${
                  mine.some((e) => e.matchMode === "spacing_normalized")
                    ? ` (${mine.filter((e) => e.matchMode === "spacing_normalized").length} matched after normalising spaces around punctuation and line-break hyphens, which the extractor renders differently)`
                    : ""
                }. This confirms the passages in an extracted copy, not the publisher's own bytes.${oversizedNote()}`
              : `The official host did not answer the review environment directly, so on ${day} the same official URL was re-read through a fetch proxy (${pr.proxy}); the response is retained. No rule quotes this source literally, so no passage was compared.${oversizedNote()}`,
        });
        proxyConfirmed.add(s.id);
        continue;
      }
      const prior = s.currency?.detail ?? "Not included in the direct recheck pass; the retained capture stands.";
      const freshTextPath = pr.status === "proxied_passage_missing" ? retainFresh() : undefined;
      sourceCurrency.set(s.id, {
        checkedAt: when,
        status: "not_rechecked",
        route: "none",
        ...(freshTextPath ? { freshTextPath } : {}),
        detail:
          pr.status === "proxied_passage_missing"
            ? `${prior} A proxied re-read on ${day} (${pr.proxy}) returned the page, but its extracted text did not reproduce ${missing.length} of ${mine.length} quoted passage(s) verbatim, so no verdict is drawn from it; the proxied text is retained for manual comparison.${oversizedNote()}`
            : `${prior} A proxied re-read on ${day} (${pr.proxy}) also yielded no usable copy${pr.http && pr.http !== 200 ? ` (HTTP ${pr.http})` : ""}.`,
      });
      proxyReviewed.add(s.id);
      continue;
    }
  }
  if (!r) {
    if (s.currency) {
      sourceCurrency.set(s.id, s.currency);
      carriedForward.add(s.id);
      continue;
    }
    sourceCurrency.set(s.id, {
      checkedAt,
      status: "not_rechecked",
      route: "none",
      detail: "Not included in the recheck pass; the retained capture stands.",
    });
    continue;
  }
  if (!usable.includes(r.status)) {
    if (r.status.startsWith("composite_")) {
      // Settled in the composite pass below, once every component's own verdict for this build is known.
      sourceCurrency.set(
        s.id,
        s.currency ?? { checkedAt, status: "not_rechecked", route: "none", detail: "Not included in the recheck pass; the retained capture stands." },
      );
      continue;
    }
    const cc = codeRecheckBySource.get(s.id);
    const suffix =
      cc?.status === "code_capture_passage_missing"
        ? " The publisher's current code text (full-code intake) was also consulted but did not reproduce every quoted passage verbatim, so no verdict is drawn from it; compare manually."
        : cc?.status === "code_capture_no_section"
          ? " The publisher's current code text (full-code intake) was also consulted but names no exact section for this source."
          : "";
    // A renewed attempt on a source already recorded as not re-read is appended to that record, so the
    // earlier routes tried (and the proxy's outcome) stay visible; a passage the fresh copy did not
    // reproduce is a review item, never a verdict.
    const prior = s.currency?.status === "not_rechecked" ? s.currency.detail : undefined;
    const day = (r.checkedAt ?? checkedAt).slice(0, 10);
    const attempt =
      r.status === "browser_passage_missing_review"
        ? `A further direct read on ${day} returned the page, but its text did not reproduce ${(r.evidence ?? []).filter((e) => e.sourceId === s.id && !e.found).length} of ${(r.evidence ?? []).filter((e) => e.sourceId === s.id).length} quoted passage(s) verbatim, so no verdict is drawn from it; the fresh text is retained for manual comparison.`
        : `A further direct read on ${day}: ${describeUnavailable(r).replace(/; the retained capture stands\.$/, "").replace(/^./, (c) => c.toLowerCase())}.`;
    let freshTextPath: string | undefined;
    if (r.status === "browser_passage_missing_review") {
      const freshTxt = join(recheckCaptures, `${s.id}.txt`);
      if (existsSync(freshTxt) && statSync(freshTxt).size <= FRESH_TEXT_MAX_BYTES) {
        const id = `${s.id}.rechecked-${day}`;
        newTexts.set(id, readFileSync(freshTxt, "utf8"));
        freshTextPath = `/data/limitations/text/${id}.txt`;
        freshTextFiles++;
      }
    }
    sourceCurrency.set(s.id, {
      checkedAt: r.checkedAt ?? checkedAt,
      status: "not_rechecked",
      route: "none",
      detail: prior ? `${prior} ${attempt}` : describeUnavailable(r) + suffix,
      ...(r.http ? { httpStatus: r.http } : {}),
      ...(freshTextPath ? { freshTextPath } : {}),
    });
    continue;
  }
  const mine = (r.evidence ?? []).filter((e) => e.sourceId === s.id);
  const lost = mine.filter((e) => !e.found);
  const when = r.checkedAt ?? checkedAt;
  const rawKey = r.rawSha256
    ? `limitations-raw-captures/sha256/${r.rawSha256.slice(0, 2)}/${r.rawSha256}.bin`
    : undefined;
  const base = {
    checkedAt: when,
    route: "direct" as const,
    ...(r.http !== undefined ? { httpStatus: r.http } : {}),
    ...(r.rawSha256 ? { rawSha256: r.rawSha256 } : {}),
    ...(r.textSha256 ? { textSha256: r.textSha256 } : {}),
    ...(rawKey ? { rawStorageKey: rawKey } : {}),
  };
  if (lost.length) {
    sourceCurrency.set(s.id, {
      ...base,
      status: "evidence_lost",
      detail: `Fresh official copy (${when.slice(0, 10)}) no longer contains ${lost.length} quoted passage(s) relied on by ${[...new Set(lost.map((e) => e.ruleId))].length} rule(s); the retained capture is kept for the record and affected rules stop computing.`,
    });
  } else if (r.sameRaw || r.sameText || r.status === "unchanged") {
    sourceCurrency.set(s.id, {
      ...base,
      status: "confirmed_unchanged",
      detail: `Fresh official copy (${when.slice(0, 10)}) is byte- or text-identical to the retained capture.`,
    });
  } else {
    const spaced = mine.filter((e) => e.matchMode === "spacing_normalized").length;
    const direct = originalWasDirect(s);
    const differs = direct
      ? "differs from the retained capture"
      : "differs from the retained text, which came through an extraction service rather than a direct read, so the difference does not by itself show that the page changed";
    sourceCurrency.set(s.id, {
      ...base,
      status: "confirmed_evidence_intact",
      detail:
        mine.length > 0
          ? `Fresh official copy (${when.slice(0, 10)}) ${differs}, but every quoted passage relied on from this source (${mine.length}) is still present${
              spaced ? ` (${spaced} matched after normalising spaces around punctuation and line-break hyphens, which the two renderings place differently)` : ""
            }. ${direct ? "The page may have changed elsewhere; the" : "The"} fresh text is retained for comparison.`
          : `Fresh official copy (${when.slice(0, 10)}) ${differs}; no rule quotes this source literally, so ${direct ? "the change" : "the difference"} is recorded without a rule effect.`,
    });
  }
  if (r.note) sourceCurrency.get(s.id)!.detail += ` ${r.note}`;
  // Keep the fresh text for changed pages so a reviewer can diff them in the app.
  const freshTxt = join(recheckCaptures, `${s.id}.txt`);
  if (!(r.sameRaw || r.sameText) && existsSync(freshTxt) && statSync(freshTxt).size <= FRESH_TEXT_MAX_BYTES) {
    const id = `${s.id}.rechecked-${when.slice(0, 10)}`;
    newTexts.set(id, readFileSync(freshTxt, "utf8"));
    sourceCurrency.get(s.id)!.freshTextPath = `/data/limitations/text/${id}.txt`;
    freshTextFiles++;
  }
}
/**
 * Composite sources: a builder-made verbatim concatenation of other sources' official pages is never fetched
 * on its own. Its verdict is derived, in this build, from its components: when every component's own direct
 * re-read is text-identical to its retained capture and every passage quoted from the concatenation is present
 * in those components, the composite is confirmed on the direct route and names the components. Anything less
 * leaves it not re-read. A composite verdict carried forward from an earlier release is re-derived the same way.
 */
const compositeDerived = new Set<string>();
for (const s of sources) {
  const r = recheckByUrl.get(s.id);
  const prior = s.currency;
  const components = r?.status.startsWith("composite_") ? (r.components ?? []) : (prior?.componentSourceIds ?? []);
  if (!components.length) continue;
  const when = r?.checkedAt ?? prior?.checkedAt ?? checkedAt;
  const day = when.slice(0, 10);
  const notIdentical = components.filter((c) => sourceCurrency.get(c)?.status !== "confirmed_unchanged");
  const unknown = components.filter((c) => !sourceById.has(c));
  const mine = (r?.evidence ?? []).filter((e) => e.sourceId === s.id);
  const missing = mine.filter((e) => !e.found);
  const labels = components.map((c) => sourceById.get(c)?.title?.replace(/\.$/, "") ?? c);
  if (r && r.status === "composite_components_confirmed" && !notIdentical.length && !unknown.length && !missing.length) {
    const componentDay = [...new Set(components.map((c) => sourceCurrency.get(c)!.checkedAt.slice(0, 10)))].sort().join(", ");
    sourceCurrency.set(s.id, {
      checkedAt: when,
      status: "confirmed_evidence_intact",
      route: "direct",
      componentSourceIds: components,
      detail: `This source is a builder-made verbatim concatenation of official pages that are also captured separately; it was not fetched again on its own. ${components.length} component page(s) (${labels.join("; ")}) were each re-read directly on ${componentDay} and found text-identical to their retained captures, and ${
        mine.length ? `every one of the ${mine.length} passage(s) quoted from this concatenation is present verbatim in those components` : "no rule quotes this concatenation literally"
      }.${r.componentsNote ? ` ${r.componentsNote}` : ""} Verdict derived on ${day}; it confirms the quoted passages, not the concatenation as a whole.`,
    });
    compositeDerived.add(s.id);
    continue;
  }
  if (!r && prior?.componentSourceIds?.length) {
    // Carried forward: keep it only while every component is still text-identical in this build.
    if (!notIdentical.length) {
      sourceCurrency.set(s.id, prior);
      continue;
    }
    sourceCurrency.set(s.id, {
      checkedAt,
      status: "not_rechecked",
      route: "none",
      detail: `${prior.detail} In this release ${notIdentical.length} of those component page(s) (${notIdentical.join(", ")}) no longer carries a text-identical direct re-read, so the derived verdict is withdrawn and the retained capture stands.`,
    });
    continue;
  }
  if (r) {
    const base = prior?.status === "not_rechecked" ? prior.detail : "Recheck did not yield a usable copy (composite); the retained capture stands.";
    const why = unknown.length
      ? `${unknown.length} named component source(s) do not exist in the release`
      : notIdentical.length
        ? `${notIdentical.length} of its ${components.length} component page(s) (${notIdentical.join(", ")}) did not have a text-identical direct re-read in this build`
        : `${missing.length} of ${mine.length} quoted passage(s) were not found verbatim in the components' retained text`;
    sourceCurrency.set(s.id, {
      checkedAt: when,
      status: "not_rechecked",
      route: "none",
      detail: `${base} A derivation from its component pages was attempted on ${day} but not recorded: ${why}.`,
    });
  }
}
/**
 * Passage-level proxy comparison kept beside a page-level verdict that came another way. A rule whose quoted
 * passages were confirmed through the proxy must be able to point at the retained proxy response, even when
 * the source's own verdict is a direct re-read that compared no passage (or an older carried-forward one).
 * Status and route are untouched; the proxy can only add a retained copy, never a page-level claim.
 */
const passageRechecked = new Set<string>();
for (const s of sources) {
  const c = sourceCurrency.get(s.id)!;
  const pr = proxyRecheckBySource.get(s.id);
  if (c.route === "proxied" || !pr || pr.status !== "proxied_evidence_intact" || !pr.rawSha256) continue;
  const mine = pr.evidence.filter((e) => e.sourceId === s.id);
  if (!mine.length || mine.some((e) => !e.found)) continue;
  const day = pr.checkedAt.slice(0, 10);
  const freshTxt = join(proxyRecheckCaptures, `${s.id}.txt`);
  let freshTextPath: string | undefined;
  let oversized = "";
  if (existsSync(freshTxt) && statSync(freshTxt).size <= FRESH_TEXT_MAX_BYTES) {
    const id = `${s.id}.proxied-${day}`;
    newTexts.set(id, readFileSync(freshTxt, "utf8"));
    freshTextPath = `/data/limitations/text/${id}.txt`;
    freshTextFiles++;
  } else if (existsSync(freshTxt)) {
    oversizedFresh.add(s.id);
    oversized = ` The proxied text (${(statSync(freshTxt).size / 1048576).toFixed(1)} MiB) exceeds the release text bound, so it is retained only as the raw capture named here, not as a release text file.`;
  }
  const spaced = mine.filter((e) => e.matchMode === "spacing_normalized").length;
  c.passageRecheck = {
    checkedAt: pr.checkedAt,
    route: "proxied",
    proxy: pr.proxy,
    rawSha256: pr.rawSha256,
    ...(pr.textSha256 ? { textSha256: pr.textSha256 } : {}),
    rawStorageKey: `limitations-raw-captures/sha256/${pr.rawSha256.slice(0, 2)}/${pr.rawSha256}.bin`,
    ...(freshTextPath ? { freshTextPath } : {}),
    passages: mine.length,
    detail: `On ${day} the same official URL was also read through a fetch proxy (${pr.proxy}) so that the ${mine.length} quoted passage(s) relied on from this source could be compared; every one is present in the proxy's extracted text${
      spaced ? ` (${spaced} matched after normalising spaces around punctuation and line-break hyphens, which the extractor renders differently)` : ""
    }. The proxy's response is retained byte-for-byte.${oversized} This confirms the passages in an extracted copy and does not change the page-level verdict recorded above.`,
  };
  passageRechecked.add(s.id);
}
for (const s of sources) {
  const c = sourceCurrency.get(s.id)!;
  s.currency = c;
  if (c.status === "confirmed_unchanged" || c.status === "confirmed_evidence_intact")
    s.verifiedAt = c.checkedAt;
}



// ---------------------------------------------------------------------------------------------------------
// 2. New entries (gap cells, new claim types, corrections) from official captures with literal evidence.
// ---------------------------------------------------------------------------------------------------------
const capture = (state: string, id: string) => {
  const base = join(work, "captures", state, id);
  if (!existsSync(`${base}.json`)) return undefined;
  return {
    meta: JSON.parse(readFileSync(`${base}.json`, "utf8")) as EntryCaptureMeta,
    text: readFileSync(`${base}.txt`, "utf8"),
  };
};
const sourceIds = new Set(sources.map((s) => s.id));
function ensureSource(
  state: string,
  captureId: string,
  meta: EntryCaptureMeta,
  text: string,
  kind: LimitationSource["authorityKind"],
  citations: string[],
): string {
  if (meta.seededFrom) return meta.seededFrom;
  const id = `bf-${captureId}`;
  if (sourceIds.has(id)) {
    const existing = sourceById.get(id)!;
    if (kind === "statute") existing.authorityKind = "statute";
    return id;
  }
  const host = new URL(meta.url).hostname;
  const how = meta.intermediary
    ? `Text obtained through an extraction intermediary (${meta.extraction ?? "unspecified"}); not a direct HTTP response`
    : meta.rendered
      ? "Official page rendered in headless Chrome without login or terms acceptance; DOM text extracted"
      : "Direct HTTPS GET of the official page; HTML block text extraction (scripts/styles/head omitted) or PDF text extraction; no OCR";
  const source: LimitationSource = {
    id,
    state,
    title: citations.length ? citations.slice(0, 3).join("; ") : `Official capture ${captureId}`,
    publisher: host,
    url: meta.url,
    method: how,
    schemaVersion: "1.0.0",
    capturedAt: meta.retrievedAt,
    verifiedAt: meta.retrievedAt,
    textPath: `/data/limitations/text/${id}.txt`,
    sha256: meta.textSha256,
    byteLength: meta.textBytes,
    authorityKind: kind,
    validity: `Official page text as retrieved ${meta.retrievedAt.slice(0, 10)}. Period and quoted passages were mechanically matched to this text; current-law, case-law and transition review was not performed by this capture.`,
    historicalApplicability:
      "Version history is recorded only where the page itself shows a history note; otherwise Not recorded.",
    fetchRoute: meta.route
      ? { kind: "proxied", proxy: meta.route.proxy }
      : meta.intermediary
        ? { kind: "extraction" }
        : { kind: "direct" },
    rawCapture: {
      sha256: meta.rawSha256,
      byteLength: meta.rawBytes,
      contentType: meta.contentType || "text/html",
      retrievedAt: meta.retrievedAt,
      storageBucket: "corpus-originals",
      storageKey: `limitations-raw-captures/sha256/${meta.rawSha256.slice(0, 2)}/${meta.rawSha256}.bin`,
    },
    currency: {
      checkedAt: meta.retrievedAt,
      status: meta.route?.kind === "proxied" ? "confirmed_evidence_intact" : "confirmed_unchanged",
      route: meta.route?.kind === "proxied" ? "proxied" : "direct",
      ...(meta.route?.kind === "proxied"
        ? { rawStorageKey: `limitations-raw-captures/sha256/${meta.rawSha256.slice(0, 2)}/${meta.rawSha256}.bin` }
        : {}),
      detail: meta.route?.kind === "proxied"
        ? `Official page fetched through the ${meta.route.proxy} fetch proxy on ${meta.retrievedAt.slice(0, 10)} for this release, because the host did not answer the review environment directly; the proxy's response is the retained raw capture.`
        : meta.intermediary
          ? `Official page text obtained through an extraction intermediary (${meta.extraction ?? "unspecified"}) on ${meta.retrievedAt.slice(0, 10)} for this release.`
          : `Captured directly from the official host on ${meta.retrievedAt.slice(0, 10)} for this release.`,
      httpStatus: 200,
      rawSha256: meta.rawSha256,
      textSha256: meta.textSha256,
    },
  };
  sources.push(source);
  sourceById.set(id, source);
  sourceIds.add(id);
  sourceCurrency.set(id, source.currency!);
  newTexts.set(id, text);
  return id;
}

const key = (state: string, claim: string, variant: string) => `${state}|${claim}|${variant}`;
const notRecorded = new Map<string, string>();
const entryDir = join(work, "entries");
const entryFiles = existsSync(entryDir)
  ? readdirSync(entryDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
  : [];
const intermediaryOnly = new Map<string, boolean>();
let added = 0;
let replacedCount = 0;
const newRuleIds = new Set<string>();
for (const file of entryFiles) {
  const state = file.replace(".json", "").toUpperCase();
  const doc = JSON.parse(readFileSync(join(entryDir, file), "utf8")) as {
    entries: (MatrixEntryInput & { supersedes?: { ruleId: string; reason: string } })[];
  };
  for (const entry of doc.entries) {
    const variant = entry.variant ?? "general";
    const k = key(state, entry.claimType, variant);
    const errs = checkEntry(state, entry, (id) => capture(state, id)).filter(
      (p) => p.level === "error",
    );
    if (errs.length) {
      rejected.push({ state, claim: `${entry.claimType}/${variant}`, reason: errs[0]!.message });
      continue;
    }
    if (entry.status === "not_recorded") {
      if (variant === "general") notRecorded.set(k, entry.notRecordedReason ?? "Not recorded");
      continue;
    }
    const primary = capture(state, entry.captureId)!;
    const primaryId = ensureSource(state, entry.captureId, primary.meta, primary.text, "statute", [
      entry.citation,
    ]);
    const crossIds = (entry.crossChecks ?? []).map((c) => {
      const cc = capture(state, c.captureId)!;
      const courtPage = /court|judicial/i.test(new URL(cc.meta.url).hostname);
      return ensureSource(
        state,
        c.captureId,
        cc.meta,
        cc.text,
        courtPage ? "publisher_guidance" : "statute",
        [`Cross-check: ${c.note}`.slice(0, 160)],
      );
    });
    const existing = rules.filter(
      (r) =>
        r.jurisdiction === state &&
        r.claimType === entry.claimType &&
        (r.subtype ?? "general") === variant &&
        r.ruleKind === "limitations",
    );
    const current =
      existing.find((r) => r.computation === "baseline_only") ?? existing.find((r) => r.period);
    let replaced: LimitationRule | null = null;
    if (current) {
      const samePeriod =
        current.period &&
        current.period.amount === entry.period!.amount &&
        ["calendar_years", "calendar_months", "calendar_days"][
          ["years", "months", "days"].indexOf(entry.period!.unit)
        ] === current.period.unit;
      const supersedes = entry.supersedes?.ruleId === current.id ? entry.supersedes : undefined;
      if (!samePeriod && !supersedes) {
        discrepancies.push({
          cell: k,
          existingRuleId: current.id,
          existingPeriod: current.period,
          existingPinpoint: current.pinpoint,
          entryPeriod: entry.period,
          entryCitation: entry.citation,
          entryStatus: entry.status,
          captureId: entry.captureId,
          note: "Existing production rule left unchanged; legal review required before either value is trusted.",
        });
        continue;
      }
      if (current.computation === "baseline_only" && current.provenance?.entryStatus === "verified" && !supersedes) {
        // Already a verified computing rule with the same period: nothing to replace.
        discrepancies.push({
          cell: k,
          existingRuleId: current.id,
          note: "Entry duplicates an existing verified rule with the same period; entry ignored.",
        });
        continue;
      }
      replaced = current;
      rules.splice(rules.indexOf(current), 1);
      replacedCount++;
      discrepancies.push({
        cell: k,
        replacedRuleId: current.id,
        replacedStatus: current.provenance?.entryStatus ?? current.computation,
        ...(supersedes ? { reason: supersedes.reason } : { reason: "Same period; flagged or research-only rule replaced by a verified entry." }),
      });
    }
    const built = ruleFromEntry({
      state,
      entry,
      primaryId,
      crossIds,
      primaryRetrievedAt: primary.meta.retrievedAt,
      ruleVersion,
      idStamp,
      replaced,
    });
    if ("rejected" in built) {
      rejected.push({ state, claim: `${entry.claimType}/${variant}`, reason: built.rejected });
      if (replaced) rules.push(replaced);
      continue;
    }
    rules.push(built.rule);
    newRuleIds.add(built.rule.id);
    intermediaryOnly.set(built.rule.id, isIntermediaryOnlyCapture(primary.meta));
    added++;
  }
}
report["entries"] = { files: entryFiles.length, added, replaced: replacedCount, rejected, discrepancies };

// ---------------------------------------------------------------------------------------------------------
// 2b. Correction ledger: reviewed field changes to released rules, each tied to a literal official passage.
//     A correction whose premise no longer holds (rule changed, quote gone) is rejected and reported, never
//     applied half-way. Applied corrections stay on the rule as `corrections[]` so the UI can show them.
// ---------------------------------------------------------------------------------------------------------
const correctionsFile = join(work, "corrections.json");
const correctionOutcomes = existsSync(correctionsFile)
  ? applyCorrections(rules, JSON.parse(readFileSync(correctionsFile, "utf8")) as CorrectionInput[], {
      ruleVersion,
      hasSource: (id) => sourceById.has(id),
      textOf: (id) => (newTexts.has(id) || existsSync(join(bundle, "text", `${id}.txt`)) ? textOf(id) : ""),
    })
  : [];
for (const o of correctionOutcomes)
  if (o.status === "rejected")
    rejected.push({ state: o.ruleId.slice(0, 2).toUpperCase(), claim: `correction:${o.field}`, reason: o.reason });
report["corrections"] = {
  applied: correctionOutcomes.filter((o) => o.status === "applied").length,
  rejected: correctionOutcomes.filter((o) => o.status === "rejected"),
  rules: [...new Set(correctionOutcomes.filter((o) => o.status === "applied").map((o) => o.ruleId))],
};

// ---------------------------------------------------------------------------------------------------------
// 2c. Evidence-attachment ledger: quoted official text for rules released before provenance was recorded.
//     Only rules without provenance qualify; quotes must be literal passages of the cited stored text and the
//     period words must state the rule's own period. Periods, dates and calculations are never touched.
// ---------------------------------------------------------------------------------------------------------
const attachmentsFile = join(work, "evidence-attachments.json");
const attachmentOutcomes = existsSync(attachmentsFile)
  ? applyEvidenceAttachments(
      rules,
      JSON.parse(readFileSync(attachmentsFile, "utf8")) as EvidenceAttachmentInput[],
      {
        ruleVersion,
        hasSource: (id) => sourceById.has(id),
        textOf: (id) =>
          newTexts.has(id) || existsSync(join(bundle, "text", `${id}.txt`)) ? textOf(id) : "",
        retrievedAtOf: (id) => {
          const s = sourceById.get(id);
          return s?.rawCapture?.retrievedAt ?? s?.capturedAt ?? null;
        },
      },
    )
  : [];
for (const o of attachmentOutcomes)
  if (o.status === "rejected")
    rejected.push({ state: o.ruleId.slice(0, 2).toUpperCase(), claim: "evidence-attachment", reason: o.reason });
report["evidenceAttachments"] = {
  applied: attachmentOutcomes.filter((o) => o.status === "applied").length,
  rejected: attachmentOutcomes.filter((o) => o.status === "rejected"),
  rules: attachmentOutcomes.filter((o) => o.status === "applied").map((o) => o.ruleId),
};

// Rule currency roll-up (existing and new rules alike).
const ruleCurrency = new Map<string, RuleCurrency>();
let withheldForLostEvidence = 0;
let pagesChangedAroundEvidence = 0;
/** Fresh text retained by a previous recheck for a page that changed around the evidence, if any. */
const freshTextFor = (sid: string): string | null => {
  const path = sourceCurrency.get(sid)?.freshTextPath;
  if (!path) return null;
  const id = path.replace(/^\/data\/limitations\/text\//, "").replace(/\.txt$/, "");
  return newTexts.has(id) || existsSync(join(bundle, "text", `${id}.txt`)) ? textOf(id) : null;
};
for (const rule of rules) {
  const ev = evidenceSources(rule);
  const ids = [...ev.keys()];
  if (!ids.length) continue;
  // Every evidence source untouched this run and a roll-up already recorded: the previous verdict stands.
  if (rule.currency && ids.every((sid) => carriedForward.has(sid))) {
    ruleCurrency.set(rule.id, rule.currency);
    continue;
  }
  const confirmed: string[] = [];
  const viaCode: string[] = [];
  const viaProxy: string[] = [];
  const viaComposite: string[] = [];
  const spacingOnly: string[] = [];
  const unchecked: string[] = [];
  const lost: string[] = [];
  let changedAround = false;
  for (const sid of ids) {
    const c = sourceCurrency.get(sid)!;
    if (carriedForward.has(sid)) {
      // Carried-forward source: reuse this rule's own previous verdict for it when one exists; a rule new
      // to this release (or newly carrying quoted text) is confirmed only where a retained or re-matched copy
      // settles it: page byte-identical, the fresh text of a changed page literally holds this rule's
      // passages, or this run's code-capture / proxied comparison matched every passage of this rule.
      const prev = rule.currency;
      if (prev?.lostSourceIds.includes(sid)) lost.push(sid);
      else if (prev?.confirmedSourceIds.includes(sid)) {
        confirmed.push(sid);
        if (c.route === "official_code_capture") viaCode.push(sid);
        else if (c.route === "proxied") viaProxy.push(sid);
      } else if (prev) unchecked.push(sid);
      else if (c.status === "confirmed_unchanged") confirmed.push(sid);
      else if (c.status === "confirmed_evidence_intact") {
        const p = rule.provenance!;
        const needles = [p.excerpt, p.periodEvidence, ...p.tolling.map((t) => t.text)];
        const fresh = c.route === "direct" ? freshTextFor(sid) : null;
        const cc = codeRecheckBySource.get(sid);
        const ccMine = (cc?.evidence ?? []).filter((e) => e.sourceId === sid && e.ruleId === rule.id);
        const pr = proxyRecheckBySource.get(sid);
        const prMine = (pr?.evidence ?? []).filter((e) => e.sourceId === sid && e.ruleId === rule.id);
        // Fresh direct copy: literal first; a match that differs only in spacing around punctuation or a
        // dash (two extractions of the same page) is accepted and disclosed, never a different word.
        const freshModes = fresh ? needles.map((n) => matchPassage(fresh, n)) : [];
        if (fresh && freshModes.every((m) => m !== null)) {
          confirmed.push(sid);
          if (originalWasDirect(sourceById.get(sid)!)) changedAround = true;
          if (freshModes.some((m) => m === "spacing_normalized")) spacingOnly.push(sid);
        } else if (c.route === "official_code_capture" && ccMine.length && ccMine.every((e) => e.found)) {
          confirmed.push(sid);
          viaCode.push(sid);
        } else if (prMine.length && prMine.every((e) => e.found) && pr?.rawSha256) {
          // The same official URL as read through the proxy this release (retained byte-for-byte) holds every
          // passage this rule quotes. Used where the direct copy could not be compared (not retained as text)
          // or the source itself was already proxied.
          confirmed.push(sid);
          viaProxy.push(sid);
        } else unchecked.push(sid);
      } else unchecked.push(sid);
      continue;
    }
    if (c.status === "evidence_lost") {
      const r = recheckByUrl.get(sid)!;
      const mine = (r.evidence ?? []).filter((e) => e.sourceId === sid && e.ruleId === rule.id);
      if (mine.some((e) => !e.found)) lost.push(sid);
      else confirmed.push(sid);
    } else if (c.status === "confirmed_unchanged") confirmed.push(sid);
    else if (c.status === "confirmed_evidence_intact" && c.route === "official_code_capture") {
      // The passages were matched in the publisher's current code text; the page itself was not compared.
      const cc = codeRecheckBySource.get(sid);
      const mine = (cc?.evidence ?? []).filter((e) => e.sourceId === sid && e.ruleId === rule.id);
      if (mine.length && mine.every((e) => e.found)) {
        confirmed.push(sid);
        viaCode.push(sid);
      } else unchecked.push(sid);
    } else if (c.status === "confirmed_evidence_intact" && c.route === "proxied") {
      // The passages were matched in a proxied extraction of the official page; whether the page changed
      // elsewhere is not judged from an extracted copy.
      const pr = proxyRecheckBySource.get(sid);
      if (!pr) {
        // Captured through the proxy for this release: the retained text is the current page as read.
        confirmed.push(sid);
        viaProxy.push(sid);
        continue;
      }
      const mine = pr.evidence.filter((e) => e.sourceId === sid && e.ruleId === rule.id);
      if (mine.length && mine.every((e) => e.found)) {
        confirmed.push(sid);
        viaProxy.push(sid);
      } else unchecked.push(sid);
    } else if (c.status === "confirmed_evidence_intact" && c.componentSourceIds?.length) {
      // A builder-made concatenation whose verdict is derived from its components' text-identical re-reads:
      // the passages are present in unchanged component pages, so nothing "changed around" them.
      const r = recheckByUrl.get(sid);
      const mine = (r?.evidence ?? []).filter((e) => e.sourceId === sid && e.ruleId === rule.id);
      if (mine.length && mine.every((e) => e.found)) {
        confirmed.push(sid);
        viaComposite.push(sid);
      } else unchecked.push(sid);
    } else if (c.status === "confirmed_evidence_intact") {
      confirmed.push(sid);
      // A fresh direct text that differs from a retained *extraction* says nothing about the page itself.
      if (originalWasDirect(sourceById.get(sid)!)) changedAround = true;
    } else unchecked.push(sid);
  }
  let status: RuleCurrency["status"];
  let detail: string;
  const day = checkedAt.slice(0, 10);
  const viaCodeNote =
    (viaCode.length
      ? ` For ${viaCode.join(", ")} the match was made against the publisher's current code text as landed by the full-code intake, because the page itself did not answer the review environment.`
      : "") +
    (viaProxy.length
      ? ` For ${viaProxy.join(", ")} the same official URL was read through a fetch proxy because the page could not be compared directly from the review environment; the passages were matched in the proxy's extracted text and the proxy's response is retained.`
      : "") +
    (spacingOnly.length
      ? ` For ${spacingOnly.join(", ")} the fresh copy prints the same words with different spacing around punctuation or a dash (the retained and fresh extractions differ only there); the match was made after normalising that spacing on both sides.`
      : "") +
    (viaComposite.length
      ? ` ${viaComposite.join(", ")} is a concatenation of official pages captured separately; its passages were confirmed in those component pages, each re-read directly and found text-identical, rather than by fetching the concatenation again.`
      : "");
  if (lost.length) {
    status = "evidence_lost";
    detail = `On ${day} the official page for ${lost.join(", ")} no longer contained the passage this rule quotes. The rule no longer computes until it is re-verified against the current text.`;
  } else if (!confirmed.length) {
    status = "not_rechecked";
    detail = `The official page(s) holding this rule's quoted text (${unchecked.join(", ")}) could not be re-read from the review environment on ${day}; the ${rule.provenance?.retrievedAt.slice(0, 10) ?? "original"} capture stands.`;
  } else if (unchecked.length || changedAround) {
    status = "partially_confirmed";
    detail =
      [
        `On ${day} the quoted text was found again on ${confirmed.join(", ")}.`,
        changedAround
          ? "At least one of those pages changed elsewhere since capture; compare the fresh text before relying on surrounding provisions."
          : "",
        unchecked.length ? `${unchecked.join(", ")} could not be re-read.` : "",
      ]
        .filter(Boolean)
        .join(" ") + viaCodeNote;
    if (changedAround) pagesChangedAroundEvidence++;
  } else {
    status = "confirmed";
    detail = `On ${day} every official text holding this rule's quoted passages (${confirmed.join(", ")}) still contained them.${viaCodeNote}`;
  }
  const currency: RuleCurrency = {
    checkedAt,
    status,
    detail,
    confirmedSourceIds: confirmed,
    uncheckedSourceIds: unchecked,
    lostSourceIds: lost,
  };
  rule.currency = currency;
  ruleCurrency.set(rule.id, currency);
  if (status === "evidence_lost" && rule.computation === "baseline_only") {
    rule.computation = "research_only";
    delete rule.calculation;
    rule.conditions = [
      ...rule.conditions,
      `Cannot issue a date: ${detail}`,
    ];
    withheldForLostEvidence++;
  } else if (changedAround) {
    const note = `Official page changed since capture (recheck ${day}): the quoted passage is unchanged, but other parts of the section may have been amended; compare the retained and fresh texts.`;
    if (!rule.conditions.includes(note)) rule.conditions = [...rule.conditions, note];
  }
}

report["currency"] = {
  sources: Object.fromEntries(
    ["confirmed_unchanged", "confirmed_evidence_intact", "evidence_lost", "not_rechecked"].map((k) => [
      k,
      sources.filter((s) => s.currency?.status === k).length,
    ]),
  ),
  rules: Object.fromEntries(
    ["confirmed", "partially_confirmed", "evidence_lost", "not_rechecked"].map((k) => [
      k,
      [...ruleCurrency.values()].filter((c) => c.status === k).length,
    ]),
  ),
  rulesWithoutLiteralEvidence: rules.filter((r) => !ruleCurrency.has(r.id)).length,
  withheldForLostEvidence,
  pagesChangedAroundEvidence,
  freshTextFiles,
  freshTextOversizedKeptAsRawOnly: [...oversizedFresh].sort(),
  routes: {
    direct: sources.filter((s) => s.currency?.route === "direct").length,
    official_code_capture: sources.filter((s) => s.currency?.route === "official_code_capture").length,
    proxied: sources.filter((s) => s.currency?.route === "proxied").length,
    proxiedReviewedStillUnchecked: proxyReviewed.size,
    passageRecheckedViaProxy: passageRechecked.size,
    compositeDerivedFromComponents: compositeDerived.size,
    carriedForward: carriedForward.size,
    none: sources.filter((s) => s.currency?.route === "none").length,
  },
};

// ---------------------------------------------------------------------------------------------------------
// 2d. Cross-reference links: tolling / repose notes resolved to the publisher's current section text
//     (link-cross-references.ts). A link never changes the note; it records where the cited section is held
//     and whether the note's periods and ages are printed there. Rules the ledger covers are relinked from it;
//     rules it does not mention keep the links they carried (their checkedAt says how old they are).
// ---------------------------------------------------------------------------------------------------------
const xrefFile = process.env["LIM_XREF_LINKS"] ?? join(work, "cross-reference-links.json");
type XrefLedgerRow = {
  ruleId: string;
  kind: "tolling" | "repose";
  index: number;
  citation: string;
  status:
    | "linked"
    | "no_exact_section"
    | "state_not_projected"
    | "no_statute_citation"
    | "section_repealed_or_stub"
    | "section_text_oversized";
  checkedAt: string;
  sectionsNamed: number;
  sections: { nativeId: string; textSha256: string; sourceUrl: string | null }[];
  stubsExcluded?: { nativeId: string; heading: string | null; text: string }[];
  termCheck: "all_present" | "not_all_present" | "none_to_check" | null;
  terms: { term: string; found: boolean; foundIn?: string }[];
  intakeRunId: string | null;
};
const xrefRows: XrefLedgerRow[] = existsSync(xrefFile)
  ? ((JSON.parse(readFileSync(xrefFile, "utf8")) as { links?: XrefLedgerRow[] }).links ?? [])
  : [];
const xrefByRule = new Map<string, XrefLedgerRow[]>();
for (const row of xrefRows) xrefByRule.set(row.ruleId, [...(xrefByRule.get(row.ruleId) ?? []), row]);
const xrefTally: Record<string, number> = {};
const xrefByState: Record<string, Record<string, number>> = {};
const xrefBump = (state: string, k: string) => {
  xrefTally[k] = (xrefTally[k] ?? 0) + 1;
  (xrefByState[state] ??= {})[k] = (xrefByState[state]![k] ?? 0) + 1;
};
const xrefReview: { ruleId: string; kind: string; citation: string; terms: { term: string; found: boolean }[] }[] = [];
let xrefCarried = 0;
let xrefRulesLinked = 0;
for (const rule of rules) {
  const rows = xrefByRule.get(rule.id);
  if (!rows) {
    if (rule.crossReferenceLinks?.length) xrefCarried += rule.crossReferenceLinks.length;
    continue;
  }
  const p = rule.provenance;
  const links: NonNullable<LimitationRule["crossReferenceLinks"]> = [];
  for (const row of rows) {
    const note = p?.[row.kind]?.[row.index];
    // The ledger was built from this bundle's notes; a note that moved or changed since is not linked.
    if (!note || note.citation !== row.citation) {
      xrefBump(rule.jurisdiction, "note_changed_since_ledger");
      continue;
    }
    if (row.status !== "linked" || !row.termCheck) {
      xrefBump(rule.jurisdiction, row.status);
      continue;
    }
    links.push({
      kind: row.kind,
      index: row.index,
      citation: row.citation,
      checkedAt: row.checkedAt,
      sectionsNamed: Math.max(row.sectionsNamed, row.sections.length),
      sections: row.sections.map((s) => ({ nativeId: s.nativeId, textSha256: s.textSha256 })),
      termCheck: row.termCheck,
      terms: row.terms.map((t) => (t.foundIn ? { term: t.term, found: t.found, foundIn: t.foundIn } : { term: t.term, found: t.found })),
      intakeRunId: row.intakeRunId,
    });
    xrefBump(rule.jurisdiction, `linked:${row.termCheck}`);
    if (row.termCheck === "not_all_present" || row.sections.length < row.sectionsNamed || row.stubsExcluded?.length)
      xrefReview.push({ ruleId: rule.id, kind: row.kind, citation: row.citation, terms: row.terms });
  }
  links.sort((a, b) => (a.kind === b.kind ? a.index - b.index : a.kind < b.kind ? -1 : 1));
  if (links.length) {
    rule.crossReferenceLinks = links;
    xrefRulesLinked++;
  } else delete rule.crossReferenceLinks;
}
report["crossReferences"] = {
  ledger: existsSync(xrefFile) ? xrefFile : null,
  notesInLedger: xrefRows.length,
  rulesLinked: xrefRulesLinked,
  linksCarriedForward: xrefCarried,
  tally: xrefTally,
  byState: xrefByState,
  review: xrefReview,
};

// ---------------------------------------------------------------------------------------------------------
// 3. Verification grades: unchanged rules keep theirs; new or changed rules are graded afresh (no verdicts).
// ---------------------------------------------------------------------------------------------------------
const sourceMap = new Map(sources.map((x) => [x.id, x]));
const isIntermediary = (id: string) =>
  /intermediar|firecrawl|tavily|webfetch/i.test(sourceMap.get(id)?.method ?? "");
const intermediaryOnlyRule = (rule: LimitationRule) => {
  if (intermediaryOnly.has(rule.id)) return intermediaryOnly.get(rule.id)!;
  const primary =
    rule.sourceIds.find((id) => sourceMap.get(id)?.authorityKind === "statute") ?? rule.sourceIds[0];
  if (!primary || !isIntermediary(primary)) return false;
  return !rule.sourceIds.some((id) => id !== primary && !isIntermediary(id));
};
let regraded = 0;
for (const rule of rules) {
  const fp = ruleFingerprint(rule);
  const prev = previousFingerprint.get(rule.id);
  const prevVerification = previousVerification.get(rule.id);
  if (prev === fp && prevVerification) {
    rule.verification = prevVerification;
    continue;
  }
  const graded = gradeRule({
    fingerprint: fp,
    previousFingerprint: prev ?? null,
    verdict: undefined,
    retry: undefined,
    verifiedRuleVersion: previousVersion,
    verifiedOn: snapshotDate,
    intermediaryOnly: intermediaryOnlyRule(rule),
  });
  rule.verification = graded.verification;
  if (prev && prev !== fp && prevVerification?.grade === "independently_verified")
    rule.verification = {
      ...graded.verification,
      basis: `${graded.verification.basis} Previously independently verified as rule version ${prevVerification.verifiedRuleVersion ?? previousVersion}${prevVerification.verifiedOn ? ` on ${prevVerification.verifiedOn}` : ""}; the change in this release is ${rule.currency?.status === "evidence_lost" ? "withdrawal of computation after the recheck" : rule.evidenceAttachment?.appliedInVersion === ruleVersion ? "the attachment of quoted official text (period, dates and calculation unchanged)" : "recorded in the release notes"}.`,
    };
  regraded++;
}
report["regraded"] = regraded;

// ---------------------------------------------------------------------------------------------------------
// 4. Time computation rules (weekend / holiday extension) from work/time.
// ---------------------------------------------------------------------------------------------------------
const timeRules = new Map<string, NonNullable<CoverageRow["timeComputation"]>>();
const timeNotRecorded = new Map<string, NonNullable<CoverageRow["timeComputationNotRecorded"]>>();
const timeDir = join(work, "time");
for (const file of existsSync(timeDir)
  ? readdirSync(timeDir).filter((f) => f.endsWith(".json"))
  : []) {
  const state = file.replace(".json", "").toUpperCase();
  const rule = JSON.parse(readFileSync(join(timeDir, file), "utf8")) as TimeRuleInput;
  const errs = checkTimeRule(state, rule, (id) => capture(state, id)).filter(
    (p) => p.level === "error",
  );
  if (errs.length) {
    rejected.push({ state, claim: "time_computation", reason: errs[0]!.message });
    continue;
  }
  if (rule.status === "not_recorded") {
    // A reviewed state with no recordable rule keeps the reason, so a weekend last day is never silent.
    timeNotRecorded.set(state, {
      reason: rule.notRecordedReason!.trim(),
      reviewedOn: new Date().toISOString(),
    });
    continue;
  }
  if (typeof rule.extendsWhenLastDayIsWeekend !== "boolean") continue;
  const cap = capture(state, rule.captureId)!;
  const sourceId = ensureSource(state, rule.captureId, cap.meta, cap.text, "statute", [
    rule.citation,
  ]);
  const supportingSourceIds = (rule.supporting ?? []).map((s) => {
    const sc = capture(state, s.captureId)!;
    return ensureSource(state, s.captureId, sc.meta, sc.text, "statute", [s.citation]);
  });
  timeRules.set(state, {
    status: rule.status as "verified" | "flagged",
    extendsWhenLastDayIsWeekend: rule.extendsWhenLastDayIsWeekend,
    extendsWhenLastDayIsHoliday: rule.extendsWhenLastDayIsHoliday ?? null,
    citation: rule.citation,
    excerpt: rule.excerpt,
    sourceId,
    ...(supportingSourceIds.length ? { supportingSourceIds } : {}),
    retrievedAt: cap.meta.retrievedAt,
    note: rule.flags?.length ? rule.flags.join("; ") : rule.confidenceNote,
  });
}

// ---------------------------------------------------------------------------------------------------------
// 5. Coverage rows for every claim type (including the ones added in this release).
// ---------------------------------------------------------------------------------------------------------
const labelFor = (c: ClaimType) => CLAIM_LABELS[c].toLowerCase();
const coverage: CoverageRow[] = (coverageDoc.coverage as CoverageRow[]).map((row) => {
  const stateSources = sources.filter((s) => s.state === row.state).map((s) => s.id);
  const stateRules = rules.filter((r) => r.jurisdiction === row.state);
  const baselineIds = stateRules.filter((r) => r.computation === "baseline_only").map((r) => r.id);
  const researchIds = stateRules.filter((r) => r.computation === "research_only").map((r) => r.id);
  const previousCells = new Map(
    (row.claimCoverage ?? []).map((c) => [c.claimType, c] as const),
  );
  const claimCoverage: ClaimCoverage[] = CLAIM_TYPES.map((claim) =>
    claimCoverageFor(
      stateRules,
      claim,
      notRecorded.get(key(row.state, claim, "general")) ??
        (previousCells.get(claim)?.status === "not_recorded"
          ? previousCells.get(claim)!.reason!
          : "No primary-source entry has been verified for this claim."),
    ),
  );
  const lacking = CLAIM_TYPES.filter(
    (c) => claimCoverage.find((x) => x.claimType === c)?.status !== "baseline",
  );
  const gaps = [
    ...row.gaps.filter(
      (g) =>
        !/no automatically computable reviewed baseline|Primary statutory text still needs retrieval/.test(
          g,
        ),
    ),
    ...(stateSources.length
      ? []
      : ["Primary statutory text still needs retrieval and claim-level verification."]),
    ...lacking.map((c) => `${labelFor(c)}: no automatically computable reviewed baseline.`),
  ];
  const previousTime = row.timeComputation;
  const { timeComputation: _t, timeComputationNotRecorded: previousNone, ...rest } = row;
  const time = timeRules.has(row.state)
    ? { timeComputation: timeRules.get(row.state)! }
    : previousTime
      ? { timeComputation: previousTime }
      : timeNotRecorded.has(row.state)
        ? { timeComputationNotRecorded: timeNotRecorded.get(row.state)! }
        : previousNone
          ? { timeComputationNotRecorded: previousNone }
          : {};
  return {
    ...rest,
    sourceStatus: stateSources.length ? "primary_text_retrieved" : "primary_text_pending",
    sourceIds: stateSources,
    baselineRuleIds: baselineIds,
    researchRuleIds: researchIds,
    coverage: baselineIds.length
      ? "conditional_baselines"
      : stateSources.length
        ? "research_only"
        : "pending",
    gaps,
    claimCoverage,
    ...time,
  };
});

// ---------------------------------------------------------------------------------------------------------
// 6. Validate, write, report.
// ---------------------------------------------------------------------------------------------------------
const files4 = {
  rules: { ...rulesDoc, snapshotDate, ruleVersion, rules },
  sources: { ...sourcesDoc, snapshotDate, sources },
  coverage: { ...coverageDoc, snapshotDate, coverage },
  cases: { ...casesDoc, snapshotDate },
};
const snapshot: LimitationsSnapshot = validateLimitationsSnapshot({
  rules: files4.rules,
  sources: files4.sources,
  coverage: files4.coverage,
  cases: files4.cases,
});
for (const s of snapshot.sources) {
  const path = join(bundle, "text", `${s.id}.txt`);
  const text = newTexts.get(s.id) ?? (existsSync(path) ? readFileSync(path, "utf8") : null);
  if (text === null) throw new Error(`missing text for ${s.id}`);
  if (sha(text) !== s.sha256) throw new Error(`text hash mismatch for ${s.id}`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "text"), { recursive: true });
mkdirSync(join(out, "opinion-text"), { recursive: true });
for (const dir of ["text", "opinion-text"])
  for (const f of readdirSync(join(bundle, dir))) copyFileSync(join(bundle, dir, f), join(out, dir, f));
for (const [id, text] of newTexts) writeFileSync(join(out, "text", `${id}.txt`), text);
for (const f of ["publisher-overrides.json", "rejected-captures.json"])
  if (existsSync(join(bundle, f))) copyFileSync(join(bundle, f), join(out, f));
writeFileSync(join(out, "rules.json"), `${JSON.stringify(files4.rules, null, 2)}\n`);
writeFileSync(join(out, "sources.json"), `${JSON.stringify(files4.sources, null, 2)}\n`);
writeFileSync(join(out, "coverage.json"), `${JSON.stringify(files4.coverage, null, 2)}\n`);
writeFileSync(join(out, "case-references.json"), `${JSON.stringify(files4.cases, null, 2)}\n`);
// The evidence-attachment ledger ships with the release so every attached quote stays reviewable and reversible.
if (existsSync(attachmentsFile))
  writeFileSync(
    join(out, "evidence-attachments-ledger.json"),
    `${JSON.stringify(
      {
        ruleVersion,
        ledger: JSON.parse(readFileSync(attachmentsFile, "utf8")),
        outcomes: attachmentOutcomes,
      },
      null,
      2,
    )}\n`,
  );
// The correction ledger ships with the release so every in-place change stays reviewable and reversible.
if (existsSync(correctionsFile))
  writeFileSync(
    join(out, "corrections-ledger.json"),
    `${JSON.stringify(
      {
        ruleVersion,
        ledger: JSON.parse(readFileSync(correctionsFile, "utf8")),
        outcomes: correctionOutcomes,
      },
      null,
      2,
    )}\n`,
  );

const cells = coverage.flatMap((c) => c.claimCoverage ?? []);
const tally = (s: string) => cells.filter((c) => c.status === s).length;
const grades: Record<string, number> = {};
for (const r of snapshot.rules)
  grades[r.verification?.grade ?? "none"] = (grades[r.verification?.grade ?? "none"] ?? 0) + 1;
report["totals"] = {
  rules: snapshot.rules.length,
  baselineRules: snapshot.rules.filter((r) => r.computation === "baseline_only").length,
  sources: snapshot.sources.length,
  cases: snapshot.cases.length,
  grades,
  cells: {
    baseline: tally("baseline"),
    research_only: tally("research_only"),
    flagged: tally("flagged"),
    not_recorded: tally("not_recorded"),
  },
  cellsByClaim: Object.fromEntries(
    CLAIM_TYPES.map((c) => [
      c,
      Object.fromEntries(
        ["baseline", "flagged", "research_only", "not_recorded"].map((s) => [
          s,
          cells.filter((x) => x.claimType === c && x.status === s).length,
        ]),
      ),
    ]),
  ),
  timeRules: coverage.filter((c) => c.timeComputation).length,
  timeRulesByStatus: {
    verified: coverage.filter((c) => c.timeComputation?.status === "verified").length,
    flagged: coverage.filter((c) => c.timeComputation?.status === "flagged").length,
    not_recorded: coverage.filter((c) => c.timeComputationNotRecorded).length,
    unreviewed: coverage.filter((c) => !c.timeComputation && !c.timeComputationNotRecorded).length,
  },
  newRuleIds: [...newRuleIds],
};
writeFileSync(join(out, "release-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report["totals"]));
console.log(JSON.stringify(report["currency"]));
console.log(JSON.stringify({ entries: report["entries"] }));
