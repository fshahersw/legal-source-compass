import { describe, expect, it } from "vitest";
import type { LimitationRule } from "../types";
import { claimCoverageFor } from "./cellCoverage";

const rule = (over: Partial<LimitationRule>): LimitationRule =>
  ({
    id: "r",
    claimType: "personal_injury",
    ruleKind: "limitations",
    computation: "research_only",
    period: { amount: 6, unit: "calendar_years" },
    ...over,
  }) as LimitationRule;

describe("claimCoverageFor", () => {
  it("shows the general rule, never a computing variant", () => {
    const rules = [
      rule({ id: "general", computation: "research_only" }),
      rule({
        id: "variant",
        subtype: "intentional_tort",
        computation: "baseline_only",
        period: { amount: 2, unit: "calendar_years" },
      }),
    ];
    const cell = claimCoverageFor(rules, "personal_injury", "none");
    expect(cell.status).toBe("research_only");
    expect(cell.ruleId).toBe("general");
    expect(cell.variants).toEqual([
      { subtype: "intentional_tort", ruleId: "variant", status: "baseline" },
    ]);
  });

  it("is a baseline only when the general rule computes", () => {
    const cell = claimCoverageFor(
      [rule({ id: "g", computation: "baseline_only" })],
      "personal_injury",
      "none",
    );
    expect(cell.status).toBe("baseline");
    expect(cell.variants).toBeUndefined();
  });

  it("marks a flagged general rule as flagged", () => {
    const flagged = rule({
      id: "g",
      provenance: { entryStatus: "flagged" } as unknown as NonNullable<
        LimitationRule["provenance"]
      >,
    });
    expect(claimCoverageFor([flagged], "personal_injury", "none").status).toBe("flagged");
  });

  it("is Not recorded when only variants exist, and says so", () => {
    const cell = claimCoverageFor(
      [rule({ id: "v", subtype: "foreign_object", computation: "baseline_only" })],
      "personal_injury",
      "No general rule recorded.",
    );
    expect(cell.status).toBe("not_recorded");
    expect(cell.ruleId).toBeUndefined();
    expect(cell.reason).toContain("narrow fact-pattern variants");
    expect(cell.variants?.[0]?.status).toBe("baseline");
  });

  it("appends the variants-only sentence once, even when a carried reason already has it", () => {
    const sentence =
      "Only narrow fact-pattern variants are recorded; none is treated as the claim type's rule.";
    const carried = `Publisher gated. ${sentence} ${sentence}`;
    const cell = claimCoverageFor(
      [rule({ id: "v", subtype: "foreign_object", computation: "baseline_only" })],
      "personal_injury",
      carried,
    );
    expect(cell.reason).toBe(`Publisher gated. ${sentence}`);
    expect(cell.reason!.split(sentence).length - 1).toBe(1);
    const plain = claimCoverageFor([rule({ claimType: "fraud" })], "personal_injury", carried);
    expect(plain.reason).toBe("Publisher gated.");
  });

  it("ignores rules of other claim types and non-limitations rule kinds", () => {
    const cell = claimCoverageFor(
      [rule({ claimType: "fraud" }), rule({ ruleKind: "repose" })],
      "personal_injury",
      "none",
    );
    expect(cell.status).toBe("not_recorded");
  });
});
