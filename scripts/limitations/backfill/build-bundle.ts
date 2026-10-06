/**
 * Build an import-ready limitations bundle (rules/sources/coverage/case-references + text) from the existing
 * protected bundle plus mechanically verified backfill entries. Output stays outside the repository; publishing
 * goes through the private bundle pipeline with administrator credentials this script never touches.
 *
 * Usage: bun scripts/limitations/backfill/build-bundle.ts
 * Env: LIM_WORK (entries + captures), LIM_BUNDLE (current protected limitations dir), LIM_OUT (output dir),
 *      LIM_SNAPSHOT_DATE (default 2026-10-06)
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { addCivilPeriod, periodLabel } from "../../../src/lib/limitations/engine";
import {
  checkEntry,
  checkTimeRule,
  type CaptureMeta,
  type MatrixEntryInput,
  type TimeRuleInput,
} from "../../../src/lib/limitations/backfill/entries";
import {
  CLAIM_LABELS,
  CLAIM_TYPES,
  type ClaimCoverage,
  type ClaimType,
  type CoverageRow,
  type LimitationRule,
  type LimitationSource,
  type LimitationsSnapshot,
  type PeriodUnit,
  type RuleProvenance,
} from "../../../src/lib/limitations/types";
import { validateLimitationsSnapshot } from "../../../src/lib/limitations/validation";
import {
  gradeRule,
  ruleFingerprint,
  type RetryRecord,
  type VerdictRecord,
} from "../../../src/lib/limitations/backfill/grades";
import { claimCoverageFor } from "../../../src/lib/limitations/backfill/cellCoverage";

const work = process.env.LIM_WORK ?? "/tmp/lim/backfill";
const bundle = process.env.LIM_BUNDLE ?? "/tmp/lim/data/limitations";
const out = process.env.LIM_OUT ?? "/tmp/lim/out/limitations";
const snapshotDate = process.env.LIM_SNAPSHOT_DATE ?? "2026-10-06";
const ruleVersion = `${snapshotDate}.${process.env.LIM_RULE_SEQ ?? "2"}`;
const idStamp = snapshotDate.replaceAll("-", "");

const readJson = (file: string) => JSON.parse(readFileSync(join(bundle, file), "utf8"));
const rulesDoc = readJson("rules.json");
const sourcesDoc = readJson("sources.json");
const coverageDoc = readJson("coverage.json");
const casesDoc = readJson("case-references.json");

/** Production rules the independent verifier found wrong and whose content is carried by a corrected entry. */
const RETIRED_LEGACY_RULES = new Map([
  [
    "mn-repose-1-20261002",
    "ruleKind repose with a 3-year period; Minn. Stat. 573.02 subd. 1 gives a 3-year limitation after death and a 6-year cap from the act or omission, which the wrongful-death entry now carries.",
  ],
]);
const rules: LimitationRule[] = (rulesDoc.rules as LimitationRule[]).filter(
  (r) => !RETIRED_LEGACY_RULES.has(r.id),
);
const sources: LimitationSource[] = [...sourcesDoc.sources];
const sourceIds = new Set(sources.map((s) => s.id));
const newTexts: { id: string; text: string }[] = [];
const discrepancies: Record<string, unknown>[] = [];
const rejected: { state: string; claim: string; reason: string }[] = [];
const notRecorded = new Map<string, string>();
const flaggedCells = new Set<string>();

const UNIT: Record<string, PeriodUnit> = {
  years: "calendar_years",
  months: "calendar_months",
  days: "calendar_days",
};

const reposeTrigger = (text: string): "last_act_or_omission" | "act_or_omission" | null => {
  const t = text.toLowerCase();
  if (/last act/.test(t)) return "last_act_or_omission";
  if (
    /act or omission|act, omission|act or failure|date of the (act|omission)|act complained/.test(t)
  )
    return "act_or_omission";
  return null;
};

