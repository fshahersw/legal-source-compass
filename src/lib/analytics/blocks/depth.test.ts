import { describe, expect, it } from "vitest";
import {
  buildCpscDeaths,
  buildCpscHazards,
  buildDojAmounts,
  buildDojDivisions,
  buildEpaPenalties,
  buildFaersOutcomes,
  buildFdaClassI,
  buildOshaPenalties,
  buildSaferProducts,
  buildSecAmounts,
  CPSC_INJURY_STATEMENT_FROM,
} from "./depth";
import type { TrendBlockData } from "../trend";

const values = (b: TrendBlockData, i = 0) => b.series[i]!.points.map((p) => p.value);
const xs = (b: TrendBlockData, i = 0) => b.series[i]!.points.map((p) => p.x);
const partialXs = (b: TrendBlockData, i = 0) =>
  b.series[i]!.points.filter((p) => p.partial).map((p) => p.x);
const noteWith = (b: TrendBlockData, text: string) => b.notes.some((n) => n.includes(text));

const TODAY = "2026-10-23";

describe("DOJ press releases by division", () => {
  const years = [
    { year: 2023, counts: { "Criminal Division": 400, "Tax Division": 170 } },
    { year: 2024, counts: { "Criminal Division": 405, "Tax Division": 150 } },
    { year: 2025, counts: { "Criminal Division": 408 } },
    { year: 2026, counts: { "Criminal Division": 330, "Tax Division": 2 } },
  ];
  const names = ["Criminal Division", "Tax Division"];

  it("draws one line per named division, counts an absent tag as zero releases, and flags the partial year", () => {
    const b = buildDojDivisions({ years, names, latestDate: "2026-10-22", today: TODAY })!;
    expect(b.chart).toBe("line");
    expect(b.series.map((s) => s.label)).toEqual(names);
    expect(values(b, 0)).toEqual([400, 405, 408, 330]);
    expect(values(b, 1)).toEqual([170, 150, 0, 2]);
    expect(partialXs(b)).toEqual(["2026"]);
  });
  it("reads the latest value from the first division and the last complete year", () => {
    const b = buildDojDivisions({ years, names, latestDate: "2026-10-22", today: TODAY })!;
    expect(b.latest?.period).toBe("2025");
    expect(b.latest?.value).toBe(408);
    expect(b.latest?.change?.absolute).toBe(3);
    expect(noteWith(b, "must not be added")).toBe(true);
    expect(noteWith(b, "four largest")).toBe(true);
    expect(noteWith(b, "October 22, 2026")).toBe(true);
  });
  it("leaves out the block with no years or no division names", () => {
    expect(buildDojDivisions({ years: [], names, latestDate: null, today: TODAY })).toBeNull();
    expect(buildDojDivisions({ years, names: [], latestDate: null, today: TODAY })).toBeNull();
  });
});

