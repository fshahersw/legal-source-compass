import { addCivilPeriod, parseCivilDate, weekendTreatment } from "./engine";
import type {
  BaselineInput,
  BaselineResult,
  LimitationRule,
  LimitationSource,
  LimitationsSnapshot,
  TollingPolicy,
} from "./types";

export type MinorityFacts = {
  policyId: string;
  majorityDate: string;
  minorAtAccrual: boolean;
  majorityDateConfirmed: boolean;
  livingNoOtherDisability: boolean;
  ordinaryPrivateClaim: boolean;
  conditionsConfirmed: boolean;
};
export type ReviewedResult = BaselineResult & {
  tollingApplied?: {
    policyId: string;
    ordinaryDate: string;
    eventDate: string;
    citation: string;
    sourceIds: string[];
  };
};

/** Shape, exact scope and retained-source identity gate; a quote still needs literal matching at release. */
export function validateTollingPolicies(
  rules: readonly LimitationRule[],
  sources: readonly LimitationSource[],
): void {
  for (const rule of rules) {
    if (rule.tollingPolicies === undefined) continue;
    if (!Array.isArray(rule.tollingPolicies) || rule.tollingPolicies.length > 1)
      throw new Error("Tolling policy collection must have at most one non-stacking policy");
    for (const p of rule.tollingPolicies) {
      if (
        !p ||
        typeof p !== "object" ||
        p.schemaVersion !== "1.0.0" ||
        p.kind !== "minority_at_accrual" ||
        p.operation !== "period_after_majority" ||
        typeof p.id !== "string" ||
        !p.id.trim()
      )
        throw new Error("Unsupported tolling policy schema");
      if (
        p.scopeRuleId !== rule.id ||
        p.jurisdiction !== rule.jurisdiction ||
        p.claimType !== rule.claimType ||
        p.subtype !== (rule.subtype ?? "general") ||
        rule.claimType !== "personal_injury" ||
        p.subtype !== "general" ||
        rule.calculation ||
        rule.ruleKind !== "limitations" ||
        rule.accrualBasis !== "confirmed_accrual"
      )
        throw new Error(
          "Tolling policy scope is not this ordinary injury rule; special claims and repose need separate policies",
        );
      if (
        !p.period ||
        p.period.unit !== "calendar_years" ||
        !Number.isSafeInteger(p.period.amount) ||
        p.period.amount < 1 ||
        p.period.amount > 100 ||
        !parseCivilDate(p.reviewedOn) ||
        !parseCivilDate(p.effectiveFrom) ||
        p.effectiveFrom > p.reviewedOn
      )
        throw new Error("Tolling policy period/review date invalid");
      if (
        !Array.isArray(p.conditions) ||
        !p.conditions.length ||
        p.conditions.some((x) => typeof x !== "string" || !x.trim())
      )
        throw new Error("Tolling policy needs explicit conditions");
      if (!Array.isArray(p.evidence) || !p.evidence.length || p.evidence.length > 20)
        throw new Error("Tolling policy lacks retained evidence");
      for (const e of p.evidence) {
        const found = sources.filter((s) => s.id === e.sourceId);
        if (
          found.length !== 1 ||
          found[0]!.state !== rule.jurisdiction ||
          found[0]!.authorityKind !== "statute" ||
          !rule.sourceIds.includes(e.sourceId) ||
          e.sha256 !== found[0]!.sha256 ||
          !/^[a-f0-9]{64}$/.test(e.sha256) ||
          typeof e.quote !== "string" ||
          e.quote.trim().length < 20 ||
          typeof e.citation !== "string" ||
          !e.citation.trim()
        )
          throw new Error(
            "Tolling policy evidence missing, mismatched, or from another jurisdiction",
          );
      }
    }
  }
}

export function eligibleMinorityPolicy(rule: LimitationRule | null): TollingPolicy | null {
  const p = rule?.tollingPolicies?.filter((p) => p.kind === "minority_at_accrual") ?? [];
  return p.length === 1 ? p[0]! : null;
}

