import { describe, expect, it } from "vitest";
import {
  acsApiUrl,
  cbpSectorRows,
  changeBetween,
  difference,
  formatCensus,
  formatMoe,
  NOT_RECORDED,
  parseCbp,
  parseCensusGeo,
  parseFigure,
  parsePep,
  parseSeries,
  trendPoints,
  type CensusGeo,
} from "./censusModel";

const payload = {
  geoid: "56",
  level: "state",
  name: "Wyoming",
  usps: "WY",
  survey: "acs5",
  years: [2018, 2023, 2024, 2013],
  latest_year: 2024,
  period: "2020-2024",
  series: {
    poverty_rate: {
      "2013": [11.6, 0.9],
      "2018": [11.1, 0.8],
      "2023": [10.6, 0.7],
      "2024": [10.4, 0.7],
    },
    pop: { "2024": [587618, null, "c"] },
    median_hh_income: { "2013": [null, null, -666666666], "2024": [74000, 1100] },
    "bad key!": { "2024": [1, 1] },
  },
  latest: { pop: [587618, null, 2024, "c"], poverty_rate: [10.4, 0.7, 2024] },
  rank: { poverty_rate: [38, 51], broken: [3, 2] },
  measures: [
    {
      key: "poverty_rate",
      label: "People below the poverty level",
      unit: "% of people",
      format: "pct",
      group: "Economy",
      kind: "share",
      table: "B17001",
      cells: ["B17001_002", "not a cell"],
      denominator_cell: "B17001_001",
    },
    { key: "x", label: "No format" },
  ],
};

describe("parseFigure", () => {
  it("reads values, margins and notes", () => {
    expect(parseFigure([12.3, 0.4])).toEqual({ value: 12.3, moe: 0.4, note: null });
    expect(parseFigure([5, null, "c"])).toEqual({ value: 5, moe: null, note: "c" });
    expect(parseFigure([5, null, "m"])).toEqual({ value: 5, moe: null, note: "m" });
  });
  it("keeps an unpublished figure as a gap, never zero", () => {
    expect(parseFigure([null, null, -666666666])).toEqual({ value: null, moe: null, note: null });
    expect(parseFigure([0, 0])?.value).toBe(0);
  });
  it("drops malformed input", () => {
    expect(parseFigure("12")).toBeNull();
    expect(parseFigure([1])).toBeNull();
    expect(parseFigure([Number.NaN, 1])?.value).toBeNull();
  });
  it("ignores a negative margin", () => {
    expect(parseFigure([4, -2])?.moe).toBeNull();
  });
});

describe("parseCensusGeo", () => {
  const geo = parseCensusGeo(payload)!;
  it("types a stored payload and sorts years", () => {
    expect(geo.years).toEqual([2013, 2018, 2023, 2024]);
    expect(geo.usps).toBe("WY");
    expect(geo.period).toBe("2020-2024");
  });
  it("drops unsafe measure keys and impossible ranks", () => {
    expect(Object.keys(geo.series)).toEqual(["poverty_rate", "pop", "median_hh_income"]);
    expect(geo.rank).toEqual({ poverty_rate: { rank: 38, of: 51 } });
  });
  it("keeps the controlled note on the latest value", () => {
    expect(geo.latest["pop"]).toEqual({ value: 587618, moe: null, note: "c", year: 2024 });
  });
  it("keeps only valid cell codes in measure definitions", () => {
    expect(geo.measures).toHaveLength(1);
    expect(geo.measures[0]!.cells).toEqual(["B17001_002"]);
    expect(geo.measures[0]!.denominatorCell).toBe("B17001_001");
  });
  it("rejects a payload without identity", () => {
    expect(parseCensusGeo({ ...payload, geoid: "5" })).toBeNull();
    expect(parseCensusGeo({ ...payload, survey: "acs3" })).toBeNull();
    expect(parseCensusGeo(null)).toBeNull();
  });
  it("keeps an unpublished year out of the series values but present as a gap", () => {
    const s = parseSeries(payload.series);
    expect(s["median_hh_income"]!["2013"]).toEqual({ value: null, moe: null, note: null });
  });
});

describe("formatting", () => {
  it("formats by kind and says Not recorded for gaps", () => {
    expect(formatCensus(1234567, "int")).toBe("1,234,567");
    expect(formatCensus(65432.4, "dollars")).toBe("$65,432");
    expect(formatCensus(39.84, "dec1")).toBe("39.8");
    expect(formatCensus(10.44, "pct")).toBe("10.4%");
    expect(formatCensus(null, "pct")).toBe(NOT_RECORDED);
    expect(formatCensus(undefined, "int")).toBe(NOT_RECORDED);
    expect(formatCensus(0, "int")).toBe("0");
  });
  it("formats margins, with percentage points for percentages", () => {
    expect(formatMoe({ moe: 0.7, note: null }, "pct")).toBe("± 0.7 pts");
    expect(formatMoe({ moe: 1100, note: null }, "dollars")).toBe("± $1,100");
    expect(formatMoe({ moe: null, note: "c" }, "int")).toBe("controlled estimate");
    expect(formatMoe({ moe: null, note: null }, "int")).toBe("");
  });
});

