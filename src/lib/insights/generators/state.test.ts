import { describe, expect, it } from "vitest";
import type { MetricDef } from "@/lib/external/stateMetrics.functions";
import type { ConsumerComplaints } from "@/lib/external/consumerComplaints.functions";
import {
  generateCfpbStateInsights,
  generateEpaStateInsights,
  generateStateMetricInsights,
  type StateMetricsInput,
} from "./state";

const CODES =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  );

const metric = (over: Partial<MetricDef> & { key: string }): MetricDef => ({
  label: over.key,
  short: over.key,
  unit: "",
  format: "rate",
  group: "G",
  method: "",
  denominator: null,
  per: null,
  higher: "neutral",
  selectable: true,
  caveats: [],
  years: [2015, 2025],
  rankYears: [2025],
  latestYear: 2025,
  partialYears: {},
  national: {},
  nationalBasis: null,
  distribution: {},
  sources: [
    {
      publisher: "CDC",
      name: "VSRR provisional counts",
      url: "https://www.cdc.gov/nchs/",
      page: null,
      retrieved: null,
    },
  ],
  order: 1,
  provisional: null,
  ...over,
});

/** 51 jurisdictions; value(i, year) returns the series value or undefined to leave a gap. */
const states = (
  key: string,
  value: (i: number, year: number) => number | undefined,
  years = [2020, 2024, 2025],
  count = 51,
) =>
  CODES.slice(0, count).map((usps, i) => ({
    usps,
    name: `State ${usps}`,
    series: {
      [key]: Object.fromEntries(
        years.flatMap((y) => (value(i, y) === undefined ? [] : [[String(y), value(i, y)!]])),
      ),
    },
  }));

const OD = metric({
  key: "overdose_rate",
  national: { "2025": 20.67, "2020": 27.89 },
  provisional: "CDC provisional counts (VSRR)",
});

const input = (over: Partial<StateMetricsInput> = {}): StateMetricsInput => ({
  metrics: [OD],
  states: states("overdose_rate", (i, y) => (y === 2025 ? 10 + i : 20 + i)),
  ...over,
});

