import { describe, expect, it } from "vitest";
import type { CaseloadYear, ShareRow } from "@/lib/external/courtCaseload.functions";
import {
  barWidth,
  circuitShort,
  days,
  daysDelta,
  districtSearchText,
  fillCountGaps,
  fillYearGaps,
  firstMedianYear,
  fyLabel,
  isCleanBand,
  latestComplete,
  longDate,
  medianRows,
  monthsFromDays,
  NOT_RECORDED,
  ordinal,
  partialText,
  priorYear,
  rankChip,
  shortCourtName,
  signedPctOf,
  topShares,
  volumeRows,
} from "./caseloadFormat";

const year = (fy: number, over: Partial<CaseloadYear> = {}): CaseloadYear => ({
  fy,
  partial: false,
  filings: null,
  terminations: null,
  pendingEnd: null,
  medianDays: null,
  p25Days: null,
  p75Days: null,
  p90Days: null,
  classActionPct: null,
  proSePct: null,
  productPct: null,
  juryDemandedPct: null,
  settledPct: null,
  trialPct: null,
  withMdlNumber: null,
  mdlTransferIn: null,
  mdlOriginating: null,
  ...over,
});

describe("labels", () => {
  it("marks only the year in progress", () => {
    expect(fyLabel(2025)).toBe("FY2025");
    expect(fyLabel(2026, true)).toBe("FY2026*");
  });

  it("writes ordinals, including the teens", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 94, 101, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "94th",
      "101st",
      "111th",
    ]);
    expect(ordinal(-1)).toBe(NOT_RECORDED);
    expect(ordinal(1.5)).toBe(NOT_RECORDED);
  });

  it("words a rank chip with the direction of rank 1 in its tooltip", () => {
    const chip = rankChip({ metric: "median_days", rank: 55, of: 94 }, 2025);
    expect(chip.text).toBe("55th of 94 by median days");
    expect(chip.title).toContain("1st is the longest median time to termination");
    expect(chip.title).toContain("Ties share the lowest number");
    expect(rankChip({ metric: "filings", rank: 6, of: 94 }, 2025).text).toBe(
      "6th of 94 by filings",
    );
  });

  it("shows days and day changes, and Not recorded for unknowns", () => {
    expect(days(200)).toBe("200 days");
    expect(days(1597.5)).toBe("1,598 days");
    expect(days(null)).toBe(NOT_RECORDED);
    expect(daysDelta(-424)).toBe("−424 days");
    expect(daysDelta(12)).toBe("+12 days");
    expect(daysDelta(0)).toBe("no change");
    expect(daysDelta(null)).toBe(NOT_RECORDED);
    expect(monthsFromDays(200)).toBe("6.6 months");
    expect(monthsFromDays(undefined)).toBe(NOT_RECORDED);
  });

  it("computes a signed change only from two known numbers", () => {
    expect(signedPctOf(10708, 8385)).toBe("+27.7%");
    expect(signedPctOf(100, 0)).toBe(NOT_RECORDED);
    expect(signedPctOf(null, 5)).toBe(NOT_RECORDED);
  });
});

