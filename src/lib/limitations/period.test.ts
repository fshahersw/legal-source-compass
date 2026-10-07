import { describe, expect, it } from "vitest";
import {
  addCivilPeriod,
  calculateBaseline,
  civilWeekday,
  nextWeekday,
  periodLabel,
} from "./engine";
import type {
  BaselineInput,
  ClaimType,
  LimitationRule,
  LimitationSource,
  LimitationsSnapshot,
  PeriodUnit,
} from "./types";
import { validateLimitationsSnapshot } from "./validation";

const STATES =
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " ",
  );

function source(state: string): LimitationSource {
  return {
    id: `${state.toLowerCase()}-src`,
    state,
    title: "Test statute",
    publisher: "Test legislature",
    url: `https://legislature.example.gov/${state}`,
    method: "test",
    schemaVersion: "1.0.0",
    capturedAt: "2026-10-05T00:00:00.000Z",
    verifiedAt: "2026-10-05T00:00:00.000Z",
    textPath: `/data/limitations/text/${state.toLowerCase()}-src.txt`,
    sha256: "a".repeat(64),
    byteLength: 10,
    authorityKind: "statute",
    validity: "test",
    historicalApplicability: "test",
  };
}

function rule(
  claimType: ClaimType,
  amount: number,
  unit: PeriodUnit,
  extra: Partial<LimitationRule> = {},
): LimitationRule {
  return {
    id: `tx-${claimType}`,
    schemaVersion: "1.0.0",
    ruleVersion: "test",
    jurisdiction: "TX",
    claimType,
    ruleKind: "limitations",
    computation: "baseline_only",
    reviewStatus: "statutory_text_verified",
    period: { amount, unit },
    sourceIds: ["tx-src"],
    pinpoint: "Test § 1",
    scope: "test",
    accrualBasis: "confirmed_accrual",
    conditions: [],
    exclusions: [],
    effectiveFrom: null,
    effectiveThrough: null,
    validity: "test",
    historicalApplicability: "test",
    summary: "test",
    warnings: [],
    ...extra,
  };
}

function snapshotWith(rules: LimitationRule[]): LimitationsSnapshot {
  const sources = STATES.map(source);
  return validateLimitationsSnapshot({
    rules: {
      schemaVersion: "1.0.0",
      snapshotDate: "2026-10-05",
      ruleVersion: "t",
      reviewMeaning: "t",
      dateMeaning: "t",
      rules,
    },
    sources: { schemaVersion: "1.0.0", snapshotDate: "2026-10-05", sources },
    cases: { schemaVersion: "1.0.0", snapshotDate: "2026-10-05", referenceMeaning: "t", cases: [] },
    coverage: {
      schemaVersion: "1.0.0",
      snapshotDate: "2026-10-05",
      coverage: STATES.map((state) => ({
        state,
        name: state,
        sourceStatus: "primary_text_retrieved",
        sourceIds: [`${state.toLowerCase()}-src`],
        baselineRuleIds: rules
          .filter((r) => r.jurisdiction === state && r.computation === "baseline_only")
          .map((r) => r.id),
        researchRuleIds: rules
          .filter((r) => r.jurisdiction === state && r.computation === "research_only")
          .map((r) => r.id),
        coverage: rules.some((r) => r.jurisdiction === state && r.computation === "baseline_only")
          ? "conditional_baselines"
          : "research_only",
        discoverySource: "https://legislature.example.gov/",
        discoveryLinks: [],
        gaps: ["test"],
        publisherLinks: [],
        metadataOnlyReferences: [],
      })),
    },
  });
}

const input = (
  claimType: ClaimType,
  accrualDate: string,
  extra: Partial<BaselineInput> = {},
): BaselineInput => ({
  jurisdiction: "TX",
  claimType,
  accrualDate,
  governingLawConfirmed: true,
  accrualConfirmed: true,
  applicabilityConfirmed: true,
  exceptionReview: "no_unresolved_issues",
  issues: [],
  ...extra,
});