function ensureSource(
  state: string,
  captureId: string,
  meta: CaptureMeta & { seededFrom?: string; rendered?: boolean },
  text: string,
  kind: LimitationSource["authorityKind"],
  citations: string[],
): string {
  if (meta.seededFrom) return meta.seededFrom;
  const id = `bf-${captureId}`;
  if (sourceIds.has(id)) {
    const existing = sources.find((x) => x.id === id)!;
    if (kind === "statute") existing.authorityKind = "statute";
    return id;
  }
  const host = new URL(meta.url).hostname;
  const how = meta.intermediary
    ? `Text obtained through an extraction intermediary (${meta.extraction ?? "unspecified"}); not a direct HTTP response`
    : meta.rendered
      ? "Official page rendered in headless Chrome without login or terms acceptance; DOM text extracted"
      : "Direct HTTPS GET of the official page; HTML block text extraction (scripts/styles/head omitted) or PDF text extraction; no OCR";
  sources.push({
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
    validity: `Official page text as retrieved ${meta.retrievedAt.slice(0, 10)}. Period and quoted passages were mechanically matched to this text; current-law, case-law and transition review was not completed.`,
    historicalApplicability:
      "Version history is recorded only where the page itself shows a history note; otherwise Not recorded.",
    fetchRoute: (meta as { route?: { kind: "proxied"; proxy: string } }).route
      ? { kind: "proxied", proxy: (meta as { route: { proxy: string } }).route.proxy }
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
  });
  sourceIds.add(id);
  newTexts.push({ id, text });
  return id;
}

const capture = (state: string, id: string) => {
  const base = join(work, "captures", state, id);
  if (!existsSync(`${base}.json`)) return undefined;
  return {
    meta: JSON.parse(readFileSync(`${base}.json`, "utf8")) as CaptureMeta & {
      seededFrom?: string;
      rendered?: boolean;
    },
    text: readFileSync(`${base}.txt`, "utf8"),
  };
};

