import { describe, expect, it } from "vitest";
import {
  exceptionInventory,
  assessExceptions,
  SCREENING_QUESTIONS,
  reviewContextKey,
} from "./exceptionReview";
import type { LimitationRule, LimitationsSnapshot } from "./types";
const rule = (extra: Partial<LimitationRule> = {}) =>
  ({
    id: "il-rule",
    jurisdiction: "IL",
    claimType: "personal_injury",
    ruleKind: "limitations",
    computation: "baseline_only",
    ruleVersion: "v1",
    period: { amount: 2, unit: "calendar_years" },
    sourceIds: ["s"],
    pinpoint: "Test statute",
    scope: "Ordinary test",
    conditions: [],
    exclusions: [],
    warnings: [],
    ...extra,
  }) as LimitationRule;
const snapshot = (r: LimitationRule) =>
  ({
    ruleVersion: "v1",
    rules: [r],
    sources: [],
    coverage: [],
    cases: [],
  }) as unknown as LimitationsSnapshot;
const no = () =>
  Object.fromEntries(SCREENING_QUESTIONS.map((q) => [q.id, "no"])) as Record<string, "no">;
describe("recorded exception inventory and explicit screening", () => {
  it("does not lose tolling hidden in cross-check conditions", () => {
    const r = rule({
      conditions: ["Related provision or cross-check: infancy extends time under CPLR 208."],
      exclusions: ["Unusual local doctrine requiring review."],
    });
    const items = exceptionInventory(snapshot(r), r);
    expect(items.some((x) => x.text.includes("infancy") && x.categories.includes("minority"))).toBe(
      true,
    );
    expect(
      items.some((x) => x.text.includes("Unusual local") && x.categories.includes("other")),
    ).toBe(true);
  });
  it("keeps every original note with an address, including repeats", () => {
    const r = rule({
      conditions: ["same", "same"],
      exclusions: ["exclude"],
      warnings: ["warn"],
      provenance: {
        tolling: [{ text: "time paused", citation: "§ 2" }],
        repose: [{ years: 3, trigger: "last act", effectiveFrom: null, citation: "§ 3" }],
        flags: ["review me"],
      } as unknown as NonNullable<LimitationRule["provenance"]>,
    });
    const items = exceptionInventory(snapshot(r), r);
    expect(items).toHaveLength(7);
    expect(new Set(items.map((x) => x.id)).size).toBe(7);
    expect(items.find((x) => x.kind === "tolling")?.citation).toBe("§ 2");
  });
  it("never treats an unanswered question as a negative answer", () => {
    const r = rule();
    const a = assessExceptions(snapshot(r), r, {});
    expect(a.ready).toBe(false);
    expect(a.unanswered).toHaveLength(SCREENING_QUESTIONS.length);
  });
  it("requires legal review for an affirmative or uncertain unsupported issue", () => {
    const r = rule();
    expect(assessExceptions(snapshot(r), r, { ...no(), bankruptcy: "yes" }).ready).toBe(false);
    expect(assessExceptions(snapshot(r), r, { ...no(), other: "unsure" }).ready).toBe(false);
  });
  it("records explicit negatives without asserting comprehensive law coverage", () => {
    const r = rule();
    const a = assessExceptions(snapshot(r), r, no());
    expect(a.ready).toBe(true);
    expect(a.comprehensiveLawReview).toBe(false);
  });
  it("allows only an expressly released policy to resolve a positive minority screen", () => {
    const r = rule();
    expect(assessExceptions(snapshot(r), r, { ...no(), minority: "yes" }).ready).toBe(false);
  });
  it("binds confirmations to release, rule and dates", () => {
    const r = rule();
    expect(reviewContextKey(snapshot(r), r, { accrualDate: "2020-01-01" })).not.toBe(
      reviewContextKey(snapshot(r), r, { accrualDate: "2020-01-02" }),
    );
    expect(reviewContextKey(snapshot(r), r, {})).not.toBe(
      reviewContextKey({ ...snapshot(r), ruleVersion: "v2" }, r, {}),
    );
  });
});