describe("civil period arithmetic", () => {
  it("adds calendar years and refuses a missing leap-day anniversary", () => {
    expect(addCivilPeriod("2024-05-01", 2, "calendar_years")).toBe("2026-05-01");
    expect(addCivilPeriod("2024-02-29", 4, "calendar_years")).toBe("2028-02-29");
    expect(addCivilPeriod("2024-02-29", 1, "calendar_years")).toBeNull();
  });

  it("adds calendar months, crossing years, and refuses a nonexistent target day", () => {
    expect(addCivilPeriod("2025-11-15", 3, "calendar_months")).toBe("2026-02-15");
    expect(addCivilPeriod("2025-12-31", 12, "calendar_months")).toBe("2026-12-31");
    expect(addCivilPeriod("2025-08-31", 6, "calendar_months")).toBeNull();
    expect(addCivilPeriod("2025-08-28", 6, "calendar_months")).toBe("2026-02-28");
  });

  it("adds exact days across month, year and leap-year boundaries", () => {
    expect(addCivilPeriod("2025-12-31", 1, "calendar_days")).toBe("2026-01-01");
    expect(addCivilPeriod("2024-02-28", 2, "calendar_days")).toBe("2024-03-01");
    expect(addCivilPeriod("2025-02-28", 2, "calendar_days")).toBe("2025-03-02");
    expect(addCivilPeriod("2026-01-01", 365, "calendar_days")).toBe("2027-01-01");
    expect(addCivilPeriod("2026-01-01", 180, "calendar_days")).toBe("2026-06-30");
  });

  it("rejects invalid input instead of guessing", () => {
    expect(addCivilPeriod("2025-02-30", 1, "calendar_days")).toBeNull();
    expect(addCivilPeriod("2025-01-01", 0, "calendar_days")).toBeNull();
    expect(addCivilPeriod("2025-01-01", 1.5, "calendar_months")).toBeNull();
    expect(addCivilPeriod("not-a-date", 1, "calendar_years")).toBeNull();
  });

  it("labels periods in their own unit", () => {
    expect(periodLabel({ amount: 1, unit: "calendar_years" })).toBe("1 calendar year");
    expect(periodLabel({ amount: 6, unit: "calendar_months" })).toBe("6 calendar months");
    expect(periodLabel({ amount: 180, unit: "calendar_days" })).toBe("180 calendar days");
  });
});