const key = (state: string, claim: string, variant: string) => `${state}|${claim}|${variant}`;
const entryDir = join(work, "entries");
const files = existsSync(entryDir)
  ? readdirSync(entryDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
  : [];
const entryRoute = new Map<string, boolean>();
let added = 0;
let upgraded = 0;
let attached = 0;

for (const file of files) {
  const state = file.replace(".json", "").toUpperCase();
  const doc = JSON.parse(readFileSync(join(entryDir, file), "utf8")) as {
    entries: MatrixEntryInput[];
  };
  for (const entry of doc.entries) {
    const variant = entry.variant ?? "general";
    const k = key(state, entry.claimType, variant);
    const problems = checkEntry(state, entry, (id) => capture(state, id));
    const errs = problems.filter((p) => p.level === "error");
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
    const unit = UNIT[entry.period!.unit]!;
    const provenance: RuleProvenance = {
      citation: entry.citation,
      excerpt: entry.excerpt,
      periodEvidence: entry.periodEvidence,
      accrualKind: entry.accrual.kind as RuleProvenance["accrualKind"],
      accrualText: entry.accrual.text?.trim() || "Not recorded",
      tolling: (entry.tolling ?? []).map((t) => ({ text: t.text, citation: t.citation })),
      repose: (entry.repose ?? []).map((r) => ({
        years: r.years,
        citation: r.citation,
        trigger: r.trigger,
        effectiveFrom: r.effectiveFrom,
      })),
      lastAmended: {
        text: entry.lastAmended?.text?.trim() || "Not recorded",
        date: entry.lastAmended?.date ?? null,
      },
      effectiveDate: entry.effectiveDate ?? null,
      retrievedAt: primary.meta.retrievedAt,
      entryStatus: entry.status as "verified" | "flagged",
      confidence: entry.confidence as RuleProvenance["confidence"],
      confidenceNote: entry.confidenceNote,
      flags: entry.flags ?? [],
      crossCheckSourceIds: [...new Set(crossIds)].filter((id) => id !== primaryId),
    };
    if (entry.status === "flagged") flaggedCells.add(k);
    // A third-party extraction, cached page or search snippet is a lower evidence route even when other
    // authorities (for example court opinions) are cross-checked; concatenations of direct captures are not.
    const entryIntermediaryOnly =
      Boolean(primary.meta.intermediary) &&
      /tavily|firecrawl|webfetch|web-fetch|websearch|search-engine|snippet|cached|proxied/i.test(
        String((primary.meta as { extraction?: string }).extraction ?? ""),
      );

    const repose = entry.repose ?? [];
    const trigger = repose.length === 1 ? reposeTrigger(repose[0]!.trigger) : null;
    const reposeModelled =
      repose.length === 1 && trigger !== null && repose[0]!.effectiveFrom !== null;
    const accrualOk = [
      "accrual",
      "discovery",
      "occurrence",
      "breach",
      "treatment_end",
      "other",
      "death",
      "not_recorded",
    ].includes(entry.accrual.kind);
    const baseline =
      entry.status === "verified" &&
      accrualOk &&
      (repose.length === 0 || (reposeModelled && entry.accrual.kind !== "death"));
    const existing = rules.filter(
      (r) =>
        r.jurisdiction === state &&
        r.claimType === entry.claimType &&
        (r.subtype ?? "general") === variant &&
        r.ruleKind === "limitations",
    );
    let replaced: LimitationRule | null = null;
    const current =
      existing.find((r) => r.computation === "baseline_only") ?? existing.find((r) => r.period);
    if (current) {
      const same =
        current.period &&
        current.period.amount === entry.period!.amount &&
        current.period.unit === unit;
      if (same) {
        entryRoute.set(current.id, entryIntermediaryOnly);
        if (!current.provenance) {
          current.provenance = provenance;
          if (entry.status === "verified") current.pinpoint = entry.citation;
          attached++;
        }
        const upgrade =
          current.computation === "research_only" &&
          baseline &&
          (current.subtype ?? "general") === "general" &&
          current.id.endsWith("20261002");
        if (!upgrade) continue;
        replaced = current;
        rules.splice(rules.indexOf(current), 1);
        upgraded++;
      } else {
        discrepancies.push({
          cell: k,
          existingRuleId: current.id,
          existingPeriod: current.period,
          existingPinpoint: current.pinpoint,
          entryPeriod: entry.period,
          entryCitation: entry.citation,
          entryStatus: entry.status,
          captureId: entry.captureId,
          note: "Existing production rule left unchanged; owner/legal review required before either value is trusted.",
        });
        continue;
      }
    }

    const notes = [
      entry.accrual.kind === "not_recorded"
        ? "The cited provision does not state when the claim accrues (Not recorded). The accrual date must be confirmed under controlling case law before relying on any date."
        : `Accrual under the cited rule: ${provenance.accrualText}`,
      ...(repose.length && !baseline
        ? repose.map(
            (r) =>
              `Statute of repose not computed here: ${r.years} years (${r.citation}); trigger: ${r.trigger}.`,
          )
        : []),
      ...provenance.tolling.map(
        (t) => `Statutory tolling (not applied by the calculator): ${t.text} (${t.citation}).`,
      ),
      ...(entry.blockers ?? []).map((b) => `Cannot issue a date: ${b.issue}. ${b.why}`),
      ...(entry.crossChecks ?? []).map(
        (c) => `Related provision or cross-check (capture ${c.captureId}): ${c.note}`,
      ),
      ...provenance.flags.map((f) => `Flag: ${f}`),
    ];
    const rule: LimitationRule = {
      id: `${state.toLowerCase()}-${entry.claimType}-${variant}-bf${idStamp}`.replaceAll("_", "-"),
      schemaVersion: "1.0.0",
      ruleVersion,
      jurisdiction: state,
      claimType: entry.claimType as ClaimType,
      ruleKind: "limitations",
      computation: baseline ? "baseline_only" : "research_only",
      reviewStatus: "statutory_text_verified",
      period: { amount: entry.period!.amount, unit },
      provenance,
      sourceIds: [...new Set([primaryId, ...crossIds, ...(replaced?.sourceIds ?? [])])],
      ...(replaced?.caseReferenceIds?.length
        ? { caseReferenceIds: replaced.caseReferenceIds }
        : {}),
      pinpoint: entry.citation,
      scope: `${CLAIM_LABELS[entry.claimType as ClaimType]}${variant === "general" ? "" : ` (${variant.replaceAll("_", " ")})`}: as stated in the cited provision; special statutory claims excluded.`,
      accrualBasis: entry.accrual.kind === "death" ? "death" : "confirmed_accrual",
      conditions: [...new Set([...notes, ...(replaced?.conditions ?? [])])],
      exclusions: [
        "Governmental defendants, special statutory claims and intentional / sexual-abuse claims unless the cited provision expressly covers them",
        "Unresolved minority, disability, concealment, tolling, class action, previous filing, service, borrowing or choice-of-law issues",
      ],
      effectiveFrom: entry.effectiveDate ?? null,
      effectiveThrough: null,
      validity:
        entry.status === "verified"
          ? "Statutory text verified against the official capture; no comprehensive operative-law or case-specific review completed"
          : "Recorded with open issues (see conditions); no date is issued from a flagged entry",
      historicalApplicability:
        provenance.lastAmended.text === "Not recorded"
          ? "Not recorded; historical amendments and transitional applicability must be confirmed"
          : `Official history note: ${provenance.lastAmended.text}`,
      summary: `${periodLabel({ amount: entry.period!.amount, unit })} statutory baseline (${entry.citation}), subject to the cited scope and exceptions.`,
      warnings: [
        "This is an unadjusted calendar anniversary, not a verified last day for filing.",
        "Court holidays, closure, commencement/service requirements and local filing cutoffs are not computed.",
      ],
      ...(variant === "general" ? {} : { subtype: variant }),
      ...(baseline && repose.length === 1
        ? {
            calculation: {
              mode: "accrual_repose_min" as const,
              reposeYears: repose[0]!.years,
              reposeTrigger: trigger!,
              reposeEffectiveFrom: repose[0]!.effectiveFrom!,
            },
          }
        : {}),
    };
    if (!addCivilPeriod("2000-06-15", rule.period!.amount, unit)) {
      rejected.push({
        state,
        claim: `${entry.claimType}/${variant}`,
        reason: "period not representable",
      });
      continue;
    }
    rules.push(rule);
    entryRoute.set(rule.id, entryIntermediaryOnly);
    added++;
  }
}

const unresolvedTime: string[] = [];
/** Rules corrected after the independent verifier's findings (id -> reason). */
const RETIRED_CASE_REFERENCES = new Map([
  [
    "ca-fox-2005",
    "The reference pointed to a Justia reproduction, which breaches the primary-source rule; the official opinion could not be retrieved from the California courts' archive (S121173 returns 404 on courts.ca.gov and www4.courts.ca.gov).",
  ],
]);
const caCrossRef = rules.find((r) => r.id === "ca-product_liability-general-review-20261002");
if (caCrossRef) {
  caCrossRef.caseReferenceIds = (caCrossRef.caseReferenceIds ?? []).filter(
    (id) => !RETIRED_CASE_REFERENCES.has(id),
  );
  if (!caCrossRef.caseReferenceIds.length) delete caCrossRef.caseReferenceIds;
  caCrossRef.pinpoint = "Cal. Code Civ. Proc. § 335.1";
  caCrossRef.conditions = [
    ...caCrossRef.conditions.filter((c) => !/^Discovery accrual:/.test(c)),
    "Discovery accrual: Not recorded (judicial rule; official opinion not retrievable). The two-year period is verified against § 335.1; the discovery rule is a court-made rule whose official opinion could not be retrieved, so the discovery dates must be confirmed under controlling case law.",
  ];
  if (caCrossRef.provenance) {
    caCrossRef.provenance.accrualText =
      "Not recorded (judicial rule; official opinion not retrievable)";
    caCrossRef.provenance.accrualKind = "other";
  }
}
const cases = (casesDoc.cases as { id: string }[]).filter(
  (c) => !RETIRED_CASE_REFERENCES.has(c.id),
);

// Verification grades from the independent verifier (rule .1 content) with a fingerprint carry-over check.
const readJsonMaybe = (path: string | undefined) =>
  path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
const verdictFile = readJsonMaybe(
  process.env.LIM_VERDICTS ??
    "/cursor/stores/self/internal/limitations-verification/verdicts-2026-10-06.1.json",
);
const retryFile = readJsonMaybe(
  process.env.LIM_VERDICTS_RETRY ??
    "/cursor/stores/self/internal/limitations-verification/verdicts-2026-10-06.1-retry.json",
);
const previousRules = readJsonMaybe(
  join(process.env.LIM_PREV_BUNDLE ?? "/tmp/lim/prev1/limitations", "rules.json"),
);
const verdictById = new Map<string, VerdictRecord>(
  (verdictFile?.rules ?? []).map((r: { ruleId: string } & VerdictRecord) => [r.ruleId, r]),
);
const retryById = new Map<string, RetryRecord>(
  (retryFile?.rules ?? []).map((r: { ruleId: string } & RetryRecord) => [r.ruleId, r]),
);
const previousFingerprint = new Map<string, string>(
  ((previousRules?.rules ?? []) as LimitationRule[]).map((r) => [r.id, ruleFingerprint(r)]),
);
const sourceMap = new Map(sources.map((x) => [x.id, x]));
void sourceMap;
const isIntermediary = (id: string) =>
  /intermediar|firecrawl|tavily|webfetch/i.test(sourceMap.get(id)?.method ?? "");
const intermediaryOnlyRule = (rule: LimitationRule) => {
  if (entryRoute.has(rule.id)) return entryRoute.get(rule.id)!;
  const primary =
    rule.sourceIds.find((id) => sourceMap.get(id)?.authorityKind === "statute") ??
    rule.sourceIds[0];
  if (!primary || !isIntermediary(primary)) return false;
  return !rule.sourceIds.some((id) => id !== primary && !isIntermediary(id));
};
const gradeCounts: Record<string, number> = {};
let withheld = 0;
for (const rule of rules) {
  const graded = gradeRule({
    fingerprint: ruleFingerprint(rule),
    previousFingerprint: previousFingerprint.get(rule.id) ?? null,
    verdict: verdictById.get(rule.id),
    retry: retryById.get(rule.id),
    verifiedRuleVersion: "2026-10-06.1",
    verifiedOn: "2026-10-06",
    intermediaryOnly: intermediaryOnlyRule(rule),
  });
  rule.verification = graded.verification;
  gradeCounts[graded.verification.grade] = (gradeCounts[graded.verification.grade] ?? 0) + 1;
  if (graded.withhold && rule.computation === "baseline_only") {
    rule.computation = "research_only";
    delete rule.calculation;
    rule.conditions = [
      ...rule.conditions,
      "Cannot issue a date: the independent verifier disputed this rule's content and it has not been corrected.",
    ];
    withheld++;
  }
}

const timeRules = new Map<string, NonNullable<CoverageRow["timeComputation"]>>();
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
  if (rule.status === "not_recorded" || typeof rule.extendsWhenLastDayIsWeekend !== "boolean")
    continue;
  const cap = capture(state, rule.captureId)!;
  const sourceId = ensureSource(state, rule.captureId, cap.meta, cap.text, "statute", [
    rule.citation,
  ]);
  timeRules.set(state, {
    status: rule.status as "verified" | "flagged",
    extendsWhenLastDayIsWeekend: rule.extendsWhenLastDayIsWeekend,
    extendsWhenLastDayIsHoliday: rule.extendsWhenLastDayIsHoliday ?? null,
    citation: rule.citation,
    excerpt: rule.excerpt,
    sourceId,
    retrievedAt: cap.meta.retrievedAt,
    note: rule.flags?.length ? rule.flags.join("; ") : rule.confidenceNote,
  });
}

