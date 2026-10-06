import type { ClaimCoverage, ClaimCoverageStatus, ClaimType, LimitationRule } from "../types";

const statusOf = (rule: LimitationRule): ClaimCoverageStatus =>
  rule.computation === "baseline_only"
    ? "baseline"
    : rule.provenance?.entryStatus === "flagged"
      ? "flagged"
      : "research_only";

/**
 * Coverage of one claim type in one jurisdiction. The cell reflects ONLY the claim type's general rule:
 * a narrow variant (intentional tort, foreign object, sealed instrument...) never stands in for it. Variants
 * are listed separately and compute only when the user selects their fact pattern.
 */
export function claimCoverageFor(
  rules: LimitationRule[],
  claimType: ClaimType,
  notRecordedReason: string,
): ClaimCoverage {
  const mine = rules.filter((r) => r.claimType === claimType && r.ruleKind === "limitations");
  const general = mine.filter((r) => !r.subtype || r.subtype === "general");
  const chosen =
    general.find((r) => r.computation === "baseline_only") ??
    general.find((r) => r.period !== null) ??
    general[0];
  const variants = mine
    .filter((r) => r.subtype && r.subtype !== "general" && r.period !== null)
    .map((r) => ({ subtype: r.subtype!, ruleId: r.id, status: statusOf(r) }))
    .sort((a, b) => a.subtype.localeCompare(b.subtype));
  if (!chosen) {
    return {
      claimType,
      status: "not_recorded",
      reason: variants.length
        ? `${notRecordedReason} Only narrow fact-pattern variants are recorded; none is treated as the claim type's rule.`
        : notRecordedReason,
      ...(variants.length ? { variants } : {}),
    };
  }
  return {
    claimType,
    status: statusOf(chosen),
    ruleId: chosen.id,
    ...(variants.length ? { variants } : {}),
  };
}