describe("calculator across claim types and units", () => {
  const claims: ClaimType[] = [
    "medical_malpractice",
    "contract_written",
    "contract_oral",
    "fraud",
    "property_damage",
  ];

  it.each(claims)("computes a %s anniversary only after every confirmation", (claim) => {
    const data = snapshotWith([rule(claim, 4, "calendar_years")]);
    const ok = calculateBaseline(data, input(claim, "2022-03-10"));
    expect(ok.status).toBe("baseline");
    expect(ok.date).toBe("2026-03-10");
    const unconfirmed = calculateBaseline(
      data,
      input(claim, "2022-03-10", { applicabilityConfirmed: false }),
    );
    expect(unconfirmed.date).toBeNull();
    const missing = calculateBaseline(data, input("personal_injury", "2022-03-10"));
    expect(missing.status).toBe("needs_review");
  });

  it("computes a month-based period and withholds an impossible month-end target", () => {
    const data = snapshotWith([rule("medical_malpractice", 6, "calendar_months")]);
    expect(calculateBaseline(data, input("medical_malpractice", "2025-01-15")).date).toBe(
      "2025-07-15",
    );
    const impossible = calculateBaseline(data, input("medical_malpractice", "2025-08-31"));
    expect(impossible.date).toBeNull();
    expect(impossible.status).toBe("needs_review");
  });

  it("computes a day-based period", () => {
    const data = snapshotWith([rule("fraud", 180, "calendar_days")]);
    expect(calculateBaseline(data, input("fraud", "2026-01-01")).date).toBe("2026-06-30");
  });

  it("applies the earlier-of repose cap to non-injury claims too", () => {
    const data = snapshotWith([
      rule("medical_malpractice", 2, "calendar_years", {
        calculation: {
          mode: "accrual_repose_min",
          reposeYears: 4,
          reposeTrigger: "act_or_omission",
          reposeEffectiveFrom: "2003-09-01",
        },
      }),
    ]);
    const base = input("medical_malpractice", "2024-06-01", {
      reposeActDate: "2021-01-01",
      reposeApplicabilityConfirmed: true,
    });
    expect(calculateBaseline(data, base).date).toBe("2025-01-01");
    expect(calculateBaseline(data, { ...base, reposeActDate: "2023-06-01" }).date).toBe(
      "2026-06-01",
    );
    expect(calculateBaseline(data, { ...base, reposeActDate: "2002-01-01" }).status).toBe(
      "needs_review",
    );
    expect(
      calculateBaseline(data, { ...base, reposeApplicabilityConfirmed: false }).date,
    ).toBeNull();
  });

  it("refuses a repose cutoff that already precedes accrual", () => {
    const data = snapshotWith([
      rule("medical_malpractice", 2, "calendar_years", {
        calculation: {
          mode: "accrual_repose_min",
          reposeYears: 4,
          reposeTrigger: "act_or_omission",
          reposeEffectiveFrom: "2003-09-01",
        },
      }),
    ]);
    const result = calculateBaseline(
      data,
      input("medical_malpractice", "2026-01-01", {
        reposeActDate: "2020-01-01",
        reposeApplicabilityConfirmed: true,
      }),
    );
    expect(result.date).toBeNull();
    expect(result.reasons.join(" ")).toContain("precedes the confirmed accrual date");
  });

  it("withholds dates later than the oldest authority review date", () => {
    const data = snapshotWith([rule("fraud", 3, "calendar_years")]);
    const result = calculateBaseline(data, input("fraud", "2026-10-06"));
    expect(result.status).toBe("needs_review");
    expect(result.date).toBeNull();
  });

  it("withholds any date while a tolling issue is selected", () => {
    const data = snapshotWith([rule("contract_written", 6, "calendar_years")]);
    const result = calculateBaseline(
      data,
      input("contract_written", "2020-01-01", { issues: ["tolling"] }),
    );
    expect(result.date).toBeNull();
  });
});

describe("snapshot validation of backfill fields", () => {
  const provenance = {
    citation: "Test § 1",
    excerpt: "within four years",
    periodEvidence: "four years",
    accrualKind: "breach",
    accrualText: "accrues on breach",
    tolling: [{ text: "minority tolls", citation: "Test § 9" }],
    repose: [],
    lastAmended: { text: "Acts 2003", date: null },
    effectiveDate: null,
    retrievedAt: "2026-10-05T00:00:00.000Z",
    entryStatus: "verified",
    confidence: "high",
    confidenceNote: "test",
    flags: [],
    crossCheckSourceIds: [],
  };

  it("accepts well-formed provenance", () => {
    const r = {
      ...rule("contract_written", 4, "calendar_years"),
      provenance,
    } as unknown as LimitationRule;
    expect(snapshotWith([r]).rules[0]?.provenance?.citation).toBe("Test § 1");
  });

  it("rejects malformed provenance and unsupported units", () => {
    const bad = {
      ...rule("contract_written", 4, "calendar_years"),
      provenance: { ...provenance, confidence: "certain" },
    };
    expect(() => snapshotWith([bad as unknown as LimitationRule])).toThrow(/confidence/);
    const unit = rule("contract_written", 4, "calendar_years");
    (unit.period as { unit: string }).unit = "fortnights";
    expect(() => snapshotWith([unit])).toThrow(/period unit/);
  });
});