export function applyMinorityPolicy(
  snapshot: LimitationsSnapshot,
  input: BaselineInput,
  base: BaselineResult,
  facts: MinorityFacts,
): ReviewedResult {
  const blocked = (reason: string): ReviewedResult => ({
    ...base,
    status: "needs_review",
    date: null,
    adjustedDate: null,
    weekendNotice: null,
    reasons: [reason],
    steps: [],
  });
  const rule = base.rule;
  if (!rule || base.status !== "baseline" || !base.date)
    return blocked("The underlying claim, date, or baseline still requires review.");
  try {
    validateTollingPolicies([rule], snapshot.sources);
  } catch (e) {
    return blocked(e instanceof Error ? e.message : "Invalid tolling policy");
  }
  const policy = eligibleMinorityPolicy(rule);
  if (!policy || policy.id !== facts.policyId)
    return blocked("No source-bound minority policy is released for this exact rule.");
  if (
    input.jurisdiction !== rule.jurisdiction ||
    input.claimType !== rule.claimType ||
    (input.subtype ?? "general") !== (rule.subtype ?? "general")
  )
    return blocked("The input and minority policy refer to different rules.");
  if (
    facts.minorAtAccrual !== true ||
    facts.majorityDateConfirmed !== true ||
    facts.livingNoOtherDisability !== true ||
    facts.ordinaryPrivateClaim !== true ||
    facts.conditionsConfirmed !== true
  )
    return blocked(
      "Confirm minority at accrual, the legally established majority date, living status, the private ordinary claim, and every policy condition.",
    );
  if (
    !parseCivilDate(input.accrualDate) ||
    !parseCivilDate(facts.majorityDate) ||
    facts.majorityDate <= input.accrualDate
  )
    return blocked(
      "The claimant must have been a minor at accrual and the legally established majority date must follow accrual.",
    );
  if (input.accrualDate < policy.effectiveFrom)
    return blocked(
      `The accrual date precedes this policy's supported window (${policy.effectiveFrom}). Review the applicable historical law; no modern tolling formula was applied.`,
    );
  const authorities = policy.evidence.map((e) =>
    snapshot.sources.find((s) => s.id === e.sourceId)!,
  );
  const dates = [
    policy.reviewedOn,
    snapshot.snapshotDate,
    ...authorities.map((s) => s.verifiedAt.slice(0, 10)),
  ];
  if (
    dates.some((d) => !parseCivilDate(d)) ||
    authorities.some((s) => s.currency?.status === "evidence_lost")
  )
    return blocked("Required minority-tolling evidence is lost, missing, or undated.");
  const reviewedThrough = dates.sort()[0]!;
  if (facts.majorityDate > reviewedThrough || input.accrualDate > reviewedThrough)
    return blocked(
      `Minority facts extend beyond the authority review (${reviewedThrough}); an ongoing or later disability requires review.`,
    );
  const after = addCivilPeriod(facts.majorityDate, policy.period.amount, policy.period.unit);
  if (!after)
    return blocked(
      "The majority-date anniversary does not exist in that year. A jurisdiction-specific leap-day rule must be established.",
    );
  const date = [base.date, after].sort().at(-1)!;
  const citation = policy.evidence.map((e) => e.citation).join("; ");
  const sourceIds = [...new Set(policy.evidence.map((e) => e.sourceId))];
  const weekend = weekendTreatment(snapshot, input.jurisdiction, date, {
    governingDates: [input.accrualDate, facts.majorityDate],
  });
  return {
    ...base,
    date,
    adjustedDate: weekend.adjustedDate,
    weekendNotice: weekend.weekendNotice,
    reasons: [
      ...base.reasons,
      "Only the selected, confirmed minority policy was applied. Other tolling, claim exceptions and filing rules are not inferred.",
    ],
    tollingApplied: {
      policyId: policy.id,
      ordinaryDate: base.date,
      eventDate: facts.majorityDate,
      citation,
      sourceIds,
    },
    steps: [
      ...base.steps.slice(0, -1),
      {
        text: `Before minority tolling the statutory anniversary would be ${base.date}.`,
        sourceIds: rule.sourceIds,
        pinpoint: rule.pinpoint,
      },
      {
        text: `Under the released policy, use ${policy.period.amount} calendar years after the confirmed majority date (${facts.majorityDate}): ${after}. Do not shorten an otherwise later baseline.`,
        sourceIds,
        pinpoint: citation,
      },
      {
        text: weekend.stepText,
        sourceIds: [...new Set([...sourceIds, ...weekend.sourceIds])],
        pinpoint: weekend.adjustedDate?.citation ?? citation,
      },
    ],
  };
}
