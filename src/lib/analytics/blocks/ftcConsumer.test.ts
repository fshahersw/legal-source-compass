import { describe, expect, it } from "vitest";
import type { DncMonth, HsrFiscalYear, HsrSeries, OfficialMonth } from "@/lib/external/ftcData";
import {
  buildDncMonthly,
  buildDncRobocallShare,
  buildHsrEarlyTerminations,
  firstFiscalYearIsPartial,
  fiscalYearOf,
  mergeMonths,
} from "./ftcConsumer";

const month = (key: string, over: Partial<DncMonth> = {}): DncMonth => ({
  month: key,
  complete: true,
  method: "count",
  calls: 1000,
  robocalls: 700,
  notRobocalls: 250,
  noFlag: 50,
  robocallSharePct: 73.7,
  firstDay: null,
  lastDay: null,
  daysCovered: 30,
  daysInMonth: 30,
  subjects: [],
  sourceUrl: null,
  ...over,
});
const official = (key: string, robocall: number, live: number): OfficialMonth => ({
  month: key,
  total: robocall + live,
  robocall,
  live,
  sourceUrl: null,
});

describe("mergeMonths", () => {
  it("prefers the build's own count and adds the FTC dashboard only for a month the build did not count", () => {
    const m = mergeMonths(
      [month("2026-05", { calls: 233346, robocalls: 176472, notRobocalls: 56874 })],
      [official("2026-05", 1, 1), official("2026-04", 170295, 62553)],
    );
    expect([...m.keys()].sort()).toEqual(["2026-04", "2026-05"]);
    expect(m.get("2026-05")!.calls).toBe(233346);
    expect(m.get("2026-04")).toMatchObject({
      calls: 232848,
      robocalls: 170295,
      origin: "dashboard",
    });
  });
});

describe("buildDncMonthly", () => {
  it("returns null when no month is held", () => {
    expect(buildDncMonthly({ months: [], official: [], asOf: null })).toBeNull();
  });
  it("leaves uncounted months between two counted ones as gaps, never zero", () => {
    const block = buildDncMonthly({
      months: [month("2026-06"), month("2026-09")],
      official: [],
      asOf: null,
    })!;
    const all = block.series[0]!.points;
    expect(all.map((p) => p.x)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(all.map((p) => p.value)).toEqual([1000, null, null, 1000]);
    expect(block.gaps).toBe(4); // two gaps in each of the two series
  });
  it("marks a partial month, never makes it the latest value, and says which days it covers", () => {
    const block = buildDncMonthly({
      months: [
        month("2026-08", { method: "records", firstDay: "2026-08-01", lastDay: "2026-08-31" }),
        month("2026-09", {
          method: "records",
          complete: false,
          firstDay: "2026-09-01",
          lastDay: "2026-09-20",
          calls: 400,
          robocalls: 300,
        }),
      ],
      official: [],
      asOf: "2026-09-20",
    })!;
    expect(block.series[0]!.points.at(-1)).toMatchObject({
      x: "2026-09",
      value: 400,
      partial: true,
    });
    expect(block.latest?.period).toBe("August 2026");
    expect(block.notes.join(" ")).toContain("complaints created August 1 to September 20, 2026");
    expect(block.notes.join(" ")).toMatch(/August 2026 and September 2026: every record was read/);
    expect(block.notes.join(" ")).toMatch(/September 2026\* covers only the days stated above/);
  });
  it("labels months that come from the FTC dashboard", () => {
    const block = buildDncMonthly({
      months: [],
      official: [official("2026-04", 170295, 62553), official("2026-05", 176472, 56874)],
      asOf: null,
    })!;
    expect(block.series[1]!.points.map((p) => p.value)).toEqual([170295, 176472]);
    expect(block.notes.join(" ")).toMatch(
      /April 2026, May 2026\) are the figures on the FTC's Do Not Call Complaints dashboard/,
    );
  });
});

