import { describe, expect, it } from "vitest";
import { filterReviewFactors, nextReviewFactor, acknowledgeUnanswered } from "./reviewNavigation";
import type { ReviewDecisions, ReviewFactor } from "./reviewInventory";
const factors: ReviewFactor[] = [
  {
    id: "one",
    label: "Minority",
    text: "Printed minority note",
    citation: "Fixture § 2",
    kind: "tolling",
    group: "tolling",
    origins: ["one"],
    ruleSourceIds: [],
    instructionAllowed: true,
  },
  {
    id: "two",
    label: "Independent cap",
    text: "Printed repose note",
    citation: "Fixture § 3",
    kind: "repose",
    group: "tolling",
    origins: ["two"],
    ruleSourceIds: [],
    instructionAllowed: false,
  },
  {
    id: "three",
    label: "Prior filing",
    text: "Check an earlier action",
    citation: null,
    kind: "screen",
    group: "screening",
    origins: ["three"],
    ruleSourceIds: [],
    instructionAllowed: true,
  },
];
describe("review navigation does not change legal decisions", () => {
  it("finds the next unresolved factor, wrapping without skipping a flagged item", () => {
    const decisions: ReviewDecisions = {
      one: { status: "no_effect" },
      two: { status: "needs_review" },
    };
    expect(nextReviewFactor(factors, decisions)?.id).toBe("two");
    expect(nextReviewFactor(factors, decisions, "two")?.id).toBe("three");
    expect(nextReviewFactor(factors, decisions, "three")?.id).toBe("two");
  });
  it("finds no pending item only when every factor is genuinely resolved", () => {
    expect(
      nextReviewFactor(
        factors,
        Object.fromEntries(factors.map((f) => [f.id, { status: "no_effect" }])),
      ),
    ).toBeNull();
  });
  it("matches literal words in a citation, note or label without regular expressions", () => {
    expect(filterReviewFactors(factors, {}, "fixture 3", "all").map((f) => f.id)).toEqual(["two"]);
    expect(filterReviewFactors(factors, {}, "[.*", "all")).toEqual([]);
  });
  it("keeps incomplete instructions in the attention filter", () => {
    const decisions: ReviewDecisions = {
      one: { status: "instruction" },
      two: { status: "no_effect" },
    };
    expect(filterReviewFactors(factors, decisions, "", "attention").map((f) => f.id)).toEqual([
      "one",
      "three",
    ]);
    expect(filterReviewFactors(factors, decisions, "", "instructions").map((f) => f.id)).toEqual([
      "one",
    ]);
  });
  it("does not clear a flagged note or instruction when acknowledging unanswered items", () => {
    const decisions: ReviewDecisions = {
      one: { status: "instruction" },
      two: { status: "needs_review", note: "Keep this issue" },
    };
    const before = structuredClone(decisions);
    const next = acknowledgeUnanswered(factors, decisions, "screening");
    expect(next["three"]?.status).toBe("no_effect");
    expect(next["one"]).toEqual(before["one"]);
    expect(next["two"]).toEqual(before["two"]);
    expect(decisions).toEqual(before);
    expect(next["three"]?.note).toMatch(/explicit|reviewed/i);
  });
});