describe("generateStateMetricInsights", () => {
  it("ranks states for the latest year and states the national figure and spread", () => {
    const range = generateStateMetricInsights(input()).find((i) => i.id === "state.overdose-rate")!;
    expect(range.headline).toBe(
      "Drug overdose death rate in 2025 ran from 10.0 per 100,000 in State AL to 60.0 per 100,000 in State WY",
    );
    expect(range.summary.join(" ")).toContain("national figure was 20.7 per 100,000");
    expect(range.summary.join(" ")).toContain("6.0 times the lowest");
    expect(range.points.map((p) => [p.label, p.value])).toEqual([
      ["Highest: State WY", "60.0 per 100,000"],
      ["Lowest: State AL", "10.0 per 100,000"],
      ["National", "20.7 per 100,000"],
      ["Median state", "35.0 per 100,000"],
      ["Highest ÷ lowest", "6.0 times"],
    ]);
    expect(range.points[0]!.href).toBe("/places/WY");
    expect(range.caveat).toContain("CDC provisional counts (VSRR)");
    expect(range.dataThrough).toBe("2025");
    expect(range.sources[0]).toEqual({
      label: "CDC: VSRR provisional counts",
      href: "https://www.cdc.gov/nchs/",
    });
  });

  it("computes the five-year change by state from the stored series", () => {
    const withBase = generateStateMetricInsights(
      input({
        states: states("overdose_rate", (i, y) => (y === 2025 ? 10 + i : y === 2020 ? 20 : 15)),
      }),
    ).find((i) => i.id === "state.overdose-change")!;
    expect(withBase.kind).toBe("mover");
    expect(withBase.headline).toContain("2020 to 2025");
    // State WY: 20 -> 60 = +200%; State AL: 20 -> 10 = -50%
    expect(withBase.headline).toContain("State WY changed most (+200.0%)");
    expect(withBase.headline).toContain("State AL fell most (-50.0%)");
    expect(withBase.summary.join(" ")).toContain("rose and");
  });

  it("drops a metric covered for too few states instead of ranking a handful", () => {
    const thin = input({ states: states("overdose_rate", (i) => 10 + i, [2025], 20) });
    expect(generateStateMetricInsights(thin).map((i) => i.id)).toEqual([]);
  });

  it("ignores states with a missing value and a metric with no latest year", () => {
    const gaps = input({
      states: states("overdose_rate", (i, y) => (y === 2025 && i % 20 === 0 ? undefined : 10 + i)),
    });
    const range = generateStateMetricInsights(gaps).find((i) => i.id === "state.overdose-rate")!;
    expect(range.headline).toContain("to 60.0 per 100,000 in State WY");
    expect(
      generateStateMetricInsights(
        input({ metrics: [metric({ key: "overdose_rate", latestYear: null })] }),
      ),
    ).toEqual([]);
    expect(generateStateMetricInsights(input({ metrics: [] }))).toEqual([]);
  });

  it("omits the national comparison when the metric has none, rather than inventing one", () => {
    const noNat = input({ metrics: [metric({ key: "overdose_rate", national: {} })] });
    const range = generateStateMetricInsights(noNat).find((i) => i.id === "state.overdose-rate")!;
    expect(range.points.map((p) => p.label)).not.toContain("National");
    expect(range.summary.join(" ")).not.toContain("national figure");
  });

  it("flags a partial year in the caveat", () => {
    const partial = input({
      metrics: [
        metric({
          key: "overdose_rate",
          national: { "2025": 1 },
          partialYears: { "2025": "Received through 2026-10-15" },
        }),
      ],
    });
    expect(
      generateStateMetricInsights(partial).find((i) => i.id === "state.overdose-rate")!.caveat,
    ).toContain("partial year (Received through 2026-10-15)");
  });

  it("reports the share of residents in the five most populous states", () => {
    const pop = input({
      metrics: [metric({ key: "population", format: "int", national: { "2025": 1 } })],
      states: states("population", (i) => (i < 5 ? 10_000_000 : 1_000_000), [2025]),
    });
    const c = generateStateMetricInsights(pop).find(
      (i) => i.id === "state.population-concentration",
    )!;
    // 5 x 10M + 46 x 1M = 96M; top five = 50M = 52.1%
    expect(c.headline).toContain("Five states hold 52% of U.S. residents (2025)");
    expect(c.points[1]).toMatchObject({
      label: "Top five combined",
      value: "50 million",
      note: "52.1%",
    });
  });
});

const CFPB = (over: Partial<ConsumerComplaints> = {}): ConsumerComplaints =>
  ({
    from: "2011-12-01",
    to: "2026-10-18",
    complaints: 18504768,
    companies: 8179,
    timelyRate: 99.4,
    years: [
      {
        year: 2025,
        complaints: 5442944,
        complete: true,
        yoyPct: 99.06,
        creditReporting: 4810295,
        creditReportingSharePct: 88.38,
        timelyRate: 99.55,
        reliefRate: 41.13,
      },
    ],
    ytd: null,
    productShift: { from: "2024", to: "2025", rows: [] },
    states: [
      {
        code: "GA",
        name: "Georgia",
        complaints: 1,
        window: null,
        per100k2025: 3777.28,
        rateChangePct: 500,
        timelyRate: null,
      },
      {
        code: "MS",
        name: "Mississippi",
        complaints: 1,
        window: null,
        per100k2025: 3433.77,
        rateChangePct: 1049.23,
        timelyRate: null,
      },
      {
        code: "FL",
        name: "Florida",
        complaints: 1,
        window: null,
        per100k2025: 3372.33,
        rateChangePct: 400,
        timelyRate: null,
      },
      {
        code: "VT",
        name: "Vermont",
        complaints: 1,
        window: null,
        per100k2025: 500,
        rateChangePct: 100,
        timelyRate: null,
      },
      {
        code: "ME",
        name: "Maine",
        complaints: 1,
        window: null,
        per100k2025: 400,
        rateChangePct: 100,
        timelyRate: null,
      },
    ],
    perCapitaRanking: [
      { code: "GA", name: "Georgia", value: 3777.28, rank: 1 },
      { code: "MS", name: "Mississippi", value: 3433.77, rank: 2 },
      { code: "FL", name: "Florida", value: 3372.33, rank: 3 },
    ],
    riseRanking: [{ code: "MS", name: "Mississippi", value: 1049.23, rank: 1 }],
    topCompanies: [],
    reports: [],
    reportCount: 0,
    ...over,
  }) as ConsumerComplaints;

