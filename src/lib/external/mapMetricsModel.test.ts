import { describe, expect, it } from "vitest";
import {
  buildStateMapMetrics,
  classIndex,
  competitionRank,
  formatMapValue,
  parseCountyValues,
  popByFips,
  quantileBreaks,
  ratePer100k,
  STATE_METRIC_BY_KEY,
  STATE_METRICS,
  type StateMapInputs,
} from "./mapMetricsModel";

const pepRow = (id: string, value: number, year = 2025) => ({
  id,
  l: { year, date: `July 1, ${year}`, value, vintage: year },
});

const inputs = (): StateMapInputs => ({
  pep: [
    pepRow("56", 588_000),
    pepRow("06", 39_500_000),
    pepRow("72", 3_200_000),
    { id: "US", l: { year: 2025, value: 3e8 } },
  ],
  acs: [
    { id: "56", l: { poverty_rate: [10.4, 0.7, 2024], pop: [587_618, null, 2024, "c"] } },
    { id: "06", l: { poverty_rate: [12.0, 0.2, 2024] } },
  ],
  fjc: [
    { id: "WY", c: { filings: 312 }, fy: "2025" },
    { id: "CA", c: { filings: 39_500 }, fy: "2025" },
    { id: "ZZ", c: { filings: 5 }, fy: "2025" },
  ],
  districts: [
    { s: "Wyoming", a: "2", pa: "0", asof: "2026-10-01" },
    { s: "California", a: "26", pa: "4916", asof: "2026-10-01" },
    { s: "California", a: "28", pa: "2", asof: "2026-10-01" },
    { s: "Guam", a: "1", pa: "0", asof: "2026-10-01" },
  ],
  cfpb: [
    {
      id: "cfpb-state:WY",
      y: [
        { year: "2024", complaints: 800, complete: true },
        { year: "2025", complaints: 1200, complete: true },
        { year: "2026", complaints: 5, complete: false },
      ],
    },
  ],
  osha: [
    {
      id: "osha-state:WY",
      c: { inspections: 169 },
      r: {
        fy: 2025,
        inspections_per_100k_covered_jobs: 59.88,
        denominator: "BLS QCEW",
        denominator_year: 2025,
        denominator_value: 282_252,
      },
    },
  ],
  echo: [{ id: "epa-echo-programs:WY", c: { formal_5y: 172 } }],
});

describe("ratePer100k", () => {
  it("divides count by population and scales", () => {
    expect(ratePer100k(312, 588_000)).toBeCloseTo(53.06, 2);
    expect(ratePer100k(0, 100)).toBe(0);
  });
  it("is null for missing, negative or empty inputs, never zero or infinite", () => {
    expect(ratePer100k(null, 100)).toBeNull();
    expect(ratePer100k(5, null)).toBeNull();
    expect(ratePer100k(5, 0)).toBeNull();
    expect(ratePer100k(-1, 100)).toBeNull();
    expect(ratePer100k(Number.NaN, 100)).toBeNull();
  });
});

describe("competitionRank", () => {
  it("ranks highest first and lets ties share a rank", () => {
    const r = competitionRank({ a: 5, b: 9, c: 5, d: 1 }, ["a", "b", "c", "d"]);
    expect(r["b"]).toEqual({ rank: 1, of: 4 });
    expect(r["a"]).toEqual({ rank: 2, of: 4 });
    expect(r["c"]).toEqual({ rank: 2, of: 4 });
    expect(r["d"]).toEqual({ rank: 4, of: 4 });
  });
  it("ranks only inside the scope and skips missing values", () => {
    const r = competitionRank({ a: 5, b: 9, z: 100 }, ["a", "b", "missing"]);
    expect(Object.keys(r).sort()).toEqual(["a", "b"]);
    expect(r["b"]).toEqual({ rank: 1, of: 2 });
  });
});

