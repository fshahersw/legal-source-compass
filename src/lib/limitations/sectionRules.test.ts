import { describe, expect, it } from "vitest";
import { rulesCitingSection } from "./sectionRules";
import type { LimitationRule, LimitationSource } from "./types";

const rule = (over: Partial<LimitationRule>): LimitationRule =>
  ({
    id: "r",
    jurisdiction: "PA",
    claimType: "personal_injury",
    ruleKind: "limitations",
    computation: "baseline_only",
    period: { amount: 2, unit: "calendar_years" },
    sourceIds: [],
    pinpoint: "42 Pa.C.S. § 5524(2)",
    effectiveFrom: null,
    effectiveThrough: null,
    summary: "two years",
    ...over,
  }) as unknown as LimitationRule;

const source = (over: Partial<LimitationSource>): LimitationSource =>
  ({ id: "s", state: "PA", ...over }) as unknown as LimitationSource;

describe("rulesCitingSection", () => {
  it("links a rule only when its pinpoint names exactly this section", () => {
    const snapshot = {
      rules: [
        rule({ id: "a" }),
        rule({ id: "b", pinpoint: "42 Pa.C.S. § 5524.1" }),
        rule({ id: "c", jurisdiction: "NY", pinpoint: "CPLR 214" }),
      ],
      sources: [],
    };
    const links = rulesCitingSection(snapshot, "PA", "PA:42:5524");
    expect(links.map((l) => l.ruleId)).toEqual(["a"]);
    expect(links[0]).toMatchObject({
      matchedBy: ["citation"],
      period: "2 calendar years",
      claimLabel: expect.any(String),
    });
    expect(rulesCitingSection(snapshot, "PA", "PA:42:5524.1").map((l) => l.ruleId)).toEqual(["b"]);
    expect(rulesCitingSection(snapshot, "NY", "NY:CVP/214").map((l) => l.ruleId)).toEqual(["c"]);
  });

  it("links through a recorded code-capture recheck and reports both routes", () => {
    const snapshot = {
      rules: [rule({ id: "a", sourceIds: ["s1"] }), rule({ id: "b", pinpoint: "Pa. R.C.P. 1042.3", sourceIds: ["s1"] })],
      sources: [
        source({
          id: "s1",
          currency: {
            checkedAt: "2026-10-08T00:00:00.000Z",
            status: "confirmed_evidence_intact",
            route: "official_code_capture",
            detail: "d",
            codeCapture: {
              jurisdiction: "PA",
              publisher: "x",
              runId: null,
              manifestSha256: null,
              landedAt: null,
              sectionNativeIds: ["PA:42:5524"],
              sourceUrls: [],
            },
          },
        }),
      ],
    };
    const links = rulesCitingSection(snapshot, "PA", "PA:42:5524");
    expect(links.map((l) => [l.ruleId, l.matchedBy])).toEqual([
      ["a", ["citation", "captured_text"]],
      ["b", ["captured_text"]],
    ]);
  });

  it("never matches by heading, chapter or a neighbouring number", () => {
    const snapshot = { rules: [rule({ id: "a", pinpoint: "42 Pa.C.S. § 5524" })], sources: [] };
    expect(rulesCitingSection(snapshot, "PA", "PA:42:5525")).toEqual([]);
    expect(rulesCitingSection(snapshot, "PA", "PA:42")).toEqual([]);
    expect(rulesCitingSection(snapshot, "PA", "PA:5524")).toEqual([]);
  });
});