describe("generateCfpbStateInsights", () => {
  it("names the three leading states and the median", () => {
    const [i] = generateCfpbStateInsights(CFPB());
    expect(i!.id).toBe("state.cfpb-complaint-rates");
    expect(i!.headline).toContain("Georgia, Mississippi and Florida");
    expect(i!.summary[0]).toContain(
      "Georgia had the most CFPB consumer complaints per 100,000 residents (3,777)",
    );
    // median of [3777.28, 3433.77, 3372.33, 500, 400] = 3372.33
    expect(i!.summary[1]).toContain("(the median) had 3,372 per 100,000");
    expect(i!.summary[2]).toContain("Mississippi (+1,049%)");
    expect(i!.caveat).toContain("88.4%");
  });

  it("returns nothing when the ranking is missing or the median cannot be computed", () => {
    expect(generateCfpbStateInsights(CFPB({ perCapitaRanking: [] }))).toEqual([]);
    expect(generateCfpbStateInsights(CFPB({ states: [] }))).toEqual([]);
  });

  it("still works without a rise ranking", () => {
    const [i] = generateCfpbStateInsights(CFPB({ riseRanking: [] }));
    expect(i!.points.map((p) => p.label)).not.toContain("Fastest rise since 2022: Mississippi");
  });
});

describe("generateEpaStateInsights", () => {
  const epaStates = (count: number) =>
    CODES.slice(0, count).map((code, i) => ({
      code,
      name: `State ${code}`,
      population: 1_000_000,
      populationYear: 2025,
      // FY2022-FY2026 cases: i + 1 each year
      years: [2020, 2021, 2022, 2023, 2024, 2025, 2026].map((fy) => ({
        fy,
        cases: fy < 2022 ? 1000 : i + 1,
      })),
    }));

  it("ranks cases opened over the last five complete fiscal years per 100,000 residents", () => {
    const [i] = generateEpaStateInsights({ fileDate: "2026-10-10", states: epaStates(51) });
    expect(i!.headline).toBe(
      "EPA civil enforcement cases, FY2022-FY2026: most per resident in State WY, State WI and State WV",
    );
    // State WY: i=50 -> 51 cases x 5 years = 255 per 1M = 25.5 per 100k
    expect(i!.points[0]).toMatchObject({ value: "25.5 per 100,000", note: "255 cases" });
    expect(i!.dataThrough).toBe("FY2026");
  });

  it("uses FY2025 as the latest complete year before the new fiscal year starts", () => {
    const [i] = generateEpaStateInsights({ fileDate: "2026-09-29", states: epaStates(51) });
    expect(i!.headline).toContain("FY2021-FY2025");
  });

  it("drops states without a population and returns nothing when the file date is unreadable", () => {
    const noPop = epaStates(51).map((s, i) => (i < 10 ? { ...s, population: null } : s));
    expect(generateEpaStateInsights({ fileDate: "2026-10-10", states: noPop })).toEqual([]);
    expect(generateEpaStateInsights({ fileDate: null, states: epaStates(51) })).toEqual([]);
  });
});
