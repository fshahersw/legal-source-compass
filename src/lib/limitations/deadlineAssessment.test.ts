import { describe, expect, it } from "vitest";
import { assessDeadline, createAssessmentExport } from "./deadlineAssessment";
import { buildReviewInventory, reviewContextKey, type ReviewState } from "./reviewInventory";
import type { BaselineInput, LimitationRule, LimitationsSnapshot } from "./types";
import type { ReviewedInstruction } from "./reviewedArithmetic";

function fixture() {
  const rule = {
    id: "r",
    schemaVersion: "1.0.0",
    ruleVersion: "v1",
    jurisdiction: "IL",
    claimType: "personal_injury",
    ruleKind: "limitations",
    computation: "baseline_only",
    reviewStatus: "statutory_text_verified",
    period: { amount: 1, unit: "calendar_years" },
    sourceIds: ["s"],
    pinpoint: "Synthetic § 1",
    scope: "Test only",
    accrualBasis: "confirmed_accrual",
    conditions: [],
    exclusions: [],
    warnings: [],
    effectiveFrom: "2020-01-01",
    effectiveThrough: null,
    validity: "Fixture, not law",
    historicalApplicability: "Fixture version",
    provenance: {
      tolling: [{ text: "Synthetic suspension note.", citation: "Synthetic § 2" }],
      repose: [],
      flags: [],
      entryStatus: "verified",
    },
  } as unknown as LimitationRule;
  const snapshot = {
    schemaVersion: "1.0.0",
    ruleVersion: "release1",
    snapshotDate: "2026-10-08",
    rules: [rule],
    sources: [
      {
        id: "s",
        state: "IL",
        authorityKind: "statute",
        sha256: "a".repeat(64),
        verifiedAt: "2026-10-08T00:00:00Z",
        url: "https://example.gov/fixture",
      },
    ],
    cases: [],
    coverage: [
      {
        state: "IL",
        timeComputationNotRecorded: { reason: "No calendar loaded", reviewedOn: "2026-10-08" },
      },
    ],
  } as unknown as LimitationsSnapshot;
  const input: BaselineInput = {
    jurisdiction: "IL",
    claimType: "personal_injury",
    accrualDate: "2024-01-01",
    governingLawConfirmed: true,
    accrualConfirmed: true,
    applicabilityConfirmed: true,
    exceptionReview: "unresolved",
    issues: [],
  };
  const review: ReviewState = {
    contextKey: reviewContextKey(snapshot, rule, input),
    decisions: Object.fromEntries(
      buildReviewInventory(rule).map((f) => [f.id, { status: "no_effect" }]),
    ),
  };
  return { snapshot, input, rule, review };
}
const instruction: ReviewedInstruction = {
  id: "instruction1",
  kind: "pause",
  startDate: "2024-03-01",
  resumeDate: "2024-04-01",
  authority: "Synthetic § 2",
  explanation: "The effect and scope are established only for this synthetic fixture.",
  reviewer: "Test reviewer",
  legalEffectConfirmed: true,
  boundariesConfirmed: true,
  interactionsConfirmed: true,
};

describe("deadline assessment", () => {
  it("requires explicit current review, never just legacy blanket confirmation", () => {
    const { snapshot, input } = fixture();
    input.exceptionReview = "no_unresolved_issues";
    const r = assessDeadline(snapshot, input, null);
    expect(r.date).toBeNull();
    expect(r.status).toBe("needs_information");
  });
  it("produces a baseline only when all recorded factors were explicitly addressed", () => {
    const f = fixture(),
      r = assessDeadline(f.snapshot, f.input, f.review);
    expect(r.status).toBe("baseline");
    expect(r.date).toBe("2025-01-01");
    expect(r.coverage).toBe("recorded_materials_only");
  });
  it("does not carry review to edited facts or a new source hash", () => {
    const f = fixture();
    expect(
      assessDeadline(f.snapshot, { ...f.input, accrualDate: "2024-01-02" }, f.review).date,
    ).toBeNull();
    f.snapshot.sources[0]!.sha256 = "b".repeat(64);
    expect(assessDeadline(f.snapshot, f.input, f.review).date).toBeNull();
  });
  it("a single unresolved exclusion withholds the date", () => {
    const f = fixture();
    f.review.decisions["screen:special_claim"] = { status: "needs_review" };
    const r = assessDeadline(f.snapshot, f.input, f.review);
    expect(r.status).toBe("needs_legal_review");
    expect(r.date).toBeNull();
  });
  it("does not use an unrelated decision key to satisfy a missing factor", () => {
    const f = fixture();
    delete f.review.decisions["screen:other"];
    f.review.decisions["invented"] = { status: "no_effect" };
    expect(assessDeadline(f.snapshot, f.input, f.review).date).toBeNull();
  });
  it("retains original statutory result beside an explicitly reviewed scenario", () => {
    const f = fixture();
    f.review.decisions["provenance.tolling[0]"] = { status: "instruction", instruction };
    const r = assessDeadline(f.snapshot, f.input, f.review);
    expect(r.status).toBe("reviewed_scenario");
    expect(r.date).toBe("2025-02-01");
    expect(r.baseline.date).toBe("2025-01-01");
    expect(r.scenario?.excludedDays).toBe(31);
  });
  it("cannot bypass a government/special-claim issue with a generic tolling instruction", () => {
    const f = fixture();
    f.review.decisions["screen:special_claim"] = { status: "instruction", instruction };
    expect(assessDeadline(f.snapshot, f.input, f.review).date).toBeNull();
  });
  it("does not override explicit unresolved legacy issues", () => {
    const f = fixture();
    f.input.issues = ["foreign_law"];
    f.review.contextKey = reviewContextKey(f.snapshot, f.rule, f.input);
    expect(assessDeadline(f.snapshot, f.input, f.review).date).toBeNull();
  });
  it("preserves statutory applicability confirmations", () => {
    const f = fixture();
    f.input.governingLawConfirmed = false;
    f.review.contextKey = reviewContextKey(f.snapshot, f.rule, f.input);
    expect(assessDeadline(f.snapshot, f.input, f.review).date).toBeNull();
  });
  it("cannot revive source evidence that is known lost", () => {
    const f = fixture();
    f.rule.currency = { status: "evidence_lost" } as NonNullable<LimitationRule["currency"]>;
    f.review.contextKey = reviewContextKey(f.snapshot, f.rule, f.input);
    expect(assessDeadline(f.snapshot, f.input, f.review).date).toBeNull();
  });
  it("does not generalize single-clock adjustments to an independent repose rule", () => {
    const f = fixture();
    f.rule.provenance!.repose = [
      { years: 10, citation: "Fixture cap", trigger: "act", effectiveFrom: null },
    ];
    f.review.contextKey = reviewContextKey(f.snapshot, f.rule, f.input);
    f.review.decisions["provenance.repose[0]"] = { status: "no_effect" };
    f.review.decisions["provenance.tolling[0]"] = { status: "instruction", instruction };
    const r = assessDeadline(f.snapshot, f.input, f.review);
    expect(r.date).toBeNull();
    expect(r.reasons.join(" ")).toMatch(/clock|repose|outer/i);
  });
  it("exports source references and reviewer assumptions without claiming exhaustive law coverage", () => {
    const f = fixture();
    f.review.decisions["provenance.tolling[0]"] = { status: "instruction", instruction };
    const out = createAssessmentExport(f.snapshot, f.input, f.review, "2026-10-09T00:00:00Z");
    expect(out.coverage.exhaustiveLegalReview).toBe(false);
    expect(out.coverage.verifiedFilingDeadline).toBe(false);
    expect(out.sourceReferences[0]!.sha256).toBe("a".repeat(64));
    expect(out.reviewDecisions["provenance.tolling[0]"]!.instruction?.reviewer).toBe(
      "Test reviewer",
    );
    expect(out.assessment.date).toBe("2025-02-01");
  });
});