describe("DOJ and SEC releases by stated resolution size", () => {
  const dojYears = [
    { year: 2009, total: 80, bands: { tenM: 40, hundredM: 20, billion: 5 } },
    { year: 2010, total: 100, bands: { tenM: 60, hundredM: 22, billion: 6 } },
    { year: 2013, total: 900, bands: { tenM: 300, hundredM: 80, billion: 50 } },
    { year: 2014, total: 950, bands: { tenM: 380, hundredM: 90, billion: 60 } },
    { year: 2026, total: 700, bands: { tenM: 250, hundredM: 40, billion: 10 } },
  ];

  it("stacks the three bands, totals them for the latest value and never lets the partial year lead", () => {
    const b = buildDojAmounts({ years: dojYears, latestDate: "2026-10-22", today: TODAY })!;
    expect(b.stacked).toBe(true);
    expect(b.series.map((s) => s.id)).toEqual(["10m", "100m", "1b"]);
    const at = (i: number, x: string) => b.series[i]!.points.find((p) => p.x === x)?.value;
    expect([at(0, "2009"), at(1, "2010"), at(2, "2013"), at(0, "2014")]).toEqual([40, 22, 50, 380]);
    expect(partialXs(b)).toEqual(["2026"]);
    expect(b.latest?.period).toBe("2014");
    expect(b.latest?.value).toBe(380 + 90 + 60);
  });
  it("marks the year the dataset's coverage changes and says what changed", () => {
    const b = buildDojAmounts({ years: dojYears, latestDate: "2026-10-22", today: TODAY })!;
    expect(b.markers).toEqual([{ x: "2013", label: "Coverage changes" }]);
    expect(noteWith(b, "Before 2013")).toBe(true);
  });
  it("leaves a year the source does not list as a gap, never zero", () => {
    const b = buildDojAmounts({ years: dojYears, latestDate: "2026-10-22", today: TODAY })!;
    const at = (x: string) => b.series[0]!.points.find((p) => p.x === x)?.value;
    expect(at("2011")).toBeNull();
    expect(at("2012")).toBeNull();
    expect(b.gaps).toBeGreaterThan(0);
  });
  it("states the amount rule and that a stated figure is not a verified payment", () => {
    const b = buildDojAmounts({ years: dojYears, latestDate: null, today: TODAY })!;
    expect(noteWith(b, "not a verified payment")).toBe(true);
  });
  it("builds the SEC block from litigation releases only and flags the partial year", () => {
    const b = buildSecAmounts({
      years: [
        { year: 2024, bands: { tenM: 20, hundredM: 6, billion: 2 } },
        { year: 2025, bands: { tenM: 18, hundredM: 5, billion: 3 } },
        { year: 2026, bands: { tenM: 5, hundredM: 2, billion: 0 } },
      ],
      latestDate: "2026-10-21",
      today: TODAY,
    })!;
    expect(b.unit).toBe("litigation releases");
    expect(partialXs(b)).toEqual(["2026"]);
    expect(b.latest?.period).toBe("2025");
    expect(b.latest?.value).toBe(26);
    expect(b.latest?.change?.absolute).toBe(-2);
    expect(noteWith(b, "administrative proceedings are not read")).toBe(true);
  });
  it("leaves out an empty SEC or DOJ block", () => {
    expect(buildSecAmounts({ years: [], latestDate: null, today: TODAY })).toBeNull();
    expect(buildDojAmounts({ years: [], latestDate: null, today: TODAY })).toBeNull();
  });
});

describe("EPA and OSHA penalties", () => {
  it("shows EPA fiscal years up to the latest complete one, keeps an unrecorded year as a gap and names the peak", () => {
    const b = buildEpaPenalties({
      years: [
        { fy: 2013, penalty: 1_000_000 },
        { fy: 2014, penalty: null },
        { fy: 2015, penalty: 6_000_000_000 },
        { fy: 2016, penalty: 5_000_000 },
        { fy: 2027, penalty: 1 },
      ],
      latestCompleteFy: 2016,
      fileDate: "2026-10-17",
    })!;
    expect(b.xKind).toBe("fy");
    expect(b.format).toBe("usd");
    expect(xs(b)).toEqual(["2013", "2014", "2015", "2016"]);
    expect(values(b)).toEqual([1_000_000, null, 6_000_000_000, 5_000_000]);
    expect(b.latest?.period).toBe("FY2016");
    expect(b.latest?.value).toBe(5_000_000);
    expect(noteWith(b, "FY2015")).toBe(true);
    expect(noteWith(b, "settlements entered in that federal fiscal year")).toBe(true);
    expect(noteWith(b, "not when the case opened")).toBe(true);
    expect(b.asOf).toBe("2026-10-17");
  });
  it("falls back to the highest year in the file when no complete year is stated", () => {
    const b = buildEpaPenalties({
      years: [
        { fy: 2020, penalty: 10 },
        { fy: 2021, penalty: 20 },
      ],
      latestCompleteFy: null,
      fileDate: null,
    })!;
    expect(xs(b)).toEqual(["2020", "2021"]);
  });
  it("leaves out EPA when no year has a recorded penalty", () => {
    expect(
      buildEpaPenalties({
        years: [{ fy: 2020, penalty: null }],
        latestCompleteFy: 2020,
        fileDate: null,
      }),
    ).toBeNull();
    expect(buildEpaPenalties({ years: [], latestCompleteFy: null, fileDate: null })).toBeNull();
  });
  it("fades OSHA's later-than-complete fiscal year and keeps it out of the latest value", () => {
    const b = buildOshaPenalties({
      years: [
        { fy: 2023, penalty: 343_600_000 },
        { fy: 2024, penalty: 343_600_000 },
        { fy: 2025, penalty: 330_800_000 },
        { fy: 2026, penalty: 200_000_000, partial: true },
      ],
      snapshot: "2026-10-17",
    })!;
    expect(partialXs(b)).toEqual(["2026"]);
    expect(b.latest?.period).toBe("FY2025");
    expect(b.latest?.value).toBe(330_800_000);
    expect(noteWith(b, "FY2026*")).toBe(true);
    expect(noteWith(b, "not OSHA's official totals")).toBe(true);
    expect(noteWith(b, "blank amount adds nothing")).toBe(true);
    expect(noteWith(b, "failure-to-abate")).toBe(true);
  });
  it("leaves out OSHA with no recorded penalty", () => {
    expect(buildOshaPenalties({ years: [], snapshot: null })).toBeNull();
    expect(buildOshaPenalties({ years: [{ fy: 2024, penalty: null }], snapshot: null })).toBeNull();
  });
});

