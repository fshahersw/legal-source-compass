import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { calculateGuided, assessmentExport } from "./guidedAssessment";
import { exceptionInventory, reviewContextKey, SCREENING_QUESTIONS } from "./exceptionReview";
import { validateLimitationsSnapshot } from "./validation";
import type { BaselineInput } from "./types";
const dir = process.env["LIM_BUNDLE_DIR"] ?? "private/data/limitations";
const load = (name: string) => JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
const snapshot = validateLimitationsSnapshot({
  rules: load("rules"),
  sources: load("sources"),
  coverage: load("coverage"),
  cases: load("case-references"),
});
const rule = snapshot.rules.find(
  (r) =>
    r.jurisdiction === "CA" &&
    r.claimType === "personal_injury" &&
    (r.subtype ?? "general") === "general",
)!;
const input: BaselineInput = {
  jurisdiction: "CA",
  claimType: "personal_injury",
  subtype: "general",
  accrualDate: "2024-01-10",
  governingLawConfirmed: true,
  accrualConfirmed: true,
  applicabilityConfirmed: true,
  exceptionReview: "unresolved",
  issues: [],
};
const answers = Object.fromEntries(SCREENING_QUESTIONS.map((q) => [q.id, "no"])) as Record<
  string,
  "no"
>;
const review = {
  answers,
  contextKey: reviewContextKey(snapshot, rule, input),
  recordedQualificationsReviewed: true,
};
describe("guided assessment against the real release", () => {
  it("accounts for every stored note in every rule without dropping unknown categories", () => {
    for (const r of snapshot.rules) {
      const expected =
        r.conditions.length +
        r.exclusions.length +
        r.warnings.length +
        (r.provenance?.tolling?.length ?? 0) +
        (r.provenance?.repose?.length ?? 0) +
        (r.provenance?.flags?.length ?? 0);
      const rows = exceptionInventory(snapshot, r);
      expect(rows).toHaveLength(expected);
      expect(rows.every((x) => x.categories.length > 0)).toBe(true);
    }
  });
  it("computes the same baseline only after explicit review", () =>
    expect(calculateGuided(snapshot, input, review).date).toBe("2026-01-10"));
  it("blocks stale facts and release fingerprints", () =>
    expect(
      calculateGuided(snapshot, { ...input, accrualDate: "2024-02-10" }, review).date,
    ).toBeNull());
  it("does not automatically toll bankruptcy, MDL, or an unresolved exception", () => {
    for (const id of ["bankruptcy", "class_action", "other"] as const) {
      expect(
        calculateGuided(snapshot, input, { ...review, answers: { ...answers, [id]: "yes" } }).date,
      ).toBeNull();
    }
  });
  it("does not turn unrecorded minority policies into a guessed date", () => {
    if (!rule.tollingPolicies?.length)
      expect(
        calculateGuided(snapshot, input, { ...review, answers: { ...answers, minority: "yes" } })
          .date,
      ).toBeNull();
  });
  it("exports all qualifications, scope and non-final status", () => {
    const out = assessmentExport(snapshot, input, review, calculateGuided(snapshot, input, review));
    expect(out.recordedQualifications.length).toBeGreaterThan(0);
    expect(out.verifiedFilingDeadline).toBe(false);
    expect(out.screening).toHaveLength(SCREENING_QUESTIONS.length);
  });
});
