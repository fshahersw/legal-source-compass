/**
 * Second currency route for limitations sources whose official host does not answer the review environment.
 *
 * For every source the direct recheck could not read, this script looks up the sections the dependent rules
 * pinpoint in the publisher's current text as landed by the full-code intake (reviewed states only, projection
 * on) and re-matches the literal passages the release relies on (rule excerpt, period words, tolling text).
 *
 *   found every passage  -> confirmed_evidence_intact, route "official_code_capture", intake provenance attached
 *   nothing quoted       -> changed_no_evidence_tracked when the publisher still prints the titled section
 *   no exact section     -> left to the direct result (not_rechecked)
 *   passage(s) missing   -> left to the direct result (not_rechecked) and listed for manual comparison;
 *                           this route never issues evidence_lost on its own because a section boundary or
 *                           parser difference, not an amendment, can hide a passage.
 *
 * Reads:   LIM_BUNDLE (rules.json, sources.json, text/), LIM_RECHECK (direct results)
 * Writes:  LIM_RECHECK_CODE (default /tmp/lim/recheck/results-code-capture.json)
 *          LIM_RECHECK_CODE_REVIEW (default /tmp/lim/recheck/code-capture-review.json)
 * Requires EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY (read-only public RPCs).
 *
 * Run from the project root: bun scripts/limitations/backfill/recheck-via-code-capture.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rpcPost } from "@/lib/external/rest.server";
import { publicStatuteSections } from "@/lib/law/stateCodeCatalog.server";
import type { LimitationRule, LimitationSource } from "@/lib/limitations/types";

const bundle = process.env["LIM_BUNDLE"] ?? "/tmp/lim/data/limitations";
const recheckFile = process.env["LIM_RECHECK"] ?? "/tmp/lim/recheck/results.json";
const outFile = process.env["LIM_RECHECK_CODE"] ?? "/tmp/lim/recheck/results-code-capture.json";
const reviewFile =
  process.env["LIM_RECHECK_CODE_REVIEW"] ?? "/tmp/lim/recheck/code-capture-review.json";

type DirectResult = {
  url: string;
  sourceIds: string[];
  checkedAt: string | null;
  status: string;
  http?: number;
  evidence?: { sourceId: string; ruleId: string; kind: string; found: boolean }[];
};
export type CodeCaptureResult = {
  url: string;
  sourceIds: string[];
  checkedAt: string;
  status:
    | "changed_evidence_intact"
    | "changed_no_evidence_tracked"
    | "code_capture_no_section"
    | "code_capture_passage_missing";
  route: "official_code_capture";
  evidence: {
    sourceId: string;
    ruleId: string;
    kind: string;
    found: boolean;
    nativeId: string | null;
    matchMode?: MatchMode;
  }[];
  codeCapture: {
    jurisdiction: string;
    publisher: string;
    runId: string | null;
    manifestSha256: string | null;
    landedAt: string | null;
    sectionNativeIds: string[];
    sourceUrls: string[];
  };
  citationsTried: string[];
};

const USABLE_DIRECT = new Set([
  "unchanged",
  "changed_evidence_intact",
  "changed_evidence_lost",
  "changed_no_evidence_tracked",
]);

const readJson = (file: string) => JSON.parse(readFileSync(join(bundle, file), "utf8"));
const rules = (readJson("rules.json").rules as LimitationRule[]).filter((r) => r.provenance);
const sources = readJson("sources.json").sources as LimitationSource[];
const direct: DirectResult[] = existsSync(recheckFile)
  ? JSON.parse(readFileSync(recheckFile, "utf8"))
  : [];
const directBySource = new Map(direct.flatMap((r) => r.sourceIds.map((id) => [id, r] as const)));

/** Same normalisation family as the direct recheck: whitespace, quotes, dashes, soft hyphens, case. */
function norm(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00a7\s*/g, "§ ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Letters and digits only. A literal match in this form tolerates punctuation, spacing, markdown markers and
 * hyphenation artifacts between two captures of the same words, never different words.
 */
const alnum = (text: string) => text.replace(/[^a-z0-9]+/g, "");

/**
 * Capture artifacts that the original extraction can leave inside a quoted passage and that are not statutory
 * words: printed PDF page headers and the target URL of an in-text cross-reference link.
 */
const CAPTURE_ARTIFACTS = [/\butah code page \d+\b/g, /https?:\/\/\S+/g];

/**
 * The section locator an official page prints before the body, which the full-code intake stores as separate
 * fields: `5-219.`, `§ 55-2-6.`, `ic 34-11-2-4`, `sec. 52-597.`, `nrs 11.207`, `413.140`, `893.55(1m)(a)`.
 */
const SECTION_PREFIX = /^(?:§\s*|[a-z]{1,4}\.?\s*)?\d[\w.:-]*(?:\(\w+\))*\s*[.:]?\s*/;

export type MatchMode =
  | "exact"
  | "alnum"
  | "alnum_without_section_prefix"
  | "alnum_without_capture_artifact";

/** Whether a quoted passage is literally present in the current official text, and in which form. */
function passagePresent(body: string, needle: string): MatchMode | null {
  if (body.includes(needle)) return "exact";
  const bodyA = alnum(body);
  if (bodyA.includes(alnum(needle))) return "alnum";
  const withoutPrefix = needle.replace(SECTION_PREFIX, "");
  if (withoutPrefix !== needle && withoutPrefix.length >= 20 && bodyA.includes(alnum(withoutPrefix)))
    return "alnum_without_section_prefix";
  let stripped = needle;
  for (const re of CAPTURE_ARTIFACTS) stripped = stripped.replace(re, " ");
  if (stripped !== needle) {
    if (bodyA.includes(alnum(stripped))) return "alnum_without_capture_artifact";
    const both = stripped.replace(SECTION_PREFIX, "");
    if (both !== stripped && both.length >= 20 && bodyA.includes(alnum(both)))
      return "alnum_without_capture_artifact";
  }
  return null;
}

const storedText = new Map<string, string>();
function textOf(id: string): string | null {
  if (!storedText.has(id)) {
    const file = join(bundle, "text", `${id}.txt`);
    storedText.set(id, existsSync(file) ? norm(readFileSync(file, "utf8")) : "");
  }
  return storedText.get(id) || null;
}

/** Rules whose literal evidence is drawn from this source, with each needle (same matcher as build-release). */
function needlesFor(source: LimitationSource): { rule: LimitationRule; kind: string; text: string }[] {
  const haystack = textOf(source.id);
  if (!haystack) return [];
  const out: { rule: LimitationRule; kind: string; text: string }[] = [];
  for (const rule of rules) {
    if (!rule.sourceIds.includes(source.id)) continue;
    const p = rule.provenance!;
    const needles: [string, string][] = [
      ["excerpt", p.excerpt],
      ["period", p.periodEvidence],
      ...p.tolling.map((t) => ["tolling", t.text] as [string, string]),
    ];
    for (const [kind, text] of needles) {
      const n = norm(text);
      if (n.length < 8) continue;
      if (haystack.includes(n)) out.push({ rule, kind, text: n });
    }
  }
  return out;
}

type CoverageRow = {
  jurisdiction?: string;
  publisher?: string;
  last_run?: string | null;
  manifest_sha256?: string | null;
  last_run_finished_at?: string | null;
  public_projection_allowed?: boolean;
  review_status?: string;
};
async function coverage(): Promise<Map<string, CoverageRow>> {
  const payload = await rpcPost<{ states?: CoverageRow[] }>("corpus_publisher_code_coverage_v2", {
    p_recount: false,
  });
  const map = new Map<string, CoverageRow>();
  for (const row of payload.states ?? []) {
    const state = row.jurisdiction?.toUpperCase();
    // A state can carry a second, still-open acquisition row; keep the reviewed one.
    if (state && (!map.has(state) || row.public_projection_allowed === true)) map.set(state, row);
  }
  return map;
}

const sectionCache = new Map<string, Awaited<ReturnType<typeof publicStatuteSections>>>();
async function sectionsFor(state: string, citation: string) {
  const key = `${state}|${citation}`;
  if (!sectionCache.has(key)) {
    try {
      sectionCache.set(key, await publicStatuteSections(state, citation));
    } catch (error) {
      console.error(`section lookup failed for ${key}: ${String(error)}`);
      sectionCache.set(key, []);
    }
  }
  return sectionCache.get(key)!;
}

async function main() {
  const cov = await coverage();
  const checkedAt = new Date().toISOString();
  const results: CodeCaptureResult[] = [];
  const review: Record<string, unknown>[] = [];
  const skipped: Record<string, number> = {};
  const bump = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1);

  const candidates = sources.filter((s) => {
    const d = directBySource.get(s.id);
    if (d && USABLE_DIRECT.has(d.status)) return false;
    if (s.authorityKind !== "statute") {
      bump(`not_statute:${s.authorityKind}`);
      return false;
    }
    const row = cov.get(s.state.toUpperCase());
    if (!row || row.public_projection_allowed !== true) {
      bump(`state_not_projected:${s.state}`);
      return false;
    }
    return true;
  });
  console.log(`candidates ${candidates.length}`);

  // Group by URL like the direct pass (several source ids can share one page).
  const byUrl = new Map<string, LimitationSource[]>();
  for (const s of candidates) byUrl.set(s.url, [...(byUrl.get(s.url) ?? []), s]);

  let n = 0;
  for (const [url, group] of byUrl) {
    n++;
    const state = group[0]!.state.toUpperCase();
    const row = cov.get(state)!;
    const evidence: CodeCaptureResult["evidence"] = [];
    const nativeIds = new Set<string>();
    const urls = new Set<string>();
    const tried = new Set<string>();
    let anySection = false;
    let anyNeedle = false;
    for (const source of group) {
      const needles = needlesFor(source);
      if (!needles.length) {
        // No rule quotes this source literally: record only whether the publisher still prints the section
        // the source is titled after, so the roll-up can say "section still printed; no passage compared".
        tried.add(source.title);
        for (const section of await sectionsFor(state, source.title)) {
          anySection = true;
          nativeIds.add(section.nativeId);
          if (section.sourceUrl) urls.add(section.sourceUrl);
        }
        continue;
      }
      anyNeedle = true;
      for (const { rule, kind, text } of needles) {
        const citations = [rule.pinpoint, rule.provenance!.citation].filter(
          (c): c is string => typeof c === "string" && c.trim().length > 0,
        );
        let mode: MatchMode | null = null;
        let hitId: string | null = null;
        for (const citation of [...new Set(citations)]) {
          tried.add(citation);
          const sections = await sectionsFor(state, citation);
          for (const section of sections) {
            anySection = true;
            nativeIds.add(section.nativeId);
            if (section.sourceUrl) urls.add(section.sourceUrl);
            const body = norm(`${section.heading ?? ""}\n${section.text ?? ""}`);
            mode = passagePresent(body, text);
            if (mode) {
              hitId = section.nativeId;
              break;
            }
          }
          if (mode) break;
        }
        evidence.push({
          sourceId: source.id,
          ruleId: rule.id,
          kind,
          found: mode !== null,
          nativeId: hitId,
          ...(mode ? { matchMode: mode } : {}),
        });
      }
    }
    const status: CodeCaptureResult["status"] = !anySection
      ? "code_capture_no_section"
      : !anyNeedle
        ? "changed_no_evidence_tracked"
        : evidence.length && evidence.every((e) => e.found)
          ? "changed_evidence_intact"
          : "code_capture_passage_missing";
    const result: CodeCaptureResult = {
      url,
      sourceIds: group.map((s) => s.id),
      checkedAt,
      status,
      route: "official_code_capture",
      evidence,
      codeCapture: {
        jurisdiction: state,
        publisher: row.publisher ?? "Not recorded",
        runId: row.last_run ?? null,
        manifestSha256: row.manifest_sha256 ?? null,
        landedAt: row.last_run_finished_at ? new Date(row.last_run_finished_at).toISOString() : null,
        sectionNativeIds: [...nativeIds],
        sourceUrls: [...urls],
      },
      citationsTried: [...tried],
    };
    results.push(result);
    if (status === "code_capture_passage_missing") {
      review.push({
        url,
        sourceIds: result.sourceIds,
        missing: evidence.filter((e) => !e.found).map((e) => ({ ruleId: e.ruleId, kind: e.kind })),
        sections: [...nativeIds],
        citationsTried: [...tried],
      });
    }
    if (n % 25 === 0) console.log(`${n}/${byUrl.size} ${status} ${url.slice(0, 80)}`);
  }

  const tally: Record<string, number> = {};
  for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
  writeFileSync(outFile, JSON.stringify(results, null, 1));
  writeFileSync(reviewFile, JSON.stringify(review, null, 1));
  console.log(JSON.stringify({ urls: byUrl.size, tally, skipped }, null, 1));
}

await main();
