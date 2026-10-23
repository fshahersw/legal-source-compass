import { describe, expect, it } from "vitest";
import {
  dayName,
  dayRange,
  ftcUrl,
  monthName,
  parseDncMonths,
  parseHsrFiscalYears,
  parseHsrSeries,
  parseOfficialMonths,
  parseSpotlight,
  parseStateCallsMonths,
  parseSubjects,
  subjectShares,
} from "./ftcData";

const nat = (month: string, over: Record<string, unknown> = {}) => ({
  id: `US-${month}`,
  month,
  complete: true,
  method: "records",
  first: `${month}-01`,
  last: `${month}-30`,
  days: 30,
  dim: 30,
  m: { calls: 100, robocalls: 70, not_robocalls: 20, no_flag: 10 },
  a: { robocall_share_pct: 77.78 },
  subj: {
    Other: 40,
    "Dropped call or no message": 30,
    "Reducing your debt (credit cards, mortgage, student loans)": 30,
  },
  source_url: "https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data",
  ...over,
});

describe("parseDncMonths", () => {
  it("reads a month row with its counts, coverage and subjects sorted by count", () => {
    const [m] = parseDncMonths([nat("2026-09")]);
    expect(m).toMatchObject({
      month: "2026-09",
      complete: true,
      method: "records",
      calls: 100,
      robocalls: 70,
      notRobocalls: 20,
      noFlag: 10,
      robocallSharePct: 77.78,
      daysCovered: 30,
    });
    // equal counts are ordered by name
    expect(m!.subjects.map((s) => s.subject)).toEqual([
      "Other",
      "Dropped call or no message",
      "Reducing your debt (credit cards, mortgage, student loans)",
    ]);
  });
  it("drops rows that cannot be identified instead of repairing them", () => {
    const rows = [
      nat("2026-09", { id: "US-2026-08" }), // id and month disagree
      nat("2026-13"),
      nat("2026-10", { m: { calls: "100" } }),
      nat("2026-11", { method: "guess" }),
      nat("2026-12", { complete: "yes" }),
      { id: "TX-2026-09", month: "2026-09" },
      null,
      "x",
    ];
    expect(parseDncMonths(rows)).toEqual([]);
  });
  it("keeps the first row of a duplicated month, orders months, and nulls an impossible share", () => {
    const out = parseDncMonths([
      nat("2026-10"),
      nat("2026-09"),
      nat("2026-10", { m: { calls: 5 } }),
      nat("2026-08", { a: { robocall_share_pct: 140 } }),
    ]);
    expect(out.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(out[2]!.calls).toBe(100);
    expect(out[0]!.robocallSharePct).toBeNull();
  });
  it("accepts only ftc.gov links", () => {
    expect(
      parseDncMonths([nat("2026-09", { source_url: "https://evil.example/x" })])[0]!.sourceUrl,
    ).toBeNull();
    expect(ftcUrl("https://www.ftc.gov/a")).toBe("https://www.ftc.gov/a");
    expect(ftcUrl("http://www.ftc.gov/a")).toBeNull();
    expect(ftcUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("parseSubjects and subjectShares", () => {
  it("keeps non-negative integer counts only", () => {
    expect(parseSubjects({ A: 3, B: -1, C: 1.5, D: "4", " ": 2, E: 0 })).toEqual([
      { subject: "A", calls: 3 },
      { subject: "E", calls: 0 },
    ]);
    expect(parseSubjects(null)).toEqual([]);
    expect(parseSubjects([1, 2])).toEqual([]);
  });
  it("shares are of every call counted; the catch-all buckets are listed apart, never ranked", () => {
    const months = [
      {
        subjects: [
          { subject: "Other", calls: 50 },
          { subject: "Charities", calls: 5 },
          { subject: "No Subject Provided", calls: 15 },
        ],
      },
      {
        subjects: [
          { subject: "Charities", calls: 5 },
          { subject: "Medical & prescriptions", calls: 25 },
        ],
      },
    ];
    const r = subjectShares(months);
    expect(r.total).toBe(100);
    expect(r.named).toEqual([
      { subject: "Medical & prescriptions", calls: 25, sharePct: 25 },
      { subject: "Charities", calls: 10, sharePct: 10 },
    ]);
    expect(r.catchAll.map((s) => [s.subject, s.sharePct])).toEqual([
      ["Other", 50],
      ["No Subject Provided", 15],
    ]);
    expect(subjectShares([])).toEqual({ total: 0, named: [], catchAll: [] });
  });
});

describe("parseOfficialMonths", () => {
  const row = (month: string, calls: number, robocalls: number, live: number) => ({
    id: `official-${month}`,
    month,
    m: { calls, robocalls, live_callers: live },
    source_url: "https://public.tableau.com/x",
  });
  it("keeps a dashboard month only when robocall + live caller equals the printed total", () => {
    const out = parseOfficialMonths([
      row("2026-05", 233346, 176472, 56874),
      row("2026-06", 219305, 160309, 58996),
      row("2026-04", 232848, 170295, 62552),
    ]);
    expect(out.map((o) => o.month)).toEqual(["2026-05", "2026-06"]);
    expect(out[0]).toMatchObject({ total: 233346, robocall: 176472, live: 56874, apiTotal: null });
  });
  it("carries the API cross-check count of a month when the build took one, and nothing else from it", () => {
    const [m] = parseOfficialMonths([
      { ...row("2026-04", 232848, 170295, 62553), api: { total: 255760, robocalls: 182267 } },
    ]);
    expect(m!.apiTotal).toBe(255760);
    const [bad] = parseOfficialMonths([
      { ...row("2026-04", 232848, 170295, 62553), api: { total: "255,760" } },
    ]);
    expect(bad!.apiTotal).toBeNull();
  });
});

describe("parseStateCallsMonths", () => {
  const st = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    complete: false,
    first: "2026-09-16",
    last: "2026-09-30",
    m: { calls: 11387, robocalls: 7686, population: 31709821, population_year: 2025 },
    a: { per100k: 35.9, rank_per100k: 31, ranked_of: 52, robocall_share_pct: 73.03 },
    subj: { Other: 4519 },
    source_url: "https://www.ftc.gov/x",
    ...over,
  });
  it("reads only the requested state and keeps rank and per-100K as stored", () => {
    const out = parseStateCallsMonths(
      [st("TX-2026-09"), st("OH-2026-09"), st("TX-2026-10", { complete: true })],
      "TX",
    );
    expect(out.map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
    expect(out[0]).toMatchObject({
      calls: 11387,
      per100k: 35.9,
      rankPer100k: 31,
      rankedOf: 52,
      population: 31709821,
      populationYear: 2025,
      complete: false,
    });
  });
  it("nulls a rank below 1 and a negative per-100K instead of showing it", () => {
    const [m] = parseStateCallsMonths(
      [st("TX-2026-09", { a: { per100k: -3, rank_per100k: 0 } })],
      "TX",
    );
    expect(m!.per100k).toBeNull();
    expect(m!.rankPer100k).toBeNull();
  });
});

describe("HSR rows", () => {
  it("reads the series row and its period", () => {
    const s = parseHsrSeries({
      id: "series-by-year",
      s: {
        calendar_year: { "2021": 62, "2013": 250, x: 3, "2014": -1 },
        fiscal_year: { "2021": 439 },
        undated: 2,
        notices: 312,
      },
      cells: { period: "1999-01-04 to 2026-10-21" },
    });
    expect(s).toMatchObject({
      undated: 2,
      notices: 312,
      firstDate: "1999-01-04",
      lastDate: "2026-10-21",
    });
    expect(s!.calendar).toEqual([
      { year: 2013, count: 250 },
      { year: 2021, count: 62 },
    ]);
    expect(s!.fiscal).toEqual([{ year: 2021, count: 439 }]);
    expect(parseHsrSeries({ s: {} })).toBeNull();
    expect(parseHsrSeries(null)).toBeNull();
  });
  it("reads fiscal-year rows and keeps a recorded zero as zero", () => {
    const rows = [
      {
        id: "fy-2023",
        partial: false,
        m: {
          transactions_reported: 1805,
          filings_received: 3515,
          second_requests_total: 37,
          et_requested: 780,
          et_granted: 0,
          et_not_granted: 780,
        },
      },
      { id: "fy-2022", m: { et_granted: 5 } },
      { id: "month-2025-06", m: {} },
    ];
    const out = parseHsrFiscalYears(rows);
    expect(out.map((r) => r.fy)).toEqual([2022, 2023]);
    expect(out[1]!.etGranted).toBe(0);
    expect(out[0]!.transactions).toBeNull();
  });
});

describe("parseSpotlight", () => {
  it("orders posts newest first and keeps only ftc.gov links", () => {
    const rows = [
      {
        id: "a",
        title: "Old",
        published: "May 1, 2023",
        iso: "2023-05-01",
        summary: "s",
        url: "https://www.ftc.gov/a",
        files: [{ url: "https://www.ftc.gov/a.pdf" }],
      },
      {
        id: "b",
        title: "New",
        published: "April 27, 2026",
        iso: "2026-04-27",
        summary: null,
        url: "https://elsewhere.example/b",
        files: [],
      },
      { id: "a", title: "Duplicate", iso: "2024-01-01" },
      { id: "c" },
    ];
    const out = parseSpotlight(rows);
    expect(out.map((p) => p.title)).toEqual(["New", "Old"]);
    expect(out[0]!.url).toBeNull();
    expect(out[1]!.fileUrl).toBe("https://www.ftc.gov/a.pdf");
  });
});

describe("labels", () => {
  it("names months and days and builds a range without repeating the year", () => {
    expect(monthName("2026-09")).toBe("September 2026");
    expect(monthName("garbage")).toBe("garbage");
    expect(dayName("2026-09-16")).toBe("September 16, 2026");
    expect(dayRange("2026-09-16", "2026-10-20")).toBe("September 16 to October 20, 2026");
    expect(dayRange("2025-12-30", "2026-01-03")).toBe("December 30, 2025 to January 3, 2026");
    expect(dayRange("2026-09-16", "2026-09-16")).toBe("September 16, 2026");
  });
});
