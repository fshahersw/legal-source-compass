import { baselineRule, calculateBaseline, weekendTreatment } from "./engine";
import {
  applyReviewedInstructions,
  type ReviewedArithmeticResult,
  type ReviewedInstruction,
} from "./reviewedArithmetic";
import {
  buildReviewInventory,
  reviewContextKey,
  reviewProgress,
  type ReviewFactor,
  type ReviewState,
} from "./reviewInventory";
import type { BaselineInput, BaselineResult, LimitationsSnapshot } from "./types";

export type AssessmentRuntime = { sourceRefreshFailed?: boolean };

export type DeadlineAssessment = {
  status: "needs_information" | "needs_legal_review" | "invalid" | "baseline" | "reviewed_scenario";
  date: string | null;
  baseline: BaselineResult;
  scenario: ReviewedArithmeticResult | null;
  calendar: ReturnType<typeof weekendTreatment> | null;
  reasons: string[];
  factors: ReviewFactor[];
  progress: ReturnType<typeof reviewProgress>;
  coverage: "recorded_materials_only";
};

/** UI entry point. Blanket legacy exception confirmations do not satisfy this review. */
export function assessDeadline(
  snapshot: LimitationsSnapshot,
  input: BaselineInput,
  review: ReviewState | null,
  runtime: AssessmentRuntime = {},
): DeadlineAssessment {
  const rule = baselineRule(snapshot.rules, input.jurisdiction, input.claimType, input.subtype);
  const factors = rule ? buildReviewInventory(rule) : [];
  const current =
    !!rule && !!review && review.contextKey === reviewContextKey(snapshot, rule, input);
  const progress = reviewProgress(factors, current ? review!.decisions : {});
  const initial: DeadlineAssessment = {
    status: "needs_information",
    date: null,
    baseline: calculateBaseline(snapshot, input),
    scenario: null,
    calendar: null,
    reasons: [],
    factors,
    progress,
    coverage: "recorded_materials_only",
  };
  if (runtime.sourceRefreshFailed)
    return {
      ...initial,
      status: "needs_legal_review",
      reasons: [
        "Source refresh failed. The loaded evidence cannot be confirmed; no assessment date is issued until the release is successfully reloaded.",
      ],
    };
  if (!rule) return { ...initial, status: "needs_legal_review", reasons: initial.baseline.reasons };
  if (!current)
    return {
      ...initial,
      reasons: [
        "Review the factors for the current facts, statutory version and source evidence. Earlier confirmations were not carried forward.",
      ],
    };
  const known = new Set(factors.map((f) => f.id));
  if (Object.keys(review!.decisions).some((id) => !known.has(id)))
    return {
      ...initial,
      reasons: ["The review includes a factor not present in this rule. Start a fresh review."],
    };
  if (!progress.complete) {
    const reasons: string[] = [];
    if (progress.pending)
      reasons.push(
        `${progress.pending} recorded factors or screening questions still need an explicit answer or a complete instruction.`,
      );
    if (progress.unresolved)
      reasons.push(
        `${progress.unresolved} factors are marked for legal review. No deadline is presented while they remain unresolved.`,
      );
    return {
      ...initial,
      status: progress.unresolved ? "needs_legal_review" : "needs_information",
      reasons,
    };
  }
  // Preserve every other baseline-engine guard, including historical windows and explicit issues.
  const baseline = calculateBaseline(snapshot, {
    ...input,
    exceptionReview: "no_unresolved_issues",
  });
  const base = { ...initial, baseline };
  if (baseline.status !== "baseline" || !baseline.date)
    return {
      ...base,
      status: baseline.status === "invalid" ? "invalid" : "needs_legal_review",
      reasons: baseline.reasons,
    };
  if (rule.provenance?.entryStatus === "flagged")
    return {
      ...base,
      status: "needs_legal_review",
      reasons: [
        "This rule still carries a flagged legal-source entry. A user's review does not promote the source to verified.",
      ],
    };
  const instructions: ReviewedInstruction[] = factors.flatMap((f) => {
    const d = review!.decisions[f.id];
    return d?.status === "instruction" && d.instruction ? [d.instruction] : [];
  });
  if (!instructions.length)
    return {
      ...base,
      status: "baseline",
      date: baseline.date,
      // Preserve the original engine's complete context, including ALL independent caps.
      // Re-running weekendTreatment with only accrual silently discarded the repose guard.
      calendar: {
        adjustedDate: baseline.adjustedDate ?? null,
        weekendNotice: baseline.weekendNotice ?? null,
        weekendText:
          baseline.weekendNotice || baseline.adjustedDate
            ? (baseline.steps.at(-1)?.text ?? null)
            : null,
        stepText: baseline.steps.at(-1)?.text ?? "",
        sourceIds: [...new Set(baseline.steps.flatMap((step) => step.sourceIds ?? []))],
      },
      reasons: baseline.reasons,
    };
  if (
    rule.calculation ||
    (rule.provenance?.repose.length ?? 0) > 0 ||
    !rule.period ||
    rule.accrualBasis !== "confirmed_accrual"
  ) {
    return {
      ...base,
      status: "needs_legal_review",
      reasons: [
        "This rule has multiple, death/discovery-based or independently capped clocks. A generic instruction cannot be added to their combined date. Clock-specific legal effects and any repose interaction must be resolved first.",
      ],
    };
  }
  const scenario = applyReviewedInstructions({
    startDate: input.accrualDate,
    baselineDate: baseline.date,
    period: rule.period,
    instructions,
  });
  if (scenario.status !== "calculated" || !scenario.date)
    return {
      ...base,
      status: scenario.status === "invalid" ? "invalid" : "needs_legal_review",
      scenario,
      reasons: scenario.reasons,
    };
  return {
    ...base,
    status: "reviewed_scenario",
    date: scenario.date,
    scenario,
    calendar: weekendTreatment(snapshot, input.jurisdiction, scenario.date, {
      governingDates: [input.accrualDate],
      // An expressly fixed date is not permission to roll an agreement/order into Monday.
      outerLimits: instructions.filter((i) => i.kind === "fixed_deadline").map((i) => i.date),
    }),
    reasons: [
      "This is conditional arithmetic under the recorded user's legal instructions, not a newly verified statutory rule or a final filing deadline.",
      "Court calendars, filing/service cutoffs, operative-law completeness and all case-specific assumptions still require verification.",
    ],
  };
}

