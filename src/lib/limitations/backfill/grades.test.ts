import { describe, expect, it } from "vitest";
import type { LimitationRule } from "../types";
import { gradeRule, ruleFingerprint } from "./grades";

const rule = (over: Partial<LimitationRule> = {}): LimitationRule =>
  ({
    id: "r",
    jurisdiction: "TX",
    claimType: "personal_injury",
    ruleKind: "limitations",
    computation: "baseline_only",
    period: { amount: 2, unit: "calendar_years" },
    accrualBasis: "confirmed_accrual",
    effectiveFrom: null,
    effectiveThrough: null,
    sourceIds: ["b", "a"],
    pinpoint: "§ 1",
    conditions: ["x"],
    summary: "s",
    ruleVersion: "2026-10-06.1",
    ...over,
  }) as LimitationRule;

const base = { verifiedRuleVersion: "2026-10-06.1", verifiedOn: "2026-10-06", retry: undefined };

describe("rule fingerprint", () => {
  it("ignores descriptive wording and rule version but not substance", () => {
    const a = ruleFingerprint(rule());
    expect(
      ruleFingerprint(
        rule({ conditions: ["different"], summary: "other", ruleVersion: "2026-10-06.2" }),
      ),
    ).toBe(a);
    expect(ruleFingerprint(rule({ sourceIds: ["a", "b"] }))).toBe(a);
    expect(ruleFingerprint(rule({ period: { amount: 3, unit: "calendar_years" } }))).not.toBe(a);
    expect(ruleFingerprint(rule({ pinpoint: "§ 2" }))).not.toBe(a);
    expect(ruleFingerprint(rule({ computation: "research_only" }))).not.toBe(a);
  });
});

describe("verification grades", () => {
  const fp = "f".repeat(64);
  it("grades an unchanged confirmed rule as independently verified", () => {
    const g = gradeRule({
      ...base,
      fingerprint: fp,
      previousFingerprint: fp,
      verdict: { verdict: "confirmed" },
    });
    expect(g.verification.grade).toBe("independently_verified");
    expect(g.withhold).toBe(false);
  });
  it("downgrades a changed rule to the builder-only grade and says it awaits the delta check", () => {
    const g = gradeRule({
      ...base,
      fingerprint: fp,
      previousFingerprint: "0".repeat(64),
      verdict: { verdict: "confirmed" },
    });
    expect(g.verification.grade).toBe("official_capture_verified");
    expect(g.verification.basis).toContain("delta check");
  });
  it("grades a rule confirmed only on a cached-route retry as lower evidence", () => {
    const g = gradeRule({
      ...base,
      fingerprint: fp,
      previousFingerprint: fp,
      verdict: { verdict: "unable-to-verify" },
      retry: { retryVerdict: "confirmed" },
    });
    expect(g.verification.grade).toBe("lower_evidence_grade");
  });
  it("keeps unable-to-verify rules at the builder-only grade and still computes them", () => {
    const g = gradeRule({
      ...base,
      fingerprint: fp,
      previousFingerprint: fp,
      verdict: { verdict: "unable-to-verify" },
    });
    expect(g.verification.grade).toBe("official_capture_verified");
    expect(g.withhold).toBe(false);
  });
  it("withholds a rule disputed on content that has not changed", () => {
    const g = gradeRule({
      ...base,
      fingerprint: fp,
      previousFingerprint: fp,
      verdict: { verdict: "disputed", disputeKind: "rule-content" },
    });
    expect(g.withhold).toBe(true);
  });
  it("does not withhold a cell-mapping dispute (content was confirmed, the representation is what changed)", () => {
    const g = gradeRule({
      ...base,
      fingerprint: fp,
      previousFingerprint: fp,
      verdict: { verdict: "disputed", disputeKind: "cell-mapping" },
    });
    expect(g.withhold).toBe(false);
    expect(g.verification.grade).toBe("independently_verified");
  });
  it("grades builder-only rules read through an intermediary as lower evidence", () => {
    const g = gradeRule({
      ...base,
      fingerprint: fp,
      previousFingerprint: null,
      verdict: undefined,
      intermediaryOnly: true,
    });
    expect(g.verification.grade).toBe("lower_evidence_grade");
    const verified = gradeRule({
      ...base,
      fingerprint: fp,
      previousFingerprint: fp,
      verdict: { verdict: "confirmed" },
      intermediaryOnly: true,
    });
    expect(verified.verification.grade).toBe("independently_verified");
  });
  it("a rule the verifier never saw is builder-only", () => {
    const g = gradeRule({
      ...base,
      fingerprint: fp,
      previousFingerprint: null,
      verdict: undefined,
    });
    expect(g.verification.grade).toBe("official_capture_verified");
  });
});
