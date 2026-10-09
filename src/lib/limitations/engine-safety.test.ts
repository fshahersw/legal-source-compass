import { describe, expect, it } from "vitest";
import { addCivilPeriod, calculateBaseline } from "./engine";
import type { BaselineInput, LimitationRule, LimitationsSnapshot } from "./types";

/** Synthetic arithmetic fixtures, NOT a statement of Texas law or a publishable rule bundle. */
function fixture(mode: "ordinary" | "clocks" | "repose" = "ordinary") {
  const rule: LimitationRule = {
    id: "test-period",
    schemaVersion: "1.0.0",
    ruleVersion: "test-only",
    jurisdiction: "TX",
    claimType: "personal_injury",
    ruleKind: "limitations",
    computation: "baseline_only",
    reviewStatus: "statutory_text_verified",
    period: { amount: 2, unit: "calendar_years" },
    sourceIds: ["test-source"],
    pinpoint: "Synthetic period fixture",
    scope: "Synthetic test only",
    accrualBasis: "confirmed_accrual",
    conditions: [],
    exclusions: [],
    effectiveFrom: "1990-01-01",
    effectiveThrough: null,
    validity: "Test only",
    historicalApplicability: "Test only",
    summary: "Test only",
    warnings: [],
  };
  if (mode === "clocks")
    rule.calculation = {
      mode: "clocks_min",
      limbs: [{ amount: 2, unit: "calendar_years", from: "discovery" }],
      clocks: [],
    };
  if (mode === "repose")
    rule.calculation = {
      mode: "accrual_repose_min",
      reposeYears: 10,
      reposeTrigger: "act_or_omission",
      reposeEffectiveFrom: "1990-01-01",
    };
  const source = {
    id: "test-source",
    state: "TX",
    title: "Synthetic source",
    publisher: "Test fixture",
    url: "https://example.org/test-only",
    method: "Synthetic fixture",
    schemaVersion: "1.0.0",
    capturedAt: "2026-10-08T00:00:00Z",
    verifiedAt: "2026-10-08",
    textPath: "/test-only.txt",
    sha256: "0".repeat(64),
    byteLength: 1,
    authorityKind: "statute" as const,
    validity: "Test only",
    historicalApplicability: "Test only",
  };
  const snapshot: LimitationsSnapshot = {
    schemaVersion: "1.0.0",
    ruleVersion: "test-only",
    snapshotDate: "2026-10-08",
    reviewMeaning: "Synthetic fixture",
    dateMeaning: "Synthetic fixture",
    rules: [rule],
    sources: [source, { ...source, id: "test-counting" }],
    cases: [],
    coverage: [
      {
        state: "TX",
        name: "Texas",
        sourceStatus: "primary_text_retrieved",
        sourceIds: ["test-source", "test-counting"],
        baselineRuleIds: [rule.id],
        researchRuleIds: [],
        coverage: "conditional_baselines",
        discoverySource: "Synthetic fixture",
        discoveryLinks: [],
        gaps: [],
        publisherLinks: [],
        metadataOnlyReferences: [],
        timeComputation: {
          status: "verified",
          extendsWhenLastDayIsWeekend: true,
          extendsWhenLastDayIsHoliday: true,
          citation: "Synthetic counting fixture",
          excerpt: "Synthetic test only",
          sourceId: "test-counting",
          retrievedAt: "2026-10-08T00:00:00Z",
          note: "Synthetic test only",
        },
      },
    ],
  };
  const input: BaselineInput = {
    jurisdiction: "TX",
    claimType: "personal_injury",
    accrualDate: "2024-05-02",
    actualDiscoveryDate: "2024-05-02",
    constructiveDiscoveryDate: "2024-05-02",
    reposeActDate: "2016-05-03",
    reposeApplicabilityConfirmed: true,
    governingLawConfirmed: true,
    accrualConfirmed: true,
    applicabilityConfirmed: true,
    exceptionReview: "no_unresolved_issues",
    issues: [],
  };
  return { snapshot, rule, input };
}

