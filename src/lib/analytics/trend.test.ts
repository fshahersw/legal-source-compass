import { describe, expect, it } from "vitest";
import {
  assembleBlock,
  changeDirection,
  compareX,
  congressIsOpen,
  congressYears,
  count,
  countGaps,
  densifyMonths,
  densifyYears,
  describePeriod,
  formatChange,
  formatCount,
  formatPct,
  formatTick,
  formatUsd,
  formatValue,
  longDate,
  markedPeriod,
  periodLabel,
  summarizeLatest,
  throughDate,
  tickLabel,
  yearPoints,
  type TrendSeries,
} from "./trend";

const series = (points: [string, number | null, boolean?][], label = "Filed"): TrendSeries => ({
  id: "s",
  label,
  points: points.map(([x, value, partial]) => ({ x, value, ...(partial ? { partial } : {}) })),
});

describe("formatting", () => {
  it("shows counts with grouping and an absent value as Not recorded", () => {
    expect(formatCount(303716)).toBe("303,716");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(null)).toBe("Not recorded");
    expect(formatCount(undefined)).toBe("Not recorded");
    expect(formatCount(Number.NaN)).toBe("Not recorded");
  });
  it("accepts only non-negative numbers as counts", () => {
    expect(count(5)).toBe(5);
    expect(count(0)).toBe(0);
    expect(count(-1)).toBeNull();
    expect(count("5")).toBeNull();
    expect(count(null)).toBeNull();
    expect(count(Infinity)).toBeNull();
  });
  it("writes dollars in whole units below a million and in words above", () => {
    expect(formatUsd(497)).toBe("$497");
    expect(formatUsd(12_537_194_708)).toBe("$12.54 billion");
    expect(formatUsd(3_400_000)).toBe("$3.4 million");
    expect(formatUsd(null)).toBe("Not recorded");
  });
  it("writes compact axis ticks", () => {
    expect(formatTick(0)).toBe("0");
    expect(formatTick(950)).toBe("950");
    expect(formatTick(1500)).toBe("1.5k");
    expect(formatTick(12000)).toBe("12k");
    expect(formatTick(450000)).toBe("450k");
    expect(formatTick(1_200_000)).toBe("1.2M");
    expect(formatTick(2_000_000)).toBe("2M");
    expect(formatTick(1500, "usd")).toBe("$1.5k");
  });
  it("writes percentages with one decimal and ticks as whole percents", () => {
    expect(formatPct(74.53)).toBe("74.5%");
    expect(formatPct(100)).toBe("100.0%");
    expect(formatPct(0)).toBe("0.0%");
    expect(formatPct(null)).toBe("Not recorded");
    expect(formatValue(74.53, "pct")).toBe("74.5%");
    expect(formatValue(12, "count")).toBe("12");
    expect(formatTick(74.53, "pct")).toBe("75%");
  });
});

describe("period labels", () => {
  it("names fiscal years, months, Congresses and plain years", () => {
    expect(periodLabel("2025", "fy")).toBe("FY2025");
    expect(periodLabel("2025", "year")).toBe("2025");
    expect(periodLabel("2026-10", "month")).toBe("October 2026");
    expect(periodLabel("118", "congress")).toBe("118th Congress (2023–2024)");
    expect(periodLabel("101", "congress")).toBe("101st Congress (1989–1990)");
    expect(periodLabel("112", "congress")).toBe("112th Congress (2011–2012)");
    expect(periodLabel("103", "congress")).toBe("103rd Congress (1993–1994)");
  });
  it("computes the calendar years of a Congress from its number", () => {
    expect(congressYears(1)).toBe("1789–1790");
    expect(congressYears(119)).toBe("2025–2026");
  });
  it("shortens axis labels", () => {
    expect(tickLabel("2025", "fy")).toBe("FY25");
    expect(tickLabel("2025-10", "month")).toBe("2025");
    expect(tickLabel("108", "congress")).toBe("108th");
    expect(tickLabel("2013", "year")).toBe("2013");
  });
  it("marks a partial period with an asterisk", () => {
    expect(markedPeriod({ x: "2026", value: 1, partial: true }, "fy")).toBe("FY2026*");
    expect(markedPeriod({ x: "2025", value: 1 }, "fy")).toBe("FY2025");
  });
  it("orders period keys numerically, not as text", () => {
    expect(["108", "97", "100"].sort(compareX)).toEqual(["97", "100", "108"]);
    expect(["2026-10", "2026-02", "1981-01"].sort(compareX)).toEqual([
      "1981-01",
      "2026-02",
      "2026-10",
    ]);
  });
  it("describes the period of a block with a trailing asterisk for a partial end", () => {
    expect(
      describePeriod(
        [
          series([
            ["100", 1],
            ["97", 2],
            ["119", 3, true],
          ]),
        ],
        "congress",
      ),
    ).toBe("97th Congress (1981–1982)–119th Congress (2025–2026)*");
    expect(describePeriod([series([["2020", 1]])], "year")).toBe("2020");
    expect(describePeriod([], "year")).toBe("");
  });
});