const labelFor = (c: ClaimType) => CLAIM_LABELS[c].toLowerCase();
const coverage: CoverageRow[] = (coverageDoc.coverage as CoverageRow[]).map((row) => {
  const stateSources = sources.filter((s) => s.state === row.state).map((s) => s.id);
  const stateRules = rules.filter((r) => r.jurisdiction === row.state);
  const baselineIds = stateRules.filter((r) => r.computation === "baseline_only").map((r) => r.id);
  const researchIds = stateRules.filter((r) => r.computation === "research_only").map((r) => r.id);
  const claimCoverage: ClaimCoverage[] = CLAIM_TYPES.map((claim) =>
    claimCoverageFor(
      stateRules,
      claim,
      notRecorded.get(key(row.state, claim, "general")) ??
        "No primary-source entry has been verified for this claim.",
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
  return {
    ...row,
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
    ...(timeRules.has(row.state) ? { timeComputation: timeRules.get(row.state)! } : {}),
  };
});

const files4 = {
  rules: { ...rulesDoc, snapshotDate, ruleVersion, rules },
  sources: { ...sourcesDoc, snapshotDate, sources },
  coverage: { ...coverageDoc, snapshotDate, coverage },
  cases: { ...casesDoc, snapshotDate, cases },
};
const snapshot: LimitationsSnapshot = validateLimitationsSnapshot({
  rules: files4.rules,
  sources: files4.sources,
  coverage: files4.coverage,
  cases: files4.cases,
});

mkdirSync(join(out, "text"), { recursive: true });
mkdirSync(join(out, "opinion-text"), { recursive: true });
for (const dir of ["text", "opinion-text"])
  for (const f of readdirSync(join(bundle, dir)))
    copyFileSync(join(bundle, dir, f), join(out, dir, f));
for (const t of newTexts) writeFileSync(join(out, "text", `${t.id}.txt`), t.text);
for (const f of readdirSync(bundle)) {
  if (["publisher-overrides.json", "rejected-captures.json"].includes(f))
    copyFileSync(join(bundle, f), join(out, f));
}
writeFileSync(join(out, "rules.json"), `${JSON.stringify(files4.rules, null, 2)}\n`);
writeFileSync(join(out, "sources.json"), `${JSON.stringify(files4.sources, null, 2)}\n`);
writeFileSync(join(out, "coverage.json"), `${JSON.stringify(files4.coverage, null, 2)}\n`);
writeFileSync(join(out, "case-references.json"), `${JSON.stringify(files4.cases, null, 2)}\n`);
writeFileSync(
  join(out, "backfill-discrepancies.json"),
  `${JSON.stringify({ discrepancies, rejected, retiredLegacyRules: Object.fromEntries(RETIRED_LEGACY_RULES) }, null, 2)}\n`,
);

const cells = coverage.flatMap((c) => c.claimCoverage ?? []);
const tally = (s: string) => cells.filter((c) => c.status === s).length;
console.log(
  JSON.stringify({
    out,
    ruleVersion,
    rules: snapshot.rules.length,
    sources: snapshot.sources.length,
    addedRules: added,
    provenanceAttachedToExisting: attached,
    legacyResearchRulesUpgraded: upgraded,
    verificationGrades: gradeCounts,
    withheldFailedVerification: withheld,
    cells: {
      baseline: tally("baseline"),
      research_only: tally("research_only"),
      flagged: tally("flagged"),
      not_recorded: tally("not_recorded"),
    },
    timeRules: timeRules.size,
    timeRulesUnresolved: unresolvedTime,
    discrepancies: discrepancies.length,
    rejected: rejected.length,
  }),
);
