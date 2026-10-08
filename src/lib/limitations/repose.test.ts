import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateBaseline } from "./engine";
import type { BaselineInput, LimitationsSnapshot } from "./types";
import { validateLimitationsSnapshot } from "./validation";

const bundleDir = process.env["LIM_BUNDLE_DIR"] ?? "private/data/limitations";
const json = (name: string) =>
  JSON.parse(readFileSync(`${bundleDir}/${name}.json`, "utf8"));
const files = () => ({
  rules: json("rules"),
  sources: json("sources"),
  coverage: json("coverage"),
  cases: json("case-references"),
});

// Exercise proposed arithmetic against the retained authorities without activating bundle rules.
function candidate(jurisdiction: "NC" | "OR") {
  const input = files();
  const rule = input.rules.rules.find(
    (r: { jurisdiction: string; claimType: string }) =>
      r.jurisdiction === jurisdiction && r.claimType === "personal_injury",
  );
  rule.computation = "baseline_only";
  rule.accrualBasis = "confirmed_accrual";
  rule.period = { amount: jurisdiction === "NC" ? 3 : 2, unit: "calendar_years" };
  rule.calculation = {
    mode: "accrual_repose_min",
    reposeYears: 10,
    reposeTrigger: jurisdiction === "NC" ? "last_act_or_omission" : "act_or_omission",
    // Synthetic test window only; no production rule or statutory start date is asserted.
    reposeEffectiveFrom: "2000-01-01",
  };
  const coverage = input.coverage.coverage.find((r: { state: string }) => r.state === jurisdiction);
  // Keep every other recorded baseline link intact; only this rule's membership is adjusted.
  coverage.baselineRuleIds = Array.from(new Set([...coverage.baselineRuleIds, rule.id]));
  coverage.researchRuleIds = coverage.researchRuleIds.filter((id: string) => id !== rule.id);
  coverage.coverage = "conditional_baselines";
  return input;
}

const reviewed: BaselineInput = {
  jurisdiction: "NC",
  claimType: "personal_injury",
  accrualDate: "2025-05-01",
  reposeActDate: "2016-05-01",
  reposeApplicabilityConfirmed: true,
  governingLawConfirmed: true,
  accrualConfirmed: true,
  applicabilityConfirmed: true,
  exceptionReview: "no_unresolved_issues",
  issues: [],
};
const snapshot = (state: "NC" | "OR") => validateLimitationsSnapshot(candidate(state));