describe("weekend extension from a recorded state counting rule", () => {
  const withTimeRule = (extend: boolean) => {
    const data = snapshotWith([rule("fraud", 3, "calendar_years")]);
    const row = data.coverage.find((c) => c.state === "TX")!;
    row.timeComputation = {
      status: "verified",
      extendsWhenLastDayIsWeekend: extend,
      extendsWhenLastDayIsHoliday: null,
      citation: "Test Code § 16.072",
      excerpt: "next day that the county offices are open",
      sourceId: "tx-src",
      retrievedAt: "2026-10-05T00:00:00.000Z",
      note: "test",
    };
    return data;
  };

  it("finds weekdays without time-zone drift", () => {
    expect(civilWeekday("2026-05-02")).toBe(6);
    expect(civilWeekday("2026-05-03")).toBe(0);
    expect(civilWeekday("2026-05-04")).toBe(1);
    expect(nextWeekday("2026-05-02")).toBe("2026-05-04");
    expect(nextWeekday("2026-05-03")).toBe("2026-05-04");
    expect(nextWeekday("2026-05-04")).toBe("2026-05-04");
  });

  it("reports the extended date beside, never instead of, the unadjusted anniversary", () => {
    const result = calculateBaseline(withTimeRule(true), input("fraud", "2023-05-02"));
    expect(result.date).toBe("2026-05-02");
    expect(result.adjustedDate).toEqual({
      date: "2026-05-04",
      citation: "Test Code § 16.072",
      holidaysComputed: false,
    });
    expect(result.steps.at(-1)?.text).toContain("Saturday");
  });

  it("does not adjust a date from a flagged counting rule whose reach to limitations is unproven", () => {
    const data = withTimeRule(true);
    data.coverage.find((c) => c.state === "TX")!.timeComputation!.status = "flagged";
    const result = calculateBaseline(data, input("fraud", "2023-05-02"));
    expect(result.date).toBe("2026-05-02");
    expect(result.adjustedDate).toBeNull();
  });

  it("does not adjust weekday anniversaries or states without a recorded rule", () => {
    expect(
      calculateBaseline(withTimeRule(true), input("fraud", "2023-05-04")).adjustedDate,
    ).toBeNull();
    expect(
      calculateBaseline(withTimeRule(false), input("fraud", "2023-05-02")).adjustedDate,
    ).toBeNull();
    const none = snapshotWith([rule("fraud", 3, "calendar_years")]);
    expect(calculateBaseline(none, input("fraud", "2023-05-02")).adjustedDate).toBeNull();
  });
});

describe("raw-capture storage locations", () => {
  const withCapture = (rawCapture: Record<string, unknown>) => {
    const sources = STATES.map(source);
    (sources[0] as unknown as { rawCapture: unknown }).rawCapture = rawCapture;
    return () =>
      validateLimitationsSnapshot({
        rules: {
          schemaVersion: "1.0.0",
          snapshotDate: "2026-10-05",
          ruleVersion: "t",
          reviewMeaning: "t",
          dateMeaning: "t",
          rules: [],
        },
        sources: { schemaVersion: "1.0.0", snapshotDate: "2026-10-05", sources },
        cases: {
          schemaVersion: "1.0.0",
          snapshotDate: "2026-10-05",
          referenceMeaning: "t",
          cases: [],
        },
        coverage: {
          schemaVersion: "1.0.0",
          snapshotDate: "2026-10-05",
          coverage: STATES.map((state) => ({
            state,
            name: state,
            sourceStatus: "primary_text_retrieved",
            sourceIds: [`${state.toLowerCase()}-src`],
            baselineRuleIds: [],
            researchRuleIds: [],
            coverage: "research_only",
            discoverySource: "https://legislature.example.gov/",
            discoveryLinks: [],
            gaps: ["t"],
            publisherLinks: [],
            metadataOnlyReferences: [],
          })),
        },
      });
  };
  const sha = "ab".repeat(32);
  const base = {
    sha256: sha,
    byteLength: 5,
    contentType: "text/html",
    retrievedAt: "2026-10-06T00:00:00.000Z",
  };

  it("accepts the content-addressed key for the capture's own digest", () => {
    expect(
      withCapture({
        ...base,
        storageBucket: "corpus-originals",
        storageKey: `limitations-raw-captures/sha256/ab/${sha}.bin`,
      }),
    ).not.toThrow();
  });
  it("rejects a key that does not match the digest or bucket", () => {
    expect(
      withCapture({
        ...base,
        storageBucket: "corpus-originals",
        storageKey: `limitations-raw-captures/sha256/cd/${"cd".repeat(32)}.bin`,
      }),
    ).toThrow(/storage location/);
    expect(
      withCapture({
        ...base,
        storageBucket: "public",
        storageKey: `limitations-raw-captures/sha256/ab/${sha}.bin`,
      }),
    ).toThrow(/storage location/);
  });
});