describe("assessment boundary regressions", () => {
  it("withholds a date when refreshing the governing evidence failed", () => {
    const f = fixture();
    const result = assessDeadline(f.snapshot, f.input, f.review, { sourceRefreshFailed: true });
    expect(result.date).toBeNull();
    expect(result.status).toBe("needs_legal_review");
    expect(result.reasons.join(" ")).toMatch(/refresh|evidence/i);
  });

  it("exports a newly evaluated assessment instead of trusting an earlier result", () => {
    const f = fixture();
    f.input.accrualDate = "2024-02-01";
    const out = createAssessmentExport(f.snapshot, f.input, f.review, "2026-10-09T00:00:00Z");
    expect(out.reviewCurrent).toBe(false);
    expect(out.assessment.date).toBeNull();
  });

  it("does not bypass the baseline engine's independently capped weekend decision", () => {
    const f = fixture();
    f.rule.period = { amount: 2, unit: "calendar_years" };
    f.rule.calculation = {
      mode: "accrual_repose_min",
      reposeYears: 10,
      reposeTrigger: "act_or_omission",
      reposeEffectiveFrom: "1990-01-01",
    };
    f.input.accrualDate = "2024-05-02";
    f.input.reposeActDate = "2016-05-03";
    f.input.reposeApplicabilityConfirmed = true;
    f.snapshot.sources.push({ ...f.snapshot.sources[0]!, id: "counting" });
    f.snapshot.coverage[0]!.timeComputation = {
      status: "verified",
      extendsWhenLastDayIsWeekend: true,
      extendsWhenLastDayIsHoliday: true,
      citation: "Synthetic counting fixture",
      excerpt: "Test only",
      sourceId: "counting",
      retrievedAt: "2026-10-08T00:00:00Z",
      note: "Synthetic fixture, not legal authority",
    };
    f.review.contextKey = reviewContextKey(f.snapshot, f.rule, f.input);
    const result = assessDeadline(f.snapshot, f.input, f.review);
    expect(result.status).toBe("baseline");
    expect(result.baseline.date).toBe("2026-05-02");
    expect(result.baseline.adjustedDate).toBeNull();
    expect(result.calendar?.adjustedDate).toBeNull();
    expect(result.calendar?.weekendNotice?.kind).toBe("scope_unverified");
  });

  it("does not extend an expressly fixed Sunday date as if it were an ordinary anniversary", () => {
    const f = fixture();
    f.snapshot.sources.push({ ...f.snapshot.sources[0]!, id: "counting" });
    f.snapshot.coverage[0]!.timeComputation = {
      status: "verified",
      extendsWhenLastDayIsWeekend: true,
      extendsWhenLastDayIsHoliday: true,
      citation: "Synthetic counting fixture",
      excerpt: "Test only",
      sourceId: "counting",
      retrievedAt: "2026-10-08T00:00:00Z",
      note: "Synthetic fixture, not legal authority",
    };
    f.review.contextKey = reviewContextKey(f.snapshot, f.rule, f.input);
    f.review.decisions["screen:tolling"] = {
      status: "instruction",
      instruction: {
        ...instruction,
        kind: "fixed_deadline",
        date: "2025-02-02",
      },
    };
    const result = assessDeadline(f.snapshot, f.input, f.review);
    expect(result.date).toBe("2025-02-02");
    expect(result.calendar?.adjustedDate).toBeNull();
  });
});
