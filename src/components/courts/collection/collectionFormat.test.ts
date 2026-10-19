import { describe, expect, it } from "vitest";
import {
  competitionRanks,
  correlationSummary,
  countedOptions,
  decadeLabel,
  decadeOf,
  hasPlacePage,
  heat,
  latestCompleteYear,
  loadShort,
  maxOf,
  megabytes,
  NOT_RECORDED,
  ofText,
  partialYearText,
  peakCompleteYear,
  rhoText,
  rowShares,
  sharePct,
  spanYears,
  stateName,
  thinYears,
  yearRuns,
  yearsText,
  yearTick,
} from "./collectionFormat";

describe("partial years", () => {
  it("labels the snapshot year and stars its tick", () => {
    expect(partialYearText("2026-09-30")).toBe("partial year, through Sep 30, 2026");
    expect(partialYearText(null)).toBe("partial year");
    expect(partialYearText("not a date")).toBe("partial year");
    expect(yearTick(2026, true)).toBe("2026*");
    expect(yearTick(2025, false)).toBe("2025");
  });

  const years = [
    { year: 2024, partial: false, n: 1228927 },
    { year: 2025, partial: false, n: 1398348 },
    { year: 2026, partial: true, n: 1136265 },
  ];
  it("never picks the partial year as the latest complete year or as a peak", () => {
    expect(latestCompleteYear(years)!.year).toBe(2025);
    expect(latestCompleteYear([{ year: 2026, partial: true }])).toBeNull();
    // Even a partial year that out-counts every complete one is not the peak.
    const big = [...years, { year: 2027, partial: true, n: 9e9 }];
    expect(peakCompleteYear(big, (y) => y.n)!.year).toBe(2025);
    expect(peakCompleteYear([{ year: 2026, partial: true, n: 1 }], (y) => y.n)).toBeNull();
    expect(peakCompleteYear(years, () => null)).toBeNull();
  });

  it("limits a series to the recent years unless all years are asked for", () => {
    const series = [{ year: 1900 }, { year: 1989 }, { year: 1990 }, { year: 2026 }];
    expect(spanYears(series, undefined, 1990).map((y) => y.year)).toEqual([1990, 2026]);
    expect(spanYears(series, "all", 1990)).toHaveLength(4);
  });

  it("names the thin years of a series and writes runs of years", () => {
    const reports = [
      { year: 1987, reports: 5 },
      { year: 1988, reports: 4 },
      { year: 2011, reports: 2515 },
      { year: 2012, reports: 2399 },
      { year: 2021, reports: 14 },
      { year: 2022, reports: 12 },
    ];
    const thin = thinYears(reports, (r) => r.reports);
    expect([...thin].sort()).toEqual([1987, 1988, 2021, 2022]);
    expect(yearRuns([...thin])).toBe("1987–1988, 2021–2022");
    expect(yearRuns([2005])).toBe("2005");
    expect(yearRuns([])).toBe("");
    expect(thinYears([{ year: 1, reports: 0 }], (r) => r.reports).size).toBe(0);
    expect(thinYears([{ year: 1, reports: 3 }], () => null).size).toBe(0);
  });

  it("groups years into decades", () => {
    expect(decadeOf(2009)).toBe(2000);
    expect(decadeOf(1980)).toBe(1980);
    expect(decadeLabel(1980)).toBe("1980s");
  });
});