describe("dates", () => {
  it("formats a calendar date without a time-zone shift", () => {
    expect(longDate("2026-06-30")).toBe("Jun 30, 2026");
    expect(longDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(longDate("2026-13-01")).toBeNull();
    expect(longDate("June 30")).toBeNull();
    expect(longDate(null)).toBeNull();
  });

  it("says a partial year is partial even without a cut-off date", () => {
    expect(partialText("2026-06-30")).toBe("partial year, through Jun 30, 2026");
    expect(partialText(null)).toBe("partial year");
    expect(partialText("nonsense")).toBe("partial year");
  });
});

describe("court names", () => {
  it("shortens a district name and spells out the initials for search", () => {
    expect(shortCourtName("District Court, N.D. California")).toBe("N.D. California");
    expect(shortCourtName("District Court, Virgin Islands")).toBe("Virgin Islands");
    expect(shortCourtName("Supreme Court")).toBe("Supreme Court");
    const text = districtSearchText({
      id: "cand",
      name: "District Court, N.D. California",
      state: "CA",
      circuit: "Ninth Circuit",
    });
    expect(text).toContain("Northern California");
    expect(text).toContain("cand");
    expect(text).toContain("Ninth Circuit");
  });

  it("shortens circuit labels and leaves unknown labels whole", () => {
    expect(circuitShort("Ninth Circuit")).toBe("9th");
    expect(circuitShort("Eleventh Circuit")).toBe("11th");
    expect(circuitShort("D.C. Circuit")).toBe("D.C.");
    expect(circuitShort("Federal Circuit")).toBe("Federal Circuit");
    expect(circuitShort(null)).toBe(NOT_RECORDED);
  });
});

describe("series helpers", () => {
  const series = [
    year(2023, { filings: 1 }),
    year(2024, { filings: 2 }),
    year(2025, { filings: 3 }),
    year(2026, { filings: 4, partial: true }),
  ];

  it("finds the latest complete year and the year before one", () => {
    expect(latestComplete(series)?.fy).toBe(2025);
    expect(priorYear(series, 2025)?.fy).toBe(2024);
    expect(priorYear(series, 2023)).toBeNull();
    expect(latestComplete([year(2026, { partial: true })])).toBeNull();
  });

  it("draws the partial year as a dashed hop from the last complete year, never as a point on the solid line", () => {
    const rows = volumeRows(series);
    expect(rows.map((r) => r.filings)).toEqual([1, 2, 3, null]);
    expect(rows.map((r) => r.filingsPartial)).toEqual([null, null, 3, 4]);
    expect(rows[3]!.label).toBe("2026*");
    expect(rows[2]!.label).toBe("2025");
  });

  it("keeps an unknown value null, not zero", () => {
    const rows = volumeRows([year(2024), year(2025, { filings: 5 })]);
    expect(rows[0]!.filings).toBeNull();
    expect(rows[0]!.pending).toBeNull();
  });

  it("fills the missing years between a series' first and last with empty rows", () => {
    const filled = fillYearGaps([
      year(2012, { filings: 22 }),
      year(2014, { filings: 0 }),
      year(2016, { filings: 0 }),
    ]);
    expect(filled.map((y) => y.fy)).toEqual([2012, 2013, 2014, 2015, 2016]);
    expect(filled[1]!.filings).toBeNull();
    expect(filled[2]!.filings).toBe(0);
    expect(fillYearGaps([year(2020)])).toHaveLength(1);
  });
});

describe("median days band", () => {
  it("is clean only when p25 <= median <= p75 and all three are recorded", () => {
    expect(isCleanBand({ medianDays: 200, p25Days: 100, p75Days: 400 })).toBe(true);
    expect(isCleanBand({ medianDays: 100, p25Days: 100, p75Days: 100 })).toBe(true);
    expect(isCleanBand({ medianDays: 500, p25Days: 100, p75Days: 400 })).toBe(false);
    expect(isCleanBand({ medianDays: 50, p25Days: 100, p75Days: 400 })).toBe(false);
    expect(isCleanBand({ medianDays: 200, p25Days: null, p75Days: 400 })).toBe(false);
    expect(isCleanBand({ medianDays: null, p25Days: 100, p75Days: 400 })).toBe(false);
  });

  it("draws the band only for clean complete years and keeps earlier years blank", () => {
    const rows = medianRows([
      year(1999),
      year(2000, { medianDays: 300, p25Days: 100, p75Days: 400 }),
      year(2001, { medianDays: 300, p25Days: 400, p75Days: 100 }),
      year(2002, { medianDays: 250, p25Days: 90, p75Days: 500, partial: true }),
    ]);
    expect(rows.map((r) => r.band)).toEqual([null, [100, 400], null, null]);
    expect(rows.map((r) => r.median)).toEqual([null, 300, 300, null]);
    expect(rows[3]!.medianPartial).toBe(250);
    expect(rows[1]!.medianPartial).toBeNull();
  });

  it("lines up the national median by year, leaving out the national partial year", () => {
    const rows = medianRows(
      [year(2024, { medianDays: 240 }), year(2025, { medianDays: 200 })],
      [
        year(2024, { medianDays: 452 }),
        year(2025, { medianDays: 410 }),
        year(2026, { medianDays: 1, partial: true }),
      ],
    );
    expect(rows.map((r) => r.national)).toEqual([452, 410]);
  });

  it("names the first year with a recorded median", () => {
    expect(
      firstMedianYear([
        year(1999),
        year(2001, { medianDays: 307 }),
        year(2002, { medianDays: 335 }),
      ]),
    ).toBe(2001);
    expect(firstMedianYear([year(1999)])).toBeNull();
  });
});

describe("mix lists", () => {
  const row = (label: string, sharePct: number | null, count: number | null): ShareRow => ({
    key: label,
    label,
    sharePct,
    count,
    group: null,
  });

  it("orders by share, then count, and puts rows without a share last", () => {
    const rows = [row("none", null, 99), row("b", 20, 5), row("a", 40, 1), row("c", 20, 9)];
    expect(topShares(rows, 10).map((r) => r.label)).toEqual(["a", "c", "b", "none"]);
    expect(topShares(rows, 2).map((r) => r.label)).toEqual(["a", "c"]);
  });

  it("scales a bar to the largest share and never hides a recorded value", () => {
    expect(barWidth(50, 100)).toBe(50);
    expect(barWidth(100, 100)).toBe(100);
    expect(barWidth(0.1, 100)).toBe(1);
    expect(barWidth(null, 100)).toBe(0);
    expect(barWidth(5, 0)).toBe(0);
    expect(barWidth(0, 100)).toBe(0);
  });
});

describe("fillCountGaps", () => {
  it("adds a zero for each year between the first and last that has no count", () => {
    const rows = fillCountGaps(
      [
        { fy: 2011, value: 7, partial: false },
        { fy: 2008, value: 3, partial: false },
        { fy: 2013, value: 2, partial: false },
      ],
      (fy) => ({ fy, value: 0, partial: false }),
    );
    expect(rows.map((r) => [r.fy, r.value])).toEqual([
      [2008, 3],
      [2009, 0],
      [2010, 0],
      [2011, 7],
      [2012, 0],
      [2013, 2],
    ]);
    expect(
      fillCountGaps([{ fy: 2020, value: 1, partial: false }], (fy) => ({
        fy,
        value: 0,
        partial: false,
      })),
    ).toHaveLength(1);
    expect(fillCountGaps([], (fy) => ({ fy, value: 0, partial: false }))).toEqual([]);
  });
});