describe("difference and change", () => {
  const a = { value: 12, moe: 3, note: null } as const;
  const b = { value: 10, moe: 4, note: null } as const;
  it("uses the root-sum-of-squares margin", () => {
    const d = difference(a, b)!;
    expect(d.diff).toBe(2);
    expect(d.moe).toBe(5);
    expect(d.distinguishable).toBe(false);
    expect(
      difference({ value: 20, moe: 1, note: null }, { value: 10, moe: 1, note: null })!
        .distinguishable,
    ).toBe(true);
  });
  it("treats a controlled estimate as having no sampling error", () => {
    const d = difference({ value: 10, moe: null, note: "c" }, { value: 8, moe: 1, note: null })!;
    expect(d.moe).toBe(1);
    expect(d.distinguishable).toBe(true);
  });
  it("cannot judge without margins and returns null without values", () => {
    expect(difference({ value: 1, moe: null, note: null }, b)!.distinguishable).toBeNull();
    expect(difference({ value: null, moe: null, note: null }, b)).toBeNull();
    expect(difference(undefined, b)).toBeNull();
  });
  const geo = parseCensusGeo(payload) as CensusGeo;
  it("gives a margin only for non-overlapping five-year releases", () => {
    const overlapping = changeBetween(geo, "poverty_rate", 2023, 2024)!;
    expect(overlapping.independent).toBe(false);
    expect(overlapping.moe).toBeNull();
    expect(overlapping.distinguishable).toBeNull();
    expect(overlapping.diff).toBeCloseTo(-0.2);
    const apart = changeBetween(geo, "poverty_rate", 2013, 2024)!;
    expect(apart.independent).toBe(true);
    expect(apart.moe).toBeCloseTo(Math.sqrt(0.9 ** 2 + 0.7 ** 2));
    expect(apart.pct).toBeCloseTo(((10.4 - 11.6) / 11.6) * 100);
  });
  it("returns null when an endpoint is a gap", () => {
    expect(changeBetween(geo, "median_hh_income", 2013, 2024)).toBeNull();
  });
});

describe("trendPoints", () => {
  const geo = parseCensusGeo(payload) as CensusGeo;
  it("lists every release year; unpublished years are null", () => {
    const pts = trendPoints(geo, "median_hh_income");
    expect(pts.map((p) => p.year)).toEqual([2013, 2018, 2023, 2024]);
    expect(pts.map((p) => p.value)).toEqual([null, null, null, 74000]);
  });
  it("drops the margin of a controlled estimate", () => {
    expect(trendPoints(geo, "pop").at(-1)).toEqual({ year: 2024, value: 587618, moe: null });
  });
});

describe("PEP", () => {
  const pep = parsePep({
    geoid: "56",
    level: "state",
    name: "Wyoming",
    usps: "WY",
    series: {
      v2025: { base: { "2020": 576851 }, pop: { "2020": 577719, "2025": 588000 } },
      v2019: { base: { census2010: 563626 }, pop: { "2019": 578759 } },
    },
    latest: { year: 2025, date: "July 1, 2025", vintage: 2025, value: 588000, rank: 50, of: 51 },
  })!;
  it("keeps the two vintages apart", () => {
    expect(pep.v2025["2025"]).toBe(588000);
    expect(pep.v2019["2019"]).toBe(578759);
    expect(pep.v2025["2019"]).toBeUndefined();
    expect(pep.base2020).toBe(576851);
    expect(pep.census2010).toBe(563626);
    expect(pep.latest).toEqual({
      year: 2025,
      date: "July 1, 2025",
      value: 588000,
      rank: 50,
      of: 51,
    });
  });
});

describe("CBP", () => {
  const cbp = parseCbp({
    geoid: "56",
    level: "state",
    name: "Wyoming",
    usps: "WY",
    years: [2023],
    latest_year: 2023,
    series: {
      "00": { "2023": [20000, 250000, 12000000] },
      "21": { "2023": [400, 20000, 2000000] },
      "62": { "2023": [900, null, null, { emp: "S", pay: "S" }] },
      "77": { "2023": [1, 1, 1] },
    },
  })!;
  it("drops unknown sectors and keeps withheld values as null with their flag", () => {
    expect(Object.keys(cbp.series).sort()).toEqual(["00", "21", "62"]);
    const hc = cbp.series["62"]!["2023"]!;
    expect(hc.employees).toBeNull();
    expect(hc.flags).toEqual({ emp: "S", pay: "S" });
  });
  it("sorts sectors by employment with withheld last and omits the total", () => {
    const rows = cbpSectorRows(cbp, 2023);
    expect(rows.map((r) => r.sector)).toEqual(["21", "62"]);
  });
});

describe("acsApiUrl", () => {
  it("builds the request for one area without a key", () => {
    expect(acsApiUrl("acs5", 2024, "06037", ["B01003_001"])).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E,B01003_001M&for=county:037&in=state:06",
    );
    expect(acsApiUrl("acs1", 2023, "06", ["B01003_001"])).toContain("for=state:06");
    expect(acsApiUrl("acs5", 2024, "US", ["B01003_001"])).toContain("for=us:1");
  });
  it("refuses malformed ids and cells", () => {
    expect(acsApiUrl("acs5", 2024, "6037", ["B01003_001"])).toBeNull();
    expect(acsApiUrl("acs5", 2024, "06", ["B01003_001&key=x"])).toBeNull();
    expect(acsApiUrl("acs5", 2024, "06", [])).toBeNull();
    expect(acsApiUrl("acs5", 2024, "06037", ["B01003_001"])).not.toContain("key=");
  });
});