describe("FAERS outcomes", () => {
  const years = [
    { year: 2024, partial: false, serious: 701_934, deaths: 100_000, lawyer: 5_000 },
    { year: 2025, partial: false, serious: 711_668, deaths: 95_000, lawyer: null },
    { year: 2026, partial: true, serious: 360_000, deaths: 45_000, lawyer: 2_000 },
  ];
  it("draws serious, death and lawyer lines, with an unrecorded count as a gap", () => {
    const b = buildFaersOutcomes({ years, dataThrough: "2026-06-30" })!;
    expect(b.series.map((s) => s.id)).toEqual(["serious", "deaths", "lawyer"]);
    expect(values(b, 2)).toEqual([5_000, null, 2_000]);
    expect(partialXs(b)).toEqual(["2026"]);
    expect(b.latest?.value).toBe(711_668);
    expect(b.latest?.change?.absolute).toBe(9_734);
    expect(b.asOf).toBe("2026-06-30");
  });
  it("says the counts are reports and not incidence, and that the lines overlap", () => {
    const b = buildFaersOutcomes({ years, dataThrough: null })!;
    expect(noteWith(b, "not incidence")).toBe(true);
    expect(noteWith(b, "lines overlap")).toBe(true);
  });
  it("leaves out the block when no year has any count", () => {
    expect(buildFaersOutcomes({ years: [], dataThrough: null })).toBeNull();
    expect(
      buildFaersOutcomes({
        years: [{ year: 2024, partial: false, serious: null, deaths: null, lawyer: null }],
        dataThrough: null,
      }),
    ).toBeNull();
  });
});

describe("SaferProducts.gov reports", () => {
  it("explains a first partial year from the export's first date and flags a partial last year", () => {
    const b = buildSaferProducts({
      years: [
        { year: 2011, reports: 4_600, partial: true },
        { year: 2012, reports: 6_700, partial: false },
        { year: 2025, reports: 4_415, partial: false },
        { year: 2026, reports: 6_000, partial: true },
      ],
      window: { first: "2011-03-11", last: "2026-10-16" },
    })!;
    expect(partialXs(b)).toEqual(["2011", "2026"]);
    expect(b.latest?.period).toBe("2025");
    expect(b.latest?.value).toBe(4_415);
    expect(noteWith(b, "2011* starts on March 11, 2011")).toBe(true);
    expect(noteWith(b, "2026* runs through October 16, 2026")).toBe(true);
    expect(noteWith(b, "unverified consumer submissions")).toBe(true);
    expect(b.asOf).toBe("2026-10-16");
  });
  it("leaves out the block with no years", () => {
    expect(buildSaferProducts({ years: [], window: { first: null, last: null } })).toBeNull();
  });
});