describe("separate accrual and repose cutoffs", () => {
  it.each(["NC", "OR"] as const)(
    "%s respects the earlier outer cutoff rather than extending it from discovery",
    (state) => {
      const result = calculateBaseline(snapshot(state), { ...reviewed, jurisdiction: state });
      expect(result.status).toBe("baseline");
      expect(result.date).toBe("2026-05-01");
      expect(
        result.steps.some((step) => step.text.includes("separate 10-year repose cutoff")),
      ).toBe(true);
    },
  );

  it("a later repose cutoff cannot extend either ordinary limitation period", () => {
    expect(
      calculateBaseline(snapshot("NC"), { ...reviewed, reposeActDate: "2024-05-01" }).date,
    ).toBe("2028-05-01");
    expect(
      calculateBaseline(snapshot("OR"), {
        ...reviewed,
        jurisdiction: "OR",
        reposeActDate: "2024-05-01",
      }).date,
    ).toBe("2027-05-01");
  });

  it("requires a separately confirmed repose rule and valid act date", () => {
    expect(
      calculateBaseline(snapshot("NC"), { ...reviewed, reposeApplicabilityConfirmed: false }).date,
    ).toBeNull();
    const unconfirmed = { ...reviewed };
    delete unconfirmed.reposeApplicabilityConfirmed;
    expect(calculateBaseline(snapshot("NC"), unconfirmed).date).toBeNull();
    const missingDate = { ...reviewed };
    delete missingDate.reposeActDate;
    expect(calculateBaseline(snapshot("NC"), missingDate).status).toBe("invalid");
    for (const reposeActDate of ["", "2024-02-30"]) {
      expect(calculateBaseline(snapshot("NC"), { ...reviewed, reposeActDate }).status).toBe(
        "invalid",
      );
    }
  });

  it("does not restart repose from a later event or present a post-repose accrual period", () => {
    const later = calculateBaseline(snapshot("NC"), { ...reviewed, reposeActDate: "2026-05-01" });
    expect(later.date).toBeNull();
    expect(later.reasons.join(" ")).toContain("does not automatically restart repose");
    const expired = calculateBaseline(snapshot("OR"), {
      ...reviewed,
      jurisdiction: "OR",
      reposeActDate: "2010-05-01",
    });
    expect(expired.status).toBe("needs_review");
    expect(expired.date).toBeNull();
    expect(expired.reasons.join(" ")).toContain("2020-05-01");
  });

  it("fails closed for an unresolved leap-day cap, later-than-reviewed date, or special issue", () => {
    expect(
      calculateBaseline(snapshot("NC"), { ...reviewed, reposeActDate: "2020-02-29" }).date,
    ).toBeNull();
    expect(
      calculateBaseline(snapshot("NC"), { ...reviewed, reposeActDate: "2027-01-01" }).date,
    ).toBeNull();
    expect(
      calculateBaseline(snapshot("NC"), { ...reviewed, issues: ["latent_exposure"] }).date,
    ).toBeNull();
  });

  it("rejects incomplete or mixed cap configuration before it can calculate", () => {
    const invalid = candidate("NC");
    const rule = invalid.rules.rules.find(
      (r: { id: string }) => r.id === "nc-limitations-1-20261002",
    );
    delete rule.calculation.reposeYears;
    expect(() => validateLimitationsSnapshot(invalid)).toThrow(/positive integer/);
    rule.calculation.reposeYears = 10;
    delete rule.calculation.reposeEffectiveFrom;
    expect(() => validateLimitationsSnapshot(invalid)).toThrow(/reposeEffectiveFrom/);
    rule.calculation.reposeEffectiveFrom = "2000-01-01";
    rule.calculation.reposeEffectiveThrough = "1999-12-31";
    expect(() => validateLimitationsSnapshot(invalid)).toThrow(/reversed repose/);
    delete rule.calculation.reposeEffectiveThrough;
    rule.calculation.reposeTrigger = "latest_event";
    expect(() => validateLimitationsSnapshot(invalid)).toThrow(/unsupported accrual\/repose/);
    rule.calculation.reposeTrigger = "last_act_or_omission";
    rule.calculation.deathCapYears = 2;
    expect(() => validateLimitationsSnapshot(invalid)).toThrow(/unsupported accrual\/repose/);
    const unvalidated: LimitationsSnapshot = {
      ...invalid.rules,
      sources: invalid.sources.sources,
      coverage: invalid.coverage.coverage,
      cases: invalid.cases.cases,
    };
    expect(calculateBaseline(unvalidated, reviewed).date).toBeNull();
  });

  it("checks repose history independently from an in-range accrual date", () => {
    const input = candidate("NC");
    const rule = input.rules.rules.find(
      (r: { id: string }) => r.id === "nc-limitations-1-20261002",
    );
    rule.effectiveFrom = "2020-01-01";
    rule.calculation.reposeEffectiveFrom = "2017-01-01";
    rule.calculation.reposeEffectiveThrough = "2020-12-31";
    const data = validateLimitationsSnapshot(input);
    const before = calculateBaseline(data, reviewed);
    expect(before.status).toBe("needs_review");
    expect(before.date).toBeNull();
    expect(before.reasons.join(" ")).toContain("predates 2017-01-01");
    const after = calculateBaseline(data, { ...reviewed, reposeActDate: "2021-01-01" });
    expect(after.status).toBe("needs_review");
    expect(after.reasons.join(" ")).toContain("follows 2020-12-31");
    expect(calculateBaseline(data, { ...reviewed, reposeActDate: "2017-01-01" }).date).toBe(
      "2027-01-01",
    );
    expect(calculateBaseline(data, { ...reviewed, reposeActDate: "2020-12-31" }).date).toBe(
      "2028-05-01",
    );
  });

  it("the actual protected NC and OR bundles issue dates only with a separately confirmed repose act", () => {
    const actual = validateLimitationsSnapshot(files());
    for (const jurisdiction of ["NC", "OR"]) {
      const withoutRepose = calculateBaseline(actual, {
        ...reviewed,
        jurisdiction,
        reposeApplicabilityConfirmed: false,
      });
      expect(withoutRepose.status).toBe("needs_review");
      expect(withoutRepose.date).toBeNull();
      const confirmed = calculateBaseline(actual, { ...reviewed, jurisdiction });
      expect(confirmed.status).toBe("baseline");
      expect(confirmed.date).toBe("2026-05-01");
    }
  });
});
