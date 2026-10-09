import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { addMinorityPolicies } from "./minorityPolicies";
import { validateLimitationsSnapshot } from "../validation";
import { calculateGuided } from "../guidedAssessment";
import { SCREENING_QUESTIONS, reviewContextKey } from "../exceptionReview";
import type { BaselineInput } from "../types";
const dir = process.env["LIM_BUNDLE_DIR"] ?? "private/data/limitations";
const read = (name: string) => JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
const data = validateLimitationsSnapshot({
  rules: read("rules"),
  sources: read("sources"),
  coverage: read("coverage"),
  cases: read("case-references"),
});
const text = new Map(
  data.sources.map((s) => [
    s.id,
    readFileSync(`${dir}/${s.textPath.replace("/data/limitations/", "")}`, "utf8"),
  ]),
);
describe("literal-evidence minority policy construction", () => {
  it("adds exactly three scoped policies without changing periods, historical windows or other rules", () => {
    const { snapshot, changes } = addMinorityPolicies(data, text, "2026-10-09");
    expect(changes).toHaveLength(3);
    for (let i = 0; i < data.rules.length; i++) {
      const old = data.rules[i]!,
        next = snapshot.rules[i]!;
      const { tollingPolicies, ...rest } = next;
      const { tollingPolicies: _priorPolicies, ...oldRest } = old;
      expect(rest).toEqual(oldRest);
      if (_priorPolicies) expect(tollingPolicies).toEqual(_priorPolicies);
      if (tollingPolicies) expect(["CA", "NY", "IL"]).toContain(next.jurisdiction);
    }
    expect(snapshot.sources).toEqual(data.sources);
    expect(snapshot.coverage).toEqual(data.coverage);
  });
  it("will not build from changed or absent evidence", () => {
    const altered = new Map(text);
    altered.set("bf-il-13-211", "altered");
    expect(() => addMinorityPolicies(data, altered, "2026-10-09")).toThrow(/hash|evidence/);
  });
  it.each([
    ["CA", 2],
    ["IL", 2],
    ["NY", 3],
  ] as const)("applies the source-bound ordinary minority path in %s", (state, years) => {
    const { snapshot } = addMinorityPolicies(data, text, "2026-10-09");
    const rule = snapshot.rules.find(
      (r) =>
        r.jurisdiction === state &&
        r.claimType === "personal_injury" &&
        (r.subtype ?? "general") === "general",
    )!;
    const input: BaselineInput = {
      jurisdiction: state,
      claimType: "personal_injury",
      subtype: "general",
      accrualDate: "2019-03-12",
      governingLawConfirmed: true,
      accrualConfirmed: true,
      applicabilityConfirmed: true,
      exceptionReview: "unresolved",
      issues: [],
    };
    const answers = Object.fromEntries(
      SCREENING_QUESTIONS.map((q) => [q.id, q.id === "minority" ? "yes" : "no"]),
    ) as Record<string, "yes" | "no">;
    const result = calculateGuided(snapshot, input, {
      answers,
      contextKey: reviewContextKey(snapshot, rule, input),
      recordedQualificationsReviewed: true,
      minority: {
        policyId: rule.tollingPolicies![0]!.id,
        majorityDate: "2024-05-15",
        minorAtAccrual: true,
        majorityDateConfirmed: true,
        livingNoOtherDisability: true,
        ordinaryPrivateClaim: true,
        conditionsConfirmed: true,
      },
    });
    expect(result.date).toBe(`${2024 + years}-05-15`);
    expect(result.tollingApplied?.sourceIds.length).toBeGreaterThan(0);
  });
});
