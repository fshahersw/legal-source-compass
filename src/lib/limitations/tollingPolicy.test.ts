import { describe, expect, it } from "vitest";
import { applyMinorityPolicy, validateTollingPolicies } from "./tollingPolicy";
import type { BaselineInput, BaselineResult, LimitationRule, LimitationsSnapshot } from "./types";
const policy = () => ({
  id: "minor-policy",
  kind: "minority_at_accrual",
  schemaVersion: "1.0.0",
  operation: "period_after_majority",
  period: { amount: 2, unit: "calendar_years" },
  reviewedOn: "2026-10-08",
  effectiveFrom: "2015-01-01",
  scopeRuleId: "r",
  jurisdiction: "IL",
  claimType: "personal_injury",
  subtype: "general",
  conditions: [
    "Only an ordinary private-party injury claim; no other disability or applicable exception.",
  ],
  evidence: [
    {
      sourceId: "s",
      sha256: "a".repeat(64),
      citation: "Test 13-211(a)",
      quote: "may bring the action within 2 years after",
    },
  ],
});
const fixture = () => {
  const r = {
    id: "r",
    jurisdiction: "IL",
    claimType: "personal_injury",
    subtype: "general",
    computation: "baseline_only",
    accrualBasis: "confirmed_accrual",
    ruleKind: "limitations",
    sourceIds: ["s"],
    period: { amount: 2, unit: "calendar_years" },
    tollingPolicies: [policy()],
  } as unknown as LimitationRule;
  const s = {
    snapshotDate: "2026-10-08",
    ruleVersion: "v",
    rules: [r],
    sources: [
      {
        id: "s",
        state: "IL",
        sha256: "a".repeat(64),
        verifiedAt: "2026-10-08T00:00:00Z",
        authorityKind: "statute",
      },
    ],
    coverage: [],
    cases: [],
  } as unknown as LimitationsSnapshot;
  return { r, s };
};
const input = {
  jurisdiction: "IL",
  claimType: "personal_injury",
  accrualDate: "2019-03-12",
  subtype: "general",
  governingLawConfirmed: true,
  accrualConfirmed: true,
  applicabilityConfirmed: true,
  exceptionReview: "no_unresolved_issues",
  issues: [],
} as BaselineInput;
const base = (r: LimitationRule) =>
  ({ status: "baseline", date: "2021-03-12", rule: r, reasons: [], steps: [] }) as BaselineResult;
const facts = () => ({
  policyId: "minor-policy",
  majorityDate: "2024-05-15",
  minorAtAccrual: true,
  majorityDateConfirmed: true,
  livingNoOtherDisability: true,
  ordinaryPrivateClaim: true,
  conditionsConfirmed: true,
});
describe("source-bound minority tolling policy", () => {
  it("rejects truthy strings as unconfirmed facts", () => {
    const { r, s } = fixture();
    expect(
      applyMinorityPolicy(s, input, base(r), {
        ...facts(),
        conditionsConfirmed: "false" as unknown as boolean,
      }).date,
    ).toBeNull();
  });
  it("will not apply a policy before its reviewed applicability window", () => {
    const { r, s } = fixture();
    expect(
      applyMinorityPolicy(s, { ...input, accrualDate: "2010-01-01" }, base(r), facts()).date,
    ).toBeNull();
  });

  it("extends only with a scoped, source-matched policy and confirmed factual predicates", () => {
    const { r, s } = fixture();
    validateTollingPolicies([r], s.sources);
    const out = applyMinorityPolicy(s, input, base(r), facts());
    expect(out.date).toBe("2026-05-15");
    expect(out.tollingApplied?.ordinaryDate).toBe("2021-03-12");
  });
  it.each([
    "minorAtAccrual",
    "majorityDateConfirmed",
    "livingNoOtherDisability",
    "ordinaryPrivateClaim",
    "conditionsConfirmed",
  ] as const)("withholds when %s is unconfirmed", (key) => {
    const { r, s } = fixture();
    expect(applyMinorityPolicy(s, input, base(r), { ...facts(), [key]: false }).date).toBeNull();
  });
  it("does not revive from a disability starting after accrual", () => {
    const { r, s } = fixture();
    expect(
      applyMinorityPolicy(s, input, base(r), { ...facts(), majorityDate: "2018-01-01" }).date,
    ).toBeNull();
  });
  it("does not silently clamp leap days", () => {
    const { r, s } = fixture();
    expect(
      applyMinorityPolicy(s, input, base(r), { ...facts(), majorityDate: "2024-02-29" }).date,
    ).toBeNull();
  });
  it("refuses an event later than source review or a lost source", () => {
    const { r, s } = fixture();
    expect(
      applyMinorityPolicy(s, input, base(r), { ...facts(), majorityDate: "2027-01-01" }).date,
    ).toBeNull();
    s.sources[0]!.currency = { status: "evidence_lost" } as never;
    expect(applyMinorityPolicy(s, input, base(r), facts()).date).toBeNull();
  });
  it("never applies to a repose or multi-clock calculation", () => {
    const { r, s } = fixture();
    r.calculation = { mode: "accrual_repose_min", reposeYears: 5 };
    expect(applyMinorityPolicy(s, input, base(r), facts()).date).toBeNull();
  });
  it("rejects a missing or forged policy and a mismatching source digest", () => {
    const { r, s } = fixture();
    expect(
      applyMinorityPolicy(s, input, base(r), { ...facts(), policyId: "absent" }).date,
    ).toBeNull();
    s.sources[0]!.sha256 = "b".repeat(64);
    expect(() => validateTollingPolicies([r], s.sources)).toThrow(/evidence/);
  });
  it("binds the policy to the exact rule, state and claim", () => {
    const { r, s } = fixture();
    r.tollingPolicies![0]!.scopeRuleId = "other";
    expect(() => validateTollingPolicies([r], s.sources)).toThrow(/scope/);
  });
  it("will not proceed from a blocked baseline", () => {
    const { r, s } = fixture();
    expect(
      applyMinorityPolicy(s, input, { ...base(r), status: "needs_review", date: null }, facts())
        .date,
    ).toBeNull();
  });
  it("does not shorten an existing period", () => {
    const { r, s } = fixture();
    expect(applyMinorityPolicy(s, input, { ...base(r), date: "2028-01-01" }, facts()).date).toBe(
      "2028-01-01",
    );
  });
});