describe("shares and ranks", () => {
  it("divides a part by its whole and gives nothing for a zero or unknown whole", () => {
    expect(sharePct(25, 200)).toBe(12.5);
    expect(sharePct(5, 0)).toBeNull();
    expect(sharePct(null, 10)).toBeNull();
    expect(sharePct(5, null)).toBeNull();
  });

  it("ranks competitively: ties share the lowest number and a missing value has no rank", () => {
    expect(competitionRanks([50, 100, 100, 10, null])).toEqual([3, 1, 1, 4, null]);
    expect(competitionRanks([])).toEqual([]);
    expect(competitionRanks([null, null])).toEqual([null, null]);
    expect(competitionRanks([7])).toEqual([1]);
  });

  it("gives each cell its share of the row, and none at all for a row with a missing cell", () => {
    const shares = rowShares([50, 25, 25]);
    expect(shares).toEqual([50, 25, 25]);
    expect(rowShares([1, null, 3])).toEqual([null, null, null]);
    expect(rowShares([0, 0])).toEqual([null, null]);
    expect(rowShares([10])).toEqual([100]);
  });

  it("scales a heat tint into a faint wash and a bar, and shows nothing for a missing or zero cell", () => {
    expect(heat(null, 50)).toEqual({ alpha: 0, bar: 0 });
    expect(heat(0, 50)).toEqual({ alpha: 0, bar: 0 });
    expect(heat(5, 0)).toEqual({ alpha: 0, bar: 0 });
    const top = heat(50, 50);
    expect(top).toEqual({ alpha: 30, bar: 100 });
    const small = heat(0.5, 50);
    expect(small.alpha).toBeGreaterThanOrEqual(4);
    expect(small.alpha).toBeLessThan(top.alpha);
    expect(small.bar).toBeGreaterThanOrEqual(2);
    // A value above the maximum cannot overflow the bar.
    expect(heat(500, 50).bar).toBe(100);
    expect(maxOf([[1, null, 3], [2]])).toBe(3);
    expect(maxOf([])).toBe(0);
  });
});

describe("places", () => {
  it("names states, DC and territories and links a place page for the 50 states and DC only", () => {
    expect(stateName("CA")).toBe("California");
    expect(stateName("DC")).toBe("District of Columbia");
    expect(stateName("PR")).toBe("Puerto Rico");
    expect(stateName("VI")).toBe("U.S. Virgin Islands");
    expect(stateName("ZZ")).toBe("ZZ");
    expect(hasPlacePage("CA")).toBe(true);
    expect(hasPlacePage("DC")).toBe(true);
    for (const t of ["PR", "GU", "AS", "MP", "VI", "ZZ"]) expect(hasPlacePage(t)).toBe(false);
  });
});

describe("text", () => {
  it("writes sizes, ages and correlations, and Not recorded for unknowns", () => {
    expect(megabytes(691.9)).toBe("691.9 MB");
    expect(megabytes(0)).toBe("< 0.1 MB");
    expect(megabytes(55252.6)).toBe("55,252.6 MB");
    expect(megabytes(null)).toBe(NOT_RECORDED);
    expect(yearsText(8)).toBe("8.0 years");
    expect(yearsText(null)).toBe(NOT_RECORDED);
    expect(rhoText(0.969)).toBe("+0.969");
    expect(rhoText(-0.222)).toBe("−0.222");
    expect(rhoText(0)).toBe("0.000");
    expect(rhoText(null)).toBe(NOT_RECORDED);
    expect(ofText(3, 10)).toBe("3 of 10");
    expect(ofText(null, 10)).toBe(NOT_RECORDED);
  });

  it("words how a table is loaded", () => {
    expect(loadShort("none")).toBe("No bulk file");
    expect(loadShort("selected")).toBe("Selected columns");
    expect(loadShort("unknown")).toBe(NOT_RECORDED);
  });

  it("counts option values, most frequent first, and ignores blanks", () => {
    expect(countedOptions(["b", "a", "b", null, undefined, "", "c", "a", "b"])).toEqual([
      { id: "b", label: "b", count: 3 },
      { id: "a", label: "a", count: 2 },
      { id: "c", label: "c", count: 1 },
    ]);
  });
});

describe("correlation summary", () => {
  const pair = (n: number, ap: string, as: string, bp: string, bs: string) => ({
    n,
    a: { period: ap, source: as },
    b: { period: bp, source: bs },
  });
  it("names the districts, the fiscal years and the sources a set of pairs covers", () => {
    const s = correlationSummary([
      pair(94, "FY2025", "FJC IDB", "12 months ending Sept 30, 2025", "FCMS"),
      pair(91, "FY2025", "FJC IDB", "FY2025", "Judicial Business C-4A"),
    ]);
    expect(s.districts).toBe(94);
    expect(s.periods).toEqual(["FY2025"]);
    expect(s.sources).toEqual(["FJC IDB", "FCMS", "Judicial Business C-4A"]);
  });
  it("is empty for no pairs", () => {
    expect(correlationSummary([])).toEqual({ districts: null, periods: [], sources: [] });
  });
});