describe("deadline safety at independent-clock and authority boundaries", () => {
  it("preserves a verified ordinary Saturday-to-Monday adjustment", () => {
    const { snapshot, input } = fixture();
    expect(calculateBaseline(snapshot, input).adjustedDate?.date).toBe("2026-05-04");
  });
  it("rejects a runtime period unit it does not implement", () => {
    expect(addCivilPeriod("2024-01-01", 2, "business_days" as never)).toBeNull();
  });
  for (const mode of ["repose", "clocks"] as const) {
    it(`does not move a limitation date past an independently recorded repose cutoff (${mode})`, () => {
      const { snapshot, rule, input } = fixture(mode);
      if (mode === "clocks")
        rule.calculation!.clocks = [
          { years: 10, from: "act_or_omission", effectiveFrom: "1990-01-01" },
        ];
      const result = calculateBaseline(snapshot, input);
      expect(result.date).toBe("2026-05-02");
      expect(result.adjustedDate).toBeNull();
      expect(result.weekendNotice?.kind).toBe("scope_unverified");
    });
  }
  it("does not move a controlling repose cutoff using only a limitations counting rule", () => {
    const { snapshot, input } = fixture("repose");
    const result = calculateBaseline(snapshot, {
      ...input,
      accrualDate: "2025-01-01",
      reposeActDate: "2016-05-02",
    });
    expect(result.date).toBe("2026-05-02");
    expect(result.adjustedDate).toBeNull();
  });
  it("keeps an ordinary weekend adjustment that does not cross an outer limit", () => {
    const { snapshot, input } = fixture("repose");
    expect(
      calculateBaseline(snapshot, { ...input, reposeActDate: "2017-01-01" }).adjustedDate?.date,
    ).toBe("2026-05-04");
  });
  for (const field of ["actualDiscoveryDate", "constructiveDiscoveryDate"] as const) {
    it(`reviews both discovery dates, not just their minimum (${field})`, () => {
      const { snapshot, input } = fixture("clocks");
      const result = calculateBaseline(snapshot, { ...input, [field]: "2028-01-01" });
      expect(result.status).toBe("needs_review");
      expect(result.date).toBeNull();
    });
  }
  for (const defect of [
    "missing",
    "wrong-state",
    "stale",
    "lost",
    "supporting-source-missing",
  ] as const) {
    it(`does not extend using an unsupported counting authority (${defect})`, () => {
      const { snapshot, input } = fixture();
      const counting = snapshot.sources[1]!;
      if (defect === "missing") snapshot.sources.pop();
      if (defect === "wrong-state") counting.state = "CA";
      if (defect === "stale") counting.verifiedAt = "2023-01-01";
      if (defect === "lost")
        counting.currency = {
          checkedAt: "2026-10-08T00:00:00Z",
          status: "evidence_lost",
          route: "direct",
          detail: "Synthetic missing evidence",
        };
      if (defect === "supporting-source-missing")
        snapshot.coverage[0]!.timeComputation!.supportingSourceIds = ["missing-support"];
      const result = calculateBaseline(snapshot, input);
      expect(result.adjustedDate).toBeNull();
      expect(result.weekendNotice?.kind).toBe("source_unverified");
    });
  }
  it("cites the counting authority on the calculation step that applies it", () => {
    const { snapshot, input } = fixture();
    expect(calculateBaseline(snapshot, input).steps.at(-1)?.sourceIds).toContain("test-counting");
  });
  for (const mode of ["ordinary", "clocks"] as const) {
    it(`withholds a baseline after required source evidence is lost (${mode})`, () => {
      const { snapshot, input } = fixture(mode);
      snapshot.sources[0]!.currency = {
        checkedAt: "2026-10-08T00:00:00Z",
        status: "evidence_lost",
        route: "direct",
        detail: "Synthetic missing evidence",
      };
      expect(calculateBaseline(snapshot, input).date).toBeNull();
    });
  }
});