describe("summarizeLatest", () => {
  it("takes the last complete recorded period and compares it with the one before", () => {
    const s = series([
      ["2023", 100],
      ["2024", 110],
      ["2025", 121],
      ["2026", 50, true],
    ]);
    const latest = summarizeLatest(s, "fy")!;
    expect(latest.period).toBe("FY2025");
    expect(latest.value).toBe(121);
    expect(latest.change).toEqual({
      comparedWith: "FY2024",
      previousValue: 110,
      absolute: 11,
      percent: 10,
    });
    expect(latest.changeNote).toBeNull();
  });
  it("never uses a partial period as the latest value", () => {
    const latest = summarizeLatest(series([["2025", 10, true]]), "year");
    expect(latest).toBeNull();
  });
  it("withholds the change when the earlier period is not recorded", () => {
    const latest = summarizeLatest(
      series([
        ["2024", null],
        ["2025", 8],
      ]),
      "year",
    )!;
    expect(latest.change).toBeNull();
    expect(latest.changeNote).toContain("2024 is not recorded");
  });
  it("withholds the change when the earlier period is only partial", () => {
    const latest = summarizeLatest(
      series([
        ["2011", 5, true],
        ["2012", 8],
      ]),
      "year",
    )!;
    expect(latest.change).toBeNull();
    expect(latest.changeNote).toContain("complete period");
  });
  it("says there is nothing to compare with for a single period", () => {
    const latest = summarizeLatest(series([["2025", 8]]), "year")!;
    expect(latest.change).toBeNull();
    expect(latest.changeNote).toBe("No earlier period to compare with.");
  });
  it("gives no percentage against a zero", () => {
    const latest = summarizeLatest(
      series([
        ["2024", 0],
        ["2025", 8],
      ]),
      "year",
    )!;
    expect(latest.change?.percent).toBeNull();
    expect(latest.change?.absolute).toBe(8);
  });
  it("skips trailing gaps to the last recorded period", () => {
    const latest = summarizeLatest(
      series([
        ["2023", 4],
        ["2024", 6],
        ["2025", null],
      ]),
      "year",
    )!;
    expect(latest.period).toBe("2024");
    expect(latest.value).toBe(6);
  });
  it("compares with the period `lag` earlier", () => {
    const pts: [string, number | null][] = [];
    for (let m = 1; m <= 12; m += 1) pts.push([`2025-${String(m).padStart(2, "0")}`, 40 + m]);
    pts.push(["2026-01", 30]);
    const latest = summarizeLatest(series(pts), "month", { lag: 12 })!;
    expect(latest.period).toBe("January 2026");
    expect(latest.change?.comparedWith).toBe("January 2025");
    expect(latest.change?.absolute).toBe(30 - 41);
  });
  it("is null for a series with no recorded value", () => {
    expect(summarizeLatest(series([["2025", null]]), "year")).toBeNull();
    expect(summarizeLatest(series([]), "year")).toBeNull();
  });
});

describe("change text", () => {
  it("writes the sign, the amount, the percentage and what it is compared with", () => {
    expect(
      formatChange({
        comparedWith: "FY2024",
        previousValue: 291016,
        absolute: 12700,
        percent: 4.3639,
      }),
    ).toBe("+12,700 (+4.4%) vs FY2024");
    expect(
      formatChange({ comparedWith: "2024", previousValue: 998, absolute: -433, percent: -43.4 }),
    ).toBe("−433 (−43.4%) vs 2024");
    expect(
      formatChange({ comparedWith: "2024", previousValue: 0, absolute: 8, percent: null }),
    ).toBe("+8 vs 2024");
    expect(formatChange({ comparedWith: "2024", previousValue: 5, absolute: 0, percent: 0 })).toBe(
      "0 (0.0%) vs 2024",
    );
  });
  it("writes a change in a percentage series in percentage points, never as a percent of a percent", () => {
    expect(
      formatChange(
        { comparedWith: "August 2026", previousValue: 71.2, absolute: 3.3, percent: 4.6 },
        "pct",
      ),
    ).toBe("+3.3 percentage points vs August 2026");
    expect(
      formatChange(
        { comparedWith: "2025", previousValue: 80, absolute: -1.25, percent: -1.6 },
        "pct",
      ),
    ).toBe("−1.3 percentage points vs 2025");
  });
  it("reads the direction", () => {
    expect(changeDirection({ comparedWith: "x", previousValue: 1, absolute: 2, percent: 1 })).toBe(
      "up",
    );
    expect(changeDirection({ comparedWith: "x", previousValue: 3, absolute: -1, percent: 1 })).toBe(
      "down",
    );
    expect(changeDirection({ comparedWith: "x", previousValue: 3, absolute: 0, percent: 0 })).toBe(
      "flat",
    );
  });
});

