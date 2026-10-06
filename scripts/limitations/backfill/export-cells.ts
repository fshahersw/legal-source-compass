/**
 * Export the per-cell data of a built limitations bundle as one machine-readable file for independent
 * clause-level verification. Usage: bun scripts/limitations/backfill/export-cells.ts <out.json>
 * Env: LIM_OUT (built bundle dir, default /tmp/lim/out/limitations)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLAIM_TYPES } from "../../../src/lib/limitations/types";
import type {
  CoverageRow,
  LimitationRule,
  LimitationSource,
} from "../../../src/lib/limitations/types";

const outDir = process.env.LIM_OUT ?? "/tmp/lim/out/limitations";
const target = process.argv[2];
if (!target) throw new Error("output path required");
const read = (name: string) => JSON.parse(readFileSync(join(outDir, name), "utf8"));
const rules = read("rules.json") as {
  ruleVersion: string;
  snapshotDate: string;
  rules: LimitationRule[];
};
const sources = read("sources.json").sources as LimitationSource[];
const coverage = read("coverage.json").coverage as CoverageRow[];
const sourceById = new Map(sources.map((s) => [s.id, s]));

const sourceView = (id: string) => {
  const s = sourceById.get(id);
  if (!s) return { sourceId: id, missing: true };
  return {
    sourceId: s.id,
    url: s.url,
    title: s.title,
    authorityKind: s.authorityKind,
    retrievedAt: s.capturedAt,
    textSha256: s.sha256,
    textBytes: s.byteLength,
    textPath: s.textPath,
    rawSha256: s.rawCapture?.sha256 ?? null,
    rawBytes: s.rawCapture?.byteLength ?? null,
    rawStorageBucket: s.rawCapture?.storageBucket ?? null,
    rawStorageKey: s.rawCapture?.storageKey ?? null,
    method: s.method,
  };
};

const cells = coverage.flatMap((row) =>
  CLAIM_TYPES.map((claimType) => {
    const claim = row.claimCoverage?.find((c) => c.claimType === claimType);
    const entries = rules.rules
      .filter((r) => r.jurisdiction === row.state && r.claimType === claimType)
      .map((r) => ({
        ruleId: r.id,
        variant: r.subtype ?? "general",
        ruleKind: r.ruleKind,
        computation: r.computation,
        entryStatus: r.provenance?.entryStatus ?? "legacy_production_rule_not_re_verified_by_entry",
        period: r.period,
        citation: r.provenance?.citation ?? r.pinpoint,
        excerpt: r.provenance?.excerpt ?? null,
        periodEvidence: r.provenance?.periodEvidence ?? null,
        accrual: r.provenance
          ? { kind: r.provenance.accrualKind, text: r.provenance.accrualText }
          : null,
        tolling: r.provenance?.tolling ?? [],
        repose: r.provenance?.repose ?? [],
        lastAmended: r.provenance?.lastAmended ?? null,
        effectiveDate: r.provenance?.effectiveDate ?? r.effectiveFrom,
        retrievedAt: r.provenance?.retrievedAt ?? null,
        confidence: r.provenance
          ? { level: r.provenance.confidence, note: r.provenance.confidenceNote }
          : null,
        flags: r.provenance?.flags ?? [],
        conditions: r.conditions,
        calculation: r.calculation ?? null,
        sources: r.sourceIds.map(sourceView),
      }));
    return {
      jurisdiction: row.state,
      claimType,
      cellStatus: claim?.status ?? "not_recorded",
      cellRuleId: claim?.ruleId ?? null,
      notRecordedReason: claim?.status === "not_recorded" ? (claim.reason ?? "Not recorded") : null,
      entries,
    };
  }),
);

const timeRules = coverage
  .filter((c) => c.timeComputation)
  .map((c) => ({
    jurisdiction: c.state,
    ...c.timeComputation!,
    source: sourceView(c.timeComputation!.sourceId),
    appliedByCalculator:
      c.timeComputation!.status === "verified" && c.timeComputation!.extendsWhenLastDayIsWeekend,
  }));

const count = (status: string) => cells.filter((c) => c.cellStatus === status).length;
const doc = {
  schema: "limitations-cells/1",
  release: rules.ruleVersion,
  snapshotDate: rules.snapshotDate,
  generatedAt: new Date().toISOString(),
  state: "staged_not_activated",
  note: "Per-cell data for independent clause-level verification. An entry is mechanically verified only for literal presence of excerpt and evidence strings in the retained official capture; clause-level legal correctness is what the independent pass checks.",
  counts: {
    cells: cells.length,
    baseline: count("baseline"),
    research_only: count("research_only"),
    flagged: count("flagged"),
    not_recorded: count("not_recorded"),
    entries: cells.reduce((a, c) => a + c.entries.length, 0),
    timeRules: timeRules.length,
  },
  cells,
  timeRules,
};
writeFileSync(target, `${JSON.stringify(doc, null, 1)}\n`);
console.log(JSON.stringify({ target, bytes: JSON.stringify(doc).length, ...doc.counts }));