describe("buildDncRobocallShare", () => {
  it("computes robocall / (robocall + not robocall) and leaves a month with no answers as a gap", () => {
    const block = buildDncRobocallShare({
      months: [
        month("2026-07", { robocalls: 700, notRobocalls: 300 }),
        month("2026-08", { robocalls: null, notRobocalls: null }),
        month("2026-09", { robocalls: 3, notRobocalls: 1 }),
      ],
      official: [],
      asOf: null,
    })!;
    expect(block.format).toBe("pct");
    expect(block.series[0]!.points.map((p) => p.value)).toEqual([70, null, 75]);
    expect(block.latest?.value).toBe(75);
    expect(block.latest?.change).toBeNull(); // August is not recorded, so no change is claimed
    expect(block.latest?.changeNote).toMatch(/August 2026 is not recorded/);
  });
  it("is null when no month has both answers", () => {
    expect(
      buildDncRobocallShare({
        months: [month("2026-07", { robocalls: null })],
        official: [],
        asOf: null,
      }),
    ).toBeNull();
  });
});

describe("fiscal-year helpers", () => {
  it("labels a date by the fiscal year it ends in", () => {
    expect(fiscalYearOf("2026-09-30")).toBe(2026);
    expect(fiscalYearOf("2026-10-01")).toBe(2027);
    expect(fiscalYearOf("garbage")).toBeNull();
    expect(fiscalYearOf(null)).toBeNull();
  });
  it("calls the first fiscal year partial only when the first notice is after October 1", () => {
    expect(firstFiscalYearIsPartial("1999-01-04")).toBe(1999);
    expect(firstFiscalYearIsPartial("1998-10-01")).toBeNull();
    expect(firstFiscalYearIsPartial(null)).toBeNull();
  });
});

const series = (
  fiscal: [number, number][],
  first = "1999-01-04",
  last = "2026-10-21",
): HsrSeries => ({
  calendar: [],
  fiscal: fiscal.map(([year, count]) => ({ year, count })),
  undated: 0,
  notices: fiscal.reduce((a, [, c]) => a + c, 0),
  firstDate: first,
  lastDate: last,
});
const fy = (n: number, etGranted: number | null): HsrFiscalYear => ({
  fy: n,
  partial: false,
  transactions: null,
  filings: null,
  secondRequests: null,
  etRequested: null,
  etGranted,
  etNotGranted: null,
});

describe("buildHsrEarlyTerminations", () => {
  it("draws the API's notices and the FTC table side by side, with years before the API starts as gaps", () => {
    const block = buildHsrEarlyTerminations({
      series: series([
        [1999, 800],
        [2000, 900],
        [2021, 439],
        [2025, 252],
        [2026, 700],
        [2027, 27],
      ]),
      filings: [fy(1998, 1100), fy(1999, 1300), fy(2022, 5), fy(2025, 265)],
    })!;
    const api = block.series[0]!.points;
    expect(api[0]).toMatchObject({ x: "1998", value: null });
    expect(api.find((p) => p.x === "1999")).toMatchObject({ value: 800, partial: true });
    expect(api.find((p) => p.x === "2022")!.value).toBe(0); // between the first and last notice: no notice published
    expect(api.at(-1)).toMatchObject({ x: "2027", value: 27, partial: true });
    expect(block.series[1]!.points.find((p) => p.x === "2022")!.value).toBe(5);
    expect(block.series[1]!.points.find((p) => p.x === "2026")!.value).toBeNull();
    expect(block.latest?.period).toBe("FY2026");
    expect(block.markers).toEqual([{ x: "2021", label: "Suspended Feb 2021" }]);
    expect(block.notes.join(" ")).toMatch(/February 4, 2021/);
  });
  it("is null with no year in either file", () => {
    expect(buildHsrEarlyTerminations({ series: series([]), filings: [] })).toBeNull();
  });
});
