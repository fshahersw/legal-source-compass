import { createHash } from "node:crypto";
import type { LimitationRule, RuleVerification } from "../types";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const stable = (value: unknown): Json => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)]),
    );
  return (value ?? null) as Json;
};

/**
 * Digest of everything a verifier checks (period, citation, accrual, tolling, repose, dates, excerpt, sources).
 * Descriptive text such as conditions, summaries and the rule version are excluded, so wording changes do not
 * silently revoke a verification and substantive changes always do.
 */
export function ruleFingerprint(rule: LimitationRule): string {
  const p = rule.provenance;
  const core = {
    jurisdiction: rule.jurisdiction,
    claimType: rule.claimType,
    subtype: rule.subtype ?? "general",
    ruleKind: rule.ruleKind,
    computation: rule.computation,
    period: rule.period,
    accrualBasis: rule.accrualBasis,
    calculation: rule.calculation ?? null,
    effectiveFrom: rule.effectiveFrom,
    effectiveThrough: rule.effectiveThrough,
    sourceIds: [...rule.sourceIds].sort(),
    pinpoint: rule.pinpoint,
    provenance: p
      ? {
          citation: p.citation,
          excerpt: p.excerpt,
          periodEvidence: p.periodEvidence,
          accrualKind: p.accrualKind,
          accrualText: p.accrualText,
          tolling: p.tolling,
          repose: p.repose,
          lastAmended: p.lastAmended,
          effectiveDate: p.effectiveDate,
          entryStatus: p.entryStatus,
        }
      : null,
  };
  return createHash("sha256")
    .update(JSON.stringify(stable(core)))
    .digest("hex");
}

export type VerdictRecord = { verdict: string; disputeKind?: string | null };
export type RetryRecord = { retryVerdict: string };

export type GradeInput = {
  fingerprint: string;
  previousFingerprint: string | null;
  verdict: VerdictRecord | undefined;
  retry: RetryRecord | undefined;
  verifiedRuleVersion: string;
  verifiedOn: string;
};

export type GradeResult = {
  verification: RuleVerification;
  /** True when the rule failed verification on content and has not been corrected: it must not compute. */
  withhold: boolean;
};

/**
 * Per-rule verification grade.
 * - independently_verified: the verifier confirmed exactly this content (fingerprint unchanged).
 * - lower_evidence_grade: confirmed only through a retry that read the official page via a cached/intermediary route.
 * - official_capture_verified: everything else; the builder's literal-evidence check against the official capture
 *   (changed after verification, never reached by the verifier, or the verifier was blocked).
 */
export function gradeRule(input: GradeInput): GradeResult {
  const unchanged = input.previousFingerprint === input.fingerprint;
  const base = (basis: string) => ({
    basis,
    verifiedRuleVersion: input.verifiedRuleVersion,
    verifiedOn: input.verifiedOn,
  });
  if (input.verdict && unchanged) {
    if (
      input.verdict.verdict === "disputed" &&
      /rule-content/.test(input.verdict.disputeKind ?? "")
    ) {
      return {
        withhold: true,
        verification: {
          grade: "official_capture_verified",
          basis:
            "The independent verifier disputed this rule's content and it has not been corrected; it does not compute.",
        },
      };
    }
    if (input.verdict.verdict === "disputed" && input.verdict.disputeKind === "cell-mapping") {
      return {
        withhold: false,
        verification: {
          grade: "independently_verified",
          ...base(
            "The independent verifier confirmed this rule's own content; its dispute concerned which rule represents the claim type, which is now the general rule (variants are labelled and selectable).",
          ),
        },
      };
    }
    if (input.retry?.retryVerdict === "confirmed") {
      return {
        withhold: false,
        verification: {
          grade: "lower_evidence_grade",
          ...base(
            "Confirmed by the independent verifier on retry, but the official page was read through a cached or intermediary route rather than a direct official response.",
          ),
        },
      };
    }
    if (input.verdict.verdict === "confirmed") {
      return {
        withhold: false,
        verification: {
          grade: "independently_verified",
          ...base(
            "Confirmed by the independent verifier against freshly retrieved official text; the rule is unchanged since.",
          ),
        },
      };
    }
    if (input.verdict.verdict === "unable-to-verify") {
      return {
        withhold: false,
        verification: {
          grade: "official_capture_verified",
          basis:
            "The independent verifier could not read the official text (access block). Checked only by the builder's literal-evidence comparison against the retained official capture.",
        },
      };
    }
  }
  return {
    withhold: false,
    verification: {
      grade: "official_capture_verified",
      basis: input.verdict
        ? "Changed after the independent verification; checked by the builder's literal-evidence comparison against the retained official capture and pending the verifier's delta check."
        : "Checked by the builder's literal-evidence comparison against the retained official capture; not yet read by the independent verifier.",
    },
  };
}
