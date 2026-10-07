import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addCivilPeriod, calculateBaseline } from "./engine";
import type { BaselineInput, LimitationRule } from "./types";
import { validateLimitationsSnapshot } from "./validation";

const json = (name: string) =>
  JSON.parse(
    readFileSync(
      `${process.env["LIM_BUNDLE_DIR"] ?? "private/data/limitations"}/${name}.json`,
      "utf8",
    ),
  );
const snapshot = validateLimitationsSnapshot({
  rules: json("rules"),
  sources: json("sources"),
  coverage: json("coverage"),
  cases: json("case-references"),
});

const simple = (r: LimitationRule) =>
  r.computation === "baseline_only" &&
  (!r.calculation ||
    r.calculation.mode === "accrual_repose_min" ||
    r.calculation.mode === "clocks_min") &&
  !r.calculation?.deathCapYears;

function inputFor(rule: LimitationRule): BaselineInput {
  const floor = [
    rule.effectiveFrom,
    rule.calculation?.reposeEffectiveFrom,
    ...(rule.calculation?.clocks ?? []).map((c) => c.effectiveFrom),
    "2015-03-15",
  ]
    .filter((d): d is string => !!d)
    .sort()
    .at(-1)!;
  const accrual = floor > "2015-03-15" ? addCivilPeriod(floor, 1, "calendar_days")! : floor;
  return {
    jurisdiction: rule.jurisdiction,
    claimType: rule.claimType,
    ...(rule.subtype ? { subtype: rule.subtype } : {}),
    accrualDate: accrual,
    reposeActDate: accrual,
    firstProductDeliveryDate: accrual,
    injuryDate: accrual,
    substantialCompletionDate: accrual,
    actualDiscoveryDate: accrual,
    constructiveDiscoveryDate: accrual,
    reposeApplicabilityConfirmed: true,
    governingLawConfirmed: true,
    accrualConfirmed: true,
    applicabilityConfirmed: true,
    exceptionReview: "no_unresolved_issues",
    issues: [],
  };
}

describe("every simple baseline rule in the protected bundle", () => {
  const rules = snapshot.rules.filter(simple);

  it("has at least the rules this release is expected to carry", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it.each(rules.map((r) => [r.id, r] as const))("%s computes consistent date math", (_id, rule) => {
    const input = inputFor(rule);
    const result = calculateBaseline(snapshot, input);
    if (result.status !== "baseline") {
      // A withheld date must say why; the engine may never return a date without baseline status.
      expect(result.date).toBeNull();
      expect(result.reasons.length).toBeGreaterThan(0);
      return;
    }
    let expected: string | undefined;
    if (rule.calculation?.mode === "clocks_min") {
      const calc = rule.calculation;
      const ends = calc.limbs!.map((l) => addCivilPeriod(input.accrualDate, l.amount, l.unit)!);
      const combined =
        ends.length === 2
          ? calc.combine === "later"
            ? [...ends].sort()[1]
            : [...ends].sort()[0]
          : ends[0];
      const caps = (calc.clocks ?? []).map((c) =>
        addCivilPeriod(input.accrualDate, c.years, "calendar_years")!,
      );
      expected = [combined!, ...caps].sort()[0];
    } else {
      const ordinary = addCivilPeriod(input.accrualDate, rule.period!.amount, rule.period!.unit);
      const repose = rule.calculation?.reposeYears
        ? addCivilPeriod(
            rule.calculation.reposeTrigger === "first_delivery"
              ? input.firstProductDeliveryDate!
              : input.reposeActDate!,
            rule.calculation.reposeYears,
            "calendar_years",
          )
        : null;
      expected = [ordinary, repose].filter((d): d is string => d !== null).sort()[0];
    }
    expect(result.date).toBe(expected);
    expect(result.date! > input.accrualDate).toBe(true);
  });

  it("never issues a date for a research-only rule", () => {
    for (const rule of snapshot.rules.filter((r) => r.computation === "research_only")) {
      const result = calculateBaseline(snapshot, {
        ...inputFor(rule),
        subtype: rule.subtype ?? "general",
      });
      if (
        snapshot.rules.some(
          (r) =>
            r.jurisdiction === rule.jurisdiction &&
            r.claimType === rule.claimType &&
            (r.subtype ?? "general") === (rule.subtype ?? "general") &&
            r.computation === "baseline_only",
        )
      )
        continue;
      expect(result.date).toBeNull();
    }
  });

  it("every baseline rule cites a statute source with a recorded retrieval time", () => {
    for (const rule of snapshot.rules.filter((r) => r.computation === "baseline_only")) {
      const statute = rule.sourceIds
        .map((id) => snapshot.sources.find((s) => s.id === id))
        .find((s) => s?.authorityKind === "statute");
      expect(statute, rule.id).toBeTruthy();
      expect(Number.isFinite(Date.parse(statute!.capturedAt)), rule.id).toBe(true);
    }
  });
});