describe("CPSC recalls by hazard and by death mention", () => {
  const years = [
    {
      year: 1999,
      partial: false,
      hazards: { fire_burn: 51, fall: 19, other: 15, choking: 23 },
      deathMentions: 2,
    },
    {
      year: 2000,
      partial: false,
      hazards: { fire_burn: 63, fall: 31, other: 26, choking: 36, laceration: 10, shock: 19 },
      deathMentions: 8,
    },
    {
      year: 2001,
      partial: false,
      hazards: { fire_burn: 70, fall: 20, other: 30, choking: 30, laceration: 12, shock: 25 },
      deathMentions: 4,
    },
    {
      year: 2026,
      partial: true,
      hazards: { fire_burn: 20, fall: 10, other: 3, choking: 5, laceration: 4, shock: 2 },
      deathMentions: 3,
    },
  ];
  const labels = { fire_burn: "Fire, burn and overheating", fall: "Fall", choking: "Choking" };

  it("draws the four most common hazards, most common first, and never draws the other group", () => {
    const b = buildCpscHazards({ years, labels, asOf: "2026-10-15" })!;
    expect(b.series.map((s) => s.id)).toEqual(["fire_burn", "choking", "fall", "shock"]);
    expect(b.series.some((s) => s.id === "other")).toBe(false);
    expect(b.series.map((s) => s.label).slice(0, 3)).toEqual([
      "Fire, burn and overheating",
      "Choking",
      "Fall",
    ]);
    expect(b.series[3]!.label).toBe("shock");
    expect(partialXs(b)).toEqual(["2026"]);
    expect(b.latest?.period).toBe("2001");
    expect(b.latest?.value).toBe(70);
  });
  it("never draws more lines than the chart palette has colours for", () => {
    const b = buildCpscHazards({ years, labels, asOf: null })!;
    expect(b.series.length).toBeLessThanOrEqual(4);
    expect(noteWith(b, "must not be added")).toBe(true);
  });
  it("leaves out the block when only the other group is present or there are no years", () => {
    expect(
      buildCpscHazards({
        years: [{ year: 2020, partial: false, hazards: { other: 9 }, deathMentions: 0 }],
        labels,
        asOf: null,
      }),
    ).toBeNull();
    expect(buildCpscHazards({ years: [], labels, asOf: null })).toBeNull();
  });
  it("starts the death-mention chart in the first year the injury statement is recorded, not earlier", () => {
    expect(CPSC_INJURY_STATEMENT_FROM).toBe(2000);
    const b = buildCpscDeaths({ years, asOf: "2026-10-15" })!;
    expect(xs(b)).toEqual([
      "2000",
      "2001",
      "2002",
      "2003",
      "2004",
      "2005",
      "2006",
      "2007",
      "2008",
      "2009",
      "2010",
      "2011",
      "2012",
      "2013",
      "2014",
      "2015",
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
    expect(b.series[0]!.points[0]!.value).toBe(8);
    expect(partialXs(b)).toEqual(["2026"]);
    expect(b.latest?.period).toBe("2001");
    expect(noteWith(b, "190 of 191")).toBe(true);
    expect(noteWith(b, "not a verified count of deaths")).toBe(true);
  });
  it("leaves out the death-mention chart when no year has an injury statement yet", () => {
    expect(
      buildCpscDeaths({
        years: [{ year: 1995, partial: false, hazards: {}, deathMentions: 0 }],
        asOf: null,
      }),
    ).toBeNull();
    expect(buildCpscDeaths({ years: [], asOf: null })).toBeNull();
  });
});

describe("FDA Class I recall entries", () => {
  const years = [
    { year: 2024, drug: 100, device: 400, food: 500 },
    { year: 2025, drug: 90, device: 400, food: 712 },
    { year: 2026, drug: 20, device: 200, food: 300 },
  ];
  it("stacks drug, device and food, totals them for the latest value and fades the partial year", () => {
    const b = buildFdaClassI({ years, latestDate: "2026-09-09", today: TODAY })!;
    expect(b.stacked).toBe(true);
    expect(b.series.map((s) => s.id)).toEqual(["drug", "device", "food"]);
    expect(partialXs(b, 0)).toEqual(["2026"]);
    expect(b.latest?.period).toBe("2025");
    expect(b.latest?.value).toBe(1_202);
    expect(b.latest?.change?.absolute).toBe(202);
    expect(noteWith(b, "not yet classified")).toBe(true);
    expect(noteWith(b, "September 9, 2026")).toBe(true);
  });
  it("leaves out the block with no years", () => {
    expect(buildFdaClassI({ years: [], latestDate: null, today: TODAY })).toBeNull();
  });
});