describe("class breaks", () => {
  it("builds ascending quantile bounds and collapses duplicates", () => {
    expect(quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toEqual([2, 4, 6, 8, 10]);
    expect(quantileBreaks([5, 5, 5, 5], 5)).toEqual([5]);
    expect(quantileBreaks([], 5)).toEqual([]);
  });
  it("places values in classes and gives null to missing values", () => {
    const b = [2, 4, 6, 8, 10];
    expect(classIndex(1, b)).toBe(0);
    expect(classIndex(4, b)).toBe(1);
    expect(classIndex(4.1, b)).toBe(2);
    expect(classIndex(99, b)).toBe(4);
    expect(classIndex(null, b)).toBeNull();
    expect(classIndex(3, [])).toBeNull();
  });
});

describe("formatMapValue", () => {
  it("formats by kind and says Not recorded for gaps", () => {
    expect(formatMapValue(1234567.4, "int")).toBe("1,234,567");
    expect(formatMapValue(53.064, "rate1")).toBe("53.1");
    expect(formatMapValue(74000, "dollars")).toBe("$74,000");
    expect(formatMapValue(10.44, "pct")).toBe("10.4%");
    expect(formatMapValue(39.8, "dec1")).toBe("39.8");
    expect(formatMapValue(undefined, "int")).toBe("Not recorded");
    expect(formatMapValue(0, "int")).toBe("0");
  });
});

describe("popByFips", () => {
  it("keeps state rows of one year only", () => {
    const { pop, year } = popByFips([
      pepRow("56", 588_000),
      pepRow("06", 1, 2024),
      { id: "US", l: { value: 5, year: 2025 } },
    ]);
    expect(year).toBe(2025);
    expect(pop).toEqual({ "56": 588_000 });
  });
});

describe("buildStateMapMetrics", () => {
  const metrics = buildStateMapMetrics(inputs());
  const get = (key: string) => metrics.find((m) => m.key === key)!;

  it("states the denominator and year of every per-capita rate", () => {
    const rate = get("fed_filings_rate");
    expect(rate.yearLabel).toBe("FY2025");
    expect(rate.denominator).toMatchObject({ year: "July 1, 2025" });
    expect(rate.values["56"]).toBeCloseTo((312 / 588_000) * 100_000);
    expect(rate.detail["56"]).toBe("312 cases filed in FY2025 ÷ 588,000 residents (July 1, 2025)");
    for (const key of ["judges_rate", "cfpb_rate"])
      expect(get(key).denominator?.year).toBe("July 1, 2025");
  });

  it("never fabricates a rate for a state without population or a known state", () => {
    expect(get("fed_filings_rate").values["06"]).toBeCloseTo((39_500 / 39_500_000) * 100_000);
    expect(Object.keys(get("fed_filings").values).sort()).toEqual(["06", "56"]); // "ZZ" is not a state
  });

  it("sums active judges and pending MDL actions over a state's districts, skipping territories without a state row", () => {
    expect(get("mdl_pending").values).toEqual({ "06": 4918, "56": 0 });
    expect(get("judges_rate").values["06"]).toBeCloseTo((54 / 39_500_000) * 100_000);
    expect(get("judges_rate").yearLabel).toBe("as of 2026-10-01");
  });

  it("uses the latest complete CFPB year and recomputes the rate on the Census denominator", () => {
    const m = get("cfpb_rate");
    expect(m.yearLabel).toBe("2025");
    expect(m.values["56"]).toBeCloseTo((1200 / 588_000) * 100_000);
  });

  it("keeps OSHA's published rate and its own denominator", () => {
    const m = get("osha_rate");
    expect(m.values["56"]).toBe(59.88);
    expect(m.detail["56"]).toBe("169 inspections in FY2025 ÷ 282,252 covered jobs");
    expect(m.denominator?.label).toContain("BLS QCEW");
  });

  it("ranks only the 50 states and DC, never Puerto Rico", () => {
    const pop = get("pop");
    expect(pop.values["72"]).toBe(3_200_000);
    expect(pop.rank["72"]).toBeUndefined();
    expect(pop.rank["06"]).toEqual({ rank: 1, of: 2 });
    expect(pop.rank["56"]).toEqual({ rank: 2, of: 2 });
  });

  it("carries ACS values with the survey period, only for known metrics", () => {
    const m = get("acs:poverty_rate");
    expect(m.yearLabel).toBe("2020–2024");
    expect(m.values).toEqual({ "56": 10.4, "06": 12.0 });
    expect(m.detail["56"]).toBe("margin of error ± 0.7");
    expect(metrics.find((x) => x.key === "acs:pop")).toBeUndefined();
  });

  it("leaves a metric out when no state has a value", () => {
    const empty = buildStateMapMetrics({ ...inputs(), echo: [], osha: [], cfpb: [] });
    expect(empty.find((m) => m.key === "echo_formal_5y")).toBeUndefined();
    expect(empty.find((m) => m.key === "osha_rate")).toBeUndefined();
    expect(empty.find((m) => m.key === "cfpb_rate")).toBeUndefined();
  });

  it("does not build rates without a Census population", () => {
    const none = buildStateMapMetrics({ ...inputs(), pep: [] });
    expect(none.find((m) => m.key === "fed_filings_rate")).toBeUndefined();
    expect(none.find((m) => m.key === "fed_filings")?.values["56"]).toBe(312);
  });
});

describe("metric catalog", () => {
  it("has unique keys and a county counterpart only where county data exists", () => {
    const keys = STATE_METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(STATE_METRIC_BY_KEY.get("mdl_pending")?.county).toBeNull();
    expect(STATE_METRIC_BY_KEY.get("judges_rate")?.county).toBeNull();
    expect(STATE_METRIC_BY_KEY.get("fed_filings_rate")?.county).toBe("fjc_core_rate");
    expect(STATE_METRIC_BY_KEY.get("pop")?.county).toBe("pop");
  });
  it("explains how a county counterpart differs wherever it is a different count", () => {
    for (const key of ["fed_filings_rate", "cfpb_rate", "osha_rate"])
      expect(STATE_METRIC_BY_KEY.get(key)?.countyNote).toBeTruthy();
  });
  it("no longer defaults to the research-resource count", () => {
    expect(STATE_METRICS.find((m) => m.key === "directory_sources")?.group).toBe("Directory");
  });
});

describe("parseCountyValues", () => {
  it("keeps finite numbers from numbers or numeric strings and drops the rest", () => {
    expect(
      parseCountyValues([
        { id: "56021", v: "24.64" },
        { id: "56023", v: 3 },
        { id: "56025", v: null },
        { id: "56027", v: "abc" },
        { id: "5602", v: 1 },
      ]),
    ).toEqual({ "56021": 24.64, "56023": 3 });
  });
});
