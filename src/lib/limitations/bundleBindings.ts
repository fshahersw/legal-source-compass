import type { ClaimCoverageStatus, CoverageRow, LimitationRule, LimitationSource } from "./types";

/** Cross-file identity checks only. These do not certify the underlying legal interpretation. */
export function assertBundleBindings(
  rules: readonly LimitationRule[],
  sources: readonly LimitationSource[],
  coverage: readonly CoverageRow[],
): void {
  const byRule = new Map(rules.map((rule) => [rule.id, rule]));
  const bySource = new Map(sources.map((source) => [source.id, source]));
  const statusOf = (rule: LimitationRule): ClaimCoverageStatus =>
    rule.computation === "baseline_only"
      ? "baseline"
      : rule.provenance?.entryStatus === "flagged"
        ? "flagged"
        : "research_only";
  function authority(state: string, id: string) {
    const source = bySource.get(id);
    if (!source) throw new Error("missing source: " + id);
    if (source.state !== state)
      throw new Error("Authority jurisdiction differs from rule/counting jurisdiction: " + id);
  }
  for (const rule of rules) for (const id of rule.sourceIds) authority(rule.jurisdiction, id);
  for (const row of coverage) {
    if (row.timeComputation) {
      authority(row.state, row.timeComputation.sourceId);
      for (const id of row.timeComputation.supportingSourceIds ?? []) authority(row.state, id);
    }
    for (const cell of row.claimCoverage ?? []) {
      const general = rules.filter(
        (rule) =>
          rule.jurisdiction === row.state &&
          rule.claimType === cell.claimType &&
          rule.ruleKind === "limitations" &&
          (!rule.subtype || rule.subtype === "general"),
      );
      if (cell.status === "not_recorded") {
        if (cell.ruleId || general.length)
          throw new Error("not_recorded claim cell conflicts with a general rule");
      } else {
        const rule = byRule.get(cell.ruleId ?? "");
        if (!rule) throw new Error("missing general claim rule: " + cell.ruleId);
        if (rule.jurisdiction !== row.state) throw new Error("General rule jurisdiction mismatch");
        if (rule.claimType !== cell.claimType) throw new Error("General rule claim type mismatch");
        if (rule.ruleKind !== "limitations" || (rule.subtype && rule.subtype !== "general"))
          throw new Error("Narrow variant cannot stand in for general rule");
        if (cell.status !== statusOf(rule))
          throw new Error("General claim status differs from rule computation");
        if (cell.basis !== undefined && cell.basis !== (rule.basis ?? "claim_specific"))
          throw new Error("Claim basis differs from bound rule");
        if (cell.grade !== undefined && cell.grade !== rule.verification?.grade)
          throw new Error("Claim evidence grade differs from bound rule");
      }
      const ids = new Set<string>();
      for (const variant of cell.variants ?? []) {
        if (ids.has(variant.ruleId)) throw new Error("duplicate variant rule id");
        ids.add(variant.ruleId);
        const rule = byRule.get(variant.ruleId);
        if (!rule) throw new Error("missing variant rule: " + variant.ruleId);
        if (rule.jurisdiction !== row.state || rule.claimType !== cell.claimType)
          throw new Error("Variant jurisdiction or claim mismatch");
        if (
          rule.ruleKind !== "limitations" ||
          !rule.subtype ||
          rule.subtype === "general" ||
          rule.subtype !== variant.subtype ||
          rule.period === null
        )
          throw new Error("Variant subtype or period mismatch");
        if (variant.status !== statusOf(rule))
          throw new Error("Variant status differs from rule computation");
      }
    }
  }
}