describe("years and months", () => {
  it("turns a missing year into an explicit gap", () => {
    const pts = yearPoints([
      { year: 2020, value: 5 },
      { year: 2023, value: 9, partial: true },
    ]);
    expect(pts.map((p) => p.x)).toEqual(["2020", "2021", "2022", "2023"]);
    expect(pts.map((p) => p.value)).toEqual([5, null, null, 9]);
    expect(pts[3]!.partial).toBe(true);
    expect(countGaps([{ id: "s", label: "s", points: pts }])).toBe(2);
  });
  it("keeps the first entry of a duplicated year and drops non-integer years", () => {
    const pts = yearPoints([
      { year: 2020, value: 5 },
      { year: 2020, value: 99 },
      { year: 2020.5, value: 7 },
    ]);
    expect(pts).toEqual([{ x: "2020", value: 5 }]);
  });
  it("densifies congress keys only when they are integers, leaving other keys untouched", () => {
    expect(densifyYears([{ x: "a", value: 1 }])).toEqual([{ x: "a", value: 1 }]);
    expect(densifyYears([])).toEqual([]);
  });
  it("lists every month between two months, null where unknown", () => {
    const pts = densifyMonths(
      new Map([
        ["2025-11", 3],
        ["2026-02", 4],
      ]),
      "2025-11",
      "2026-02",
    );
    expect(pts).toEqual([
      { x: "2025-11", value: 3 },
      { x: "2025-12", value: null },
      { x: "2026-01", value: null },
      { x: "2026-02", value: 4 },
    ]);
  });
});

describe("dates", () => {
  it("reads the date a snapshot description runs through", () => {
    expect(
      throughDate(
        "cv88on.zip, last modified 2026-08-26 on fjc.gov; filing dates through 2026-06-30",
      ),
    ).toBe("2026-06-30");
    expect(throughDate("cr96on.zip: fiscal-year snapshots FY1996 through June 30, 2026")).toBe(
      "2026-06-30",
    );
    expect(
      throughDate("SCAC is restructuring; its data run through 2025-07-28 (6,879 filings)"),
    ).toBe("2025-07-28");
    expect(throughDate("through 2026-13-45")).toBeNull();
    expect(throughDate("no date here")).toBeNull();
    expect(throughDate(null)).toBeNull();
  });
  it("writes a long date", () => {
    expect(longDate("2026-06-30")).toBe("June 30, 2026");
    expect(longDate("not a date")).toBe("not a date");
  });
  it("knows which Congress is still sitting", () => {
    expect(congressIsOpen(119, "2026-10-22")).toBe(true);
    expect(congressIsOpen(118, "2026-10-22")).toBe(false);
    expect(congressIsOpen(119, "2027-01-03")).toBe(false);
    expect(congressIsOpen(119, "2027-01-02")).toBe(true);
    expect(congressIsOpen(5, "1798-01-01")).toBe(false);
  });
});

describe("assembleBlock", () => {
  it("takes the latest value from `latestFrom` when given, and counts gaps and markers", () => {
    const parts = [
      series(
        [
          ["2024", 3],
          ["2025", 4],
        ],
        "Part A",
      ),
      series(
        [
          ["2024", 1],
          ["2025", null],
        ],
        "Part B",
      ),
    ];
    const total = series(
      [
        ["2024", 4],
        ["2025", 4],
      ],
      "Total",
    );
    const block = assembleBlock({
      id: "t",
      xKind: "year",
      unit: "things",
      series: parts,
      latestFrom: total,
      markers: [{ x: "2025", label: "Break" }],
      source: { label: "Source", url: "https://example.gov/" },
    });
    expect(block.latest?.seriesLabel).toBe("Total");
    expect(block.latest?.value).toBe(4);
    expect(block.gaps).toBe(1);
    expect(block.markers).toEqual([{ x: "2025", label: "Break" }]);
    expect(block.chart).toBe("line");
    expect(block.stacked).toBe(false);
    expect(block.period).toBe("2024–2025");
  });
});