/** Explicit user export only. No network calls or automatic browser persistence. */
export function createAssessmentExport(
  snapshot: LimitationsSnapshot,
  input: BaselineInput,
  review: ReviewState | null,
  exportedAt: string,
  runtime: AssessmentRuntime = {},
) {
  // Re-evaluate on export: a cached result cannot survive edits or unavailable evidence.
  const assessment = assessDeadline(snapshot, input, review, runtime);
  const rule = assessment.baseline.rule;
  const sourceIds = new Set([
    ...(rule?.sourceIds ?? []),
    ...(assessment.calendar?.sourceIds ?? []),
  ]);
  return {
    schemaVersion: "deadline-assessment/1",
    exportedAt,
    release: snapshot.ruleVersion,
    snapshotDate: snapshot.snapshotDate,
    sourceState: runtime.sourceRefreshFailed ? "refresh_failed" : "snapshot_loaded",
    coverage: {
      exhaustiveLegalReview: false,
      verifiedFilingDeadline: false,
      scope:
        "All notes attached to the selected recorded rule plus an explicit general screening; not all potentially applicable law.",
    },
    inputs: structuredClone(input),
    rule: rule
      ? {
          id: rule.id,
          version: rule.ruleVersion,
          jurisdiction: rule.jurisdiction,
          claimType: rule.claimType,
          subtype: rule.subtype ?? "general",
          citation: rule.pinpoint,
        }
      : null,
    assessment: {
      status: assessment.status,
      date: assessment.date,
      baseline: assessment.baseline,
      scenario: assessment.scenario,
      calendar: assessment.calendar,
      reasons: assessment.reasons,
    },
    reviewDecisions: structuredClone(review?.decisions ?? {}),
    factorInventory: structuredClone(assessment.factors),
    reviewCurrent: !!rule && review?.contextKey === reviewContextKey(snapshot, rule, input),
    sourceReferences: snapshot.sources
      .filter((s) => sourceIds.has(s.id))
      .map((s) => ({
        id: s.id,
        url: s.url,
        sha256: s.sha256,
        textPath: s.textPath,
        verifiedAt: s.verifiedAt,
        currency: s.currency ?? null,
      })),
  };
}