describe("repose from first delivery and death-based accrual", () => {
  const reposeRule = (
    claim: ClaimType,
    trigger: "first_delivery" | "act_or_omission",
    basis: LimitationRule["accrualBasis"],
  ) =>
    rule(claim, 2, "calendar_years", {
      accrualBasis: basis,
      calculation: {
        mode: "accrual_repose_min",
        reposeYears: 10,
        reposeTrigger: trigger,
        reposeEffectiveFrom: "2005-04-07",
      },
    });

  it("caps a product claim at ten years from first delivery to a purchaser", () => {
    const data = snapshotWith([
      reposeRule("product_liability", "first_delivery", "confirmed_accrual"),
    ]);
    const base = input("product_liability", "2023-06-01", {
      firstProductDeliveryDate: "2015-09-01",
      reposeApplicabilityConfirmed: true,
    });
    const result = calculateBaseline(data, base);
    expect(result.date).toBe("2025-06-01");
    expect(result.steps.some((s) => s.text.includes("first delivery to a purchaser"))).toBe(true);
    const earlyDelivery = calculateBaseline(data, {
      ...base,
      accrualDate: "2024-01-01",
      firstProductDeliveryDate: "2013-01-01",
    });
    expect(earlyDelivery.status).toBe("needs_review");
    expect(earlyDelivery.date).toBeNull();
  });

  it("requires the delivery date and withholds a delivery after accrual or before the supported start", () => {
    const data = snapshotWith([
      reposeRule("product_liability", "first_delivery", "confirmed_accrual"),
    ]);
    const base = input("product_liability", "2023-06-01", { reposeApplicabilityConfirmed: true });
    expect(calculateBaseline(data, base).status).toBe("invalid");
    expect(
      calculateBaseline(data, { ...base, firstProductDeliveryDate: "2024-01-01" }).date,
    ).toBeNull();
    expect(
      calculateBaseline(data, { ...base, firstProductDeliveryDate: "2004-01-01" }).date,
    ).toBeNull();
  });

  it("combines a two-year period from death with a repose from the act or omission", () => {
    const data = snapshotWith([reposeRule("wrongful_death", "act_or_omission", "death")]);
    const base = input("wrongful_death", "2023-02-01", {
      reposeActDate: "2014-03-01",
      reposeApplicabilityConfirmed: true,
    });
    expect(calculateBaseline(data, base).date).toBe("2024-03-01");
    expect(calculateBaseline(data, { ...base, reposeActDate: "2022-01-01" }).date).toBe(
      "2025-02-01",
    );
  });

  it("validates the new trigger and rejects an unknown one", () => {
    const bad = reposeRule("product_liability", "first_delivery", "confirmed_accrual");
    (bad.calculation as { reposeTrigger: string }).reposeTrigger = "first_whim";
    expect(() => snapshotWith([bad])).toThrow(/accrual\/repose/);
  });
});

