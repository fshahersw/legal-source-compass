import { baselineRule, calculateBaseline } from "./engine";
import {
  assessExceptions,
  reviewContextKey,
  SCREENING_QUESTIONS,
  type ScreeningAnswers,
} from "./exceptionReview";
import {
  applyMinorityPolicy,
  eligibleMinorityPolicy,
  type MinorityFacts,
  type ReviewedResult,
} from "./tollingPolicy";
import type { BaselineInput, LimitationsSnapshot } from "./types";

export type GuidedReview = {
  answers: ScreeningAnswers;
  contextKey: string;
  recordedQualificationsReviewed: boolean;
  minority?: MinorityFacts;
};
/** The only path from guided answers to arithmetic. Positive unsupported issues always withhold a date. */
export function calculateGuided(
  snapshot: LimitationsSnapshot,
  input: BaselineInput,
  review: GuidedReview,
): ReviewedResult {
  const rule = baselineRule(snapshot.rules, input.jurisdiction, input.claimType, input.subtype);
  const blocked = (reasons: string[]): ReviewedResult => ({
    status: "needs_review",
    date: null,
    rule,
    reasons,
    steps: [],
  });
  if (!rule) return blocked(["No unique, supported rule is released for this selection."]);
  if (review.contextKey !== reviewContextKey(snapshot, rule, input))
    return blocked(["The rule release or facts changed. Review the exception answers again."]);
  if (!review.recordedQualificationsReviewed)
    return blocked([
      "Review the full recorded conditions, exclusions and source qualifications for this rule.",
    ]);
  const minorityRequested = review.answers.minority === "yes";
  const policy = eligibleMinorityPolicy(rule);
  const assessment = assessExceptions(
    snapshot,
    rule,
    review.answers,
    minorityRequested && policy && review.minority ? ["minority"] : [],
  );
  if (assessment.unanswered.length || assessment.unresolved.length) {
    return blocked([
      ...assessment.unanswered.map((q) => `Answer: ${q.label}`),
      ...assessment.unresolved.map((q) => `${q.label} ${q.hint}`),
    ]);
  }
  const unexpectedlySelected = input.issues;
  if (unexpectedlySelected.length)
    return blocked([
      "Earlier selected special issues remain unresolved. Reconcile them before relying on a date.",
    ]);
  // Explicit answers resolve the general review gate; no unsupported issue is removed implicitly.
  const base = calculateBaseline(snapshot, {
    ...input,
    issues: [],
    exceptionReview: "no_unresolved_issues",
  });
  if (minorityRequested) {
    if (!review.minority || !policy)
      return blocked([
        "Minority may affect this claim, but no supported policy is released for this branch.",
      ]);
    return applyMinorityPolicy(snapshot, input, base, review.minority);
  }
  return base;
}

export function assessmentExport(
  snapshot: LimitationsSnapshot,
  input: BaselineInput,
  review: GuidedReview,
  result: ReviewedResult,
) {
  const rule = result.rule;
  return {
    schemaVersion: "guided-assessment/1",
    generatedAt: new Date().toISOString(),
    ruleRelease: snapshot.ruleVersion,
    snapshotDate: snapshot.snapshotDate,
    ruleId: rule?.id ?? null,
    input,
    review,
    assessment: result,
    screening: SCREENING_QUESTIONS.map((q) => ({
      id: q.id,
      question: q.label,
      answer: review.answers[q.id] ?? "unanswered",
      disposition:
        review.answers[q.id] === "no"
          ? "reported_not_applicable"
          : q.id === "minority" && result.tollingApplied
            ? "applied"
            : review.answers[q.id]
              ? "requires_review"
              : "unanswered",
    })),
    recordedQualifications: rule ? assessExceptions(snapshot, rule, review.answers).inventory : [],
    authorities: rule ? snapshot.sources.filter((s) => rule.sourceIds.includes(s.id)) : [],
    comprehensiveLawReview: false,
    verifiedFilingDeadline: false,
  };
}
