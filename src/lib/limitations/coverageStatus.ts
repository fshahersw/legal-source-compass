import type { ClaimCoverageStatus, LimitationRule } from "./types";

/** An unresolved provenance review takes precedence over a legacy arithmetic capability. */
export const ruleCoverageStatus = (rule: LimitationRule): ClaimCoverageStatus =>
  rule.provenance?.entryStatus === "flagged"
    ? "flagged"
    : rule.computation === "baseline_only"
      ? "baseline"
      : "research_only";