describe("clocks_min: two-limb periods and several repose clocks", () => {
  const clocksRule = (
    claim: ClaimType,
    calculation: NonNullable<LimitationRule["calculation"]>,
    extra: Partial<LimitationRule> = {},
  ) => rule(claim, 3, "calendar_years", { calculation, ...extra });
  const confirmed = { reposeApplicabilityConfirmed: true };

  it("takes the earlier of three years from injury and one year from discovery", () => {
    const data = snapshotWith([
      clocksRule("medical_malpractice", {
        mode: "clocks_min",
        combine: "earlier",
        limbs: [
          { amount: 3, unit: "calendar_years", from: "injury_date" },
          { amount: 1, unit: "calendar_years", from: "discovery" },
        ],
        clocks: [],
      }),
    ]);
    const base = input("medical_malpractice", "2024-02-01", {
      injuryDate: "2023-01-10",
      actualDiscoveryDate: "2024-02-01",
      constructiveDiscoveryDate: "2024-03-01",
    });
    const result = calculateBaseline(data, base);
    expect(result.date).toBe("2025-02-01");
    expect(result.steps[0]?.text).toContain("earlier");
    const lateDiscovery = calculateBaseline(data, {
      ...base,
      actualDiscoveryDate: "2025-06-01",
      constructiveDiscoveryDate: "2025-06-01",
    });
    expect(lateDiscovery.status).toBe("baseline");
    expect(lateDiscovery.date).toBe("2026-01-10");
  });

  it("LA wrongful death: same-day death and injury uses two years from injury when later controls", () => {
    const data = snapshotWith([
      clocksRule(
        "wrongful_death",
        {
          mode: "clocks_min",
          combine: "later",
          limbs: [
            { amount: 1, unit: "calendar_years", from: "death" },
            { amount: 2, unit: "calendar_years", from: "injury_date" },
          ],
          clocks: [],
        },
        { jurisdiction: "LA", accrualBasis: "death", id: "la-wrongful-death-clocks-min-test" },
      ),
    ]);
    const day = "2024-06-01";
    const base = input("wrongful_death", day, {
      jurisdiction: "LA",
      injuryDate: day,
      deathDate: day,
    });
    const result = calculateBaseline(data, base);
    expect(result.status).toBe("baseline");
    expect(result.date).toBe("2026-06-01");
    expect(result.steps[0]?.text).toContain("later");
  });

  it("takes the later of the two limbs when the statute says whichever is later", () => {
    const data = snapshotWith([
      clocksRule("medical_malpractice", {
        mode: "clocks_min",
        combine: "later",
        limbs: [
          { amount: 3, unit: "calendar_years", from: "injury_date" },
          { amount: 2, unit: "calendar_years", from: "discovery" },
        ],
        clocks: [{ years: 7, from: "injury_date", effectiveFrom: "1977-07-01" }],
      }),
    ]);
    const base = input("medical_malpractice", "2025-01-01", {
      injuryDate: "2021-06-15",
      actualDiscoveryDate: "2024-05-01",
      constructiveDiscoveryDate: "2024-05-01",
      ...confirmed,
    });
    expect(calculateBaseline(data, base).date).toBe("2026-05-01");
    const capped = calculateBaseline(data, {
      ...base,
      injuryDate: "2019-01-15",
      actualDiscoveryDate: "2025-12-01",
      constructiveDiscoveryDate: "2025-12-01",
      accrualDate: "2025-12-01",
    });
    expect(capped.date).toBe("2026-01-15");
    expect(
      capped.steps.some((s) =>
        s.text.startsWith("Repose: 7 calendar years from the date of injury"),
      ),
    ).toBe(true);
  });

  it("applies every repose clock and issues the earliest", () => {
    const data = snapshotWith([
      clocksRule("product_liability", {
        mode: "clocks_min",
        limbs: [{ amount: 2, unit: "calendar_years", from: "accrual" }],
        clocks: [
          { years: 12, from: "first_delivery", effectiveFrom: "2009-10-01" },
          { years: 10, from: "last_act_or_omission", effectiveFrom: "1979-10-01" },
        ],
      }),
    ]);
    const base = input("product_liability", "2024-01-01", {
      firstProductDeliveryDate: "2013-06-01",
      reposeActDate: "2015-09-01",
      ...confirmed,
    });
    const result = calculateBaseline(data, base);
    expect(result.date).toBe("2025-06-01");
    expect(result.steps.filter((s) => s.text.startsWith("Repose:"))).toHaveLength(2);
  });

  it("models a substantial-completion repose only from its own date", () => {
    const data = snapshotWith([
      clocksRule("property_damage", {
        mode: "clocks_min",
        limbs: [{ amount: 3, unit: "calendar_years", from: "accrual" }],
        clocks: [{ years: 10, from: "substantial_completion", effectiveFrom: "2015-01-01" }],
      }),
    ]);
    const base = input("property_damage", "2024-04-01", {
      substantialCompletionDate: "2016-07-01",
      ...confirmed,
    });
    expect(calculateBaseline(data, base).date).toBe("2026-07-01");
    expect(
      calculateBaseline(data, { ...base, substantialCompletionDate: "2014-07-01" }).date,
    ).toBeNull();
    expect(
      calculateBaseline(data, {
        ...base,
        substantialCompletionDate: undefined as unknown as string,
      }).status,
    ).toBe("invalid");
  });

  it("withholds when a clock already ran, a date is impossible or confirmations are missing", () => {
    const data = snapshotWith([
      clocksRule("medical_malpractice", {
        mode: "clocks_min",
        limbs: [{ amount: 2, unit: "calendar_years", from: "accrual" }],
        clocks: [{ years: 5, from: "injury_date", effectiveFrom: "1990-01-01" }],
      }),
    ]);
    const base = input("medical_malpractice", "2024-01-01", {
      injuryDate: "2015-01-01",
      ...confirmed,
    });
    const barred = calculateBaseline(data, base);
    expect(barred.date).toBeNull();
    expect(barred.reasons.join(" ")).toContain("precedes the confirmed accrual or discovery date");
    expect(
      calculateBaseline(data, { ...base, injuryDate: "2020-02-29", accrualDate: "2024-01-01" })
        .date,
    ).toBeNull();
    expect(
      calculateBaseline(data, {
        ...base,
        injuryDate: "2022-01-01",
        reposeApplicabilityConfirmed: false,
      }).date,
    ).toBeNull();
    expect(
      calculateBaseline(data, { ...base, injuryDate: "2022-01-01", issues: ["tolling"] }).date,
    ).toBeNull();
  });

  it("requires both discovery dates for a discovery limb", () => {
    const data = snapshotWith([
      clocksRule("fraud", {
        mode: "clocks_min",
        limbs: [{ amount: 3, unit: "calendar_years", from: "discovery" }],
        clocks: [],
      }),
    ]);
    expect(
      calculateBaseline(data, input("fraud", "2024-01-01", { actualDiscoveryDate: "2024-01-01" }))
        .status,
    ).toBe("invalid");
    expect(
      calculateBaseline(
        data,
        input("fraud", "2024-01-01", {
          actualDiscoveryDate: "2024-01-01",
          constructiveDiscoveryDate: "2023-05-01",
        }),
      ).date,
    ).toBe("2026-05-01");
  });

  it("rejects malformed clock configurations at validation", () => {
    const bad = clocksRule("fraud", {
      mode: "clocks_min",
      limbs: [{ amount: 3, unit: "calendar_years", from: "discovery" }],
      combine: "earlier",
      clocks: [{ years: 5, from: "act_or_omission", effectiveFrom: "2000-13-01" }],
    });
    expect(() => snapshotWith([bad])).toThrow();
    const noCombine = clocksRule("fraud", {
      mode: "clocks_min",
      limbs: [
        { amount: 3, unit: "calendar_years", from: "discovery" },
        { amount: 1, unit: "calendar_years", from: "accrual" },
      ],
      clocks: [],
    });
    expect(() => snapshotWith([noCombine])).toThrow(/earlier\/later/);
  });
});
