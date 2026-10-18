import { describe, expect, it } from "vitest";
import {
  consumerTakeaways,
  cpscTakeaways,
  epaTakeaways,
  type ConsumerTakeawayInput,
  type CpscTakeawayInput,
  type EpaTakeawayInput,
} from "./enforcementTakeaways";

const company = (n: number, complaints: number) => ({ company: `CO ${n}`, complaints });
const consumer: ConsumerTakeawayInput = {
  lastYear: { year: 2025, complaints: 3_000_000, creditReporting: 2_600_000 },
  previous: { year: 2024, complaints: 2_670_000, creditReporting: 2_000_000 },
  topState: { name: "Florida", value: 4012.5 },
  perCapitaLabel: "complaints per 100,000 residents, 2025",
  riseState: {
    name: "Georgia",
    value: 212.34,
    label: "rise in the per-capita complaint rate from 2022 to 2025",
  },
  topCompanies: [
    { company: "EQUIFAX, INC.", complaints: 400_000 },
    ...Array.from({ length: 9 }, (_, k) => company(k, 66_000)),
  ],
  totalComplaints: 5_000_000,
  since: "2011-12-01",
};

describe("consumerTakeaways", () => {
  it("compares credit reporting with every other product and names companies exactly", () => {
    const items = consumerTakeaways(consumer);
    expect(items.map((t) => t.id)).toEqual([
      "other-products",
      "top-state",
      "rise-state",
      "company-concentration",
    ]);
    // Other products: 400,000 against 670,000 is −40.3%; credit reporting 2,000,000 to 2,600,000 is +30.0%.
    expect(items[0]!.figure).toBe("−40.3%");
    expect(items[0]!.text).toContain("(400,000) against 670,000 in 2024");
    expect(items[0]!.text).toContain("credit reporting +30.0% (2,600,000 against 2,000,000)");
    expect(items[1]!.figure).toBe("4,012.5");
    expect(items[1]!.text).toBe(
      "Florida is the highest of the 50 states and DC (complaints per 100,000 residents, 2025).",
    );
    expect(items[2]!.figure).toBe("+212.3%");
    expect(items[2]!.text).toBe(
      "Georgia has the largest rise in the per-capita complaint rate from 2022 to 2025 of the 50 states and DC.",
    );
    // (400,000 + 9 × 66,000) ÷ 5,000,000 = 19.9%
    expect(items[3]!.figure).toBe("19.9%");
    expect(items[3]!.text).toContain("since 2011-12-01");
    expect(items[3]!.text).toContain("EQUIFAX, INC. leads with 400,000");
  });

  it("drops what is unknown and never claims ten companies when fewer are listed", () => {
    const items = consumerTakeaways({
      ...consumer,
      previous: { year: 2024, complaints: 2_670_000, creditReporting: null },
      riseState: null,
      topCompanies: consumer.topCompanies.slice(0, 5),
    });
    // Only the top state is left, and one takeaway is not shown as a summary.
    expect(items).toEqual([]);
  });
});

const cpsc: CpscTakeawayInput = {
  latest: 2025,
  latestRecalls: 300,
  priorMean: 200,
  rising: [
    { label: "Fire", latest: 40, baseline: 20 },
    { label: "Fall", latest: 12, baseline: 5 },
  ],
  windowLabel: "2000–2025",
  deathMentions: 150,
  deathBackground: 20,
  chinaShare: 0.462,
  countryRecordedPct: 88,
  topHazard: { label: "Fire, burn and overheating", total: 900 },
};

describe("cpscTakeaways", () => {
  it("compares the latest complete year with the prior three-year mean", () => {
    const items = cpscTakeaways(cpsc);
    expect(items.map((t) => t.id)).toEqual([
      "latest-year",
      "rising",
      "top-hazard",
      "deaths",
      "china",
    ]);
    expect(items[0]!.text).toContain("1.5×");
    expect(items[1]!.figure).toBe("2");
    expect(items[1]!.text).toContain("Fire (40 vs 20.0)");
    expect(items[3]!.text).toContain("not verified counts");
    expect(items[4]!.figure).toBe("46.2%");
  });

  it("never rounds a partial country coverage up to 100%", () => {
    const whole = cpscTakeaways({ ...cpsc, countryRecordedPct: 88 }).find((t) => t.id === "china")!;
    expect(whole.text).toContain("recorded for 88% of recalls");
    const partial = cpscTakeaways({ ...cpsc, countryRecordedPct: 99.6 }).find(
      (t) => t.id === "china",
    )!;
    expect(partial.text).toContain("recorded for 99.6% of recalls");
  });

  it("states zero rising hazards instead of hiding the rule", () => {
    const items = cpscTakeaways({ ...cpsc, rising: [], chinaShare: null });
    expect(items.find((t) => t.id === "rising")!.figure).toBe("0");
    expect(items.some((t) => t.id === "china")).toBe(false);
  });
});

const epa: EpaTakeawayInput = {
  windowLabel: "FY2016–FY2025",
  scopeName: "United States",
  cases: 1000,
  judicial: 250,
  administrative: 750,
  fedPenalty: 7_190_000_000,
  penaltySettlements: 400,
  topState: { name: "Texas", fedPenalty: 1_500_000_000 },
  latestFy: 2025,
  surges: [{ name: "Ohio", latest: 30, baseline: 10 }],
  outliers: [{ name: "Wyoming", perMillion: 55.04 }],
  topCase: { name: "BP", fedPenalty: 5_500_000_000, sharePct: 76.5 },
};

describe("epaTakeaways", () => {
  it("reports penalties, cases, flags and the largest case with their scope", () => {
    const items = epaTakeaways(epa);
    // Six candidates exist but a page shows at most five (usableTakeaways), so the last one, per-capita, is cut.
    expect(items.map((t) => t.id)).toEqual([
      "penalties",
      "cases",
      "top-state",
      "surge",
      "top-case",
    ]);
    expect(items[0]!.figure).toBe("$7.19B");
    expect(items[1]!.text).toContain("25.0% judicial and 75.0% administrative");
    expect(items[3]!.text).toContain("Ohio (30 vs 10.0)");
  });

  it("shows the per-capita outliers when the cap leaves room for them", () => {
    const items = epaTakeaways({ ...epa, topState: null });
    expect(items.map((t) => t.id)).toEqual([
      "penalties",
      "cases",
      "surge",
      "top-case",
      "per-capita",
    ]);
    expect(items[4]!.text).toContain("Wyoming (55.0 per million)");
  });

  it("omits the state ranking for a single-state view", () => {
    const items = epaTakeaways({ ...epa, scopeName: "Texas", topState: null, outliers: [] });
    expect(items.some((t) => t.id === "top-state")).toBe(false);
    expect(items.some((t) => t.id === "per-capita")).toBe(false);
  });
});
