import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { parseConsumerComplaints, parseYears } from "./consumerComplaints.functions";

// Shapes of the published rows (cfpb_complaints_national "cfpb-national:all", cfpb_complaints_states, ...).
const NATIONAL = {
  period: { from: "2011-12-01", to: "2026-10-18" },
  complaints: 18504768,
  companies: 8179,
  timely: { yes: 18393042, no: 111726, not_recorded: 0, rate: 99.4 },
  years: [
    {
      year: "2025",
      complaints: 5442944,
      complete: true,
      yoy_pct: 99.06,
      timely_rate: 99.55,
      relief_rate: 41.13,
      credit_reporting_complaints: 4810295,
      credit_reporting_share_pct: 88.38,
    },
    { year: "2011", complaints: 2536, complete: false, yoy_pct: null },
    { year: "bad", complaints: 5, complete: true },
    { year: "2012", complaints: "n/a", complete: true },
  ],
  analytics: {
    ytd: {
      current: { from: "2026-01-01", to: "2026-10-18", complaints: 5822407 },
      previous: { from: "2025-01-01", to: "2025-10-18", complaints: 4218975 },
      change_pct: 38.01,
      note: "The current-year span is not yet matured",
    },
    product_share_shift: {
      from: "2024",
      to: "2025",
      rows: [
        {
          product: "Credit card",
          complaints_2024: 75989,
          complaints_2025: 89978,
          share_2024_pct: 2.7791,
          share_2025_pct: 1.6531,
          shift_pp: -1.126,
        },
        { product: "Broken", complaints_2024: 1 },
      ],
    },
  },
};

const input = (over: Partial<Parameters<typeof parseConsumerComplaints>[0]> = {}) => ({
  national: NATIONAL,
  states: [
    {
      code: "TX",
      cells: {
        state: "Texas",
        kind: "state",
        complaints: 2567952,
        window: 2134311,
        per_100k_2025: 2491.02,
        rate_change_pct: 764.64,
        timely_rate: 99.5,
      },
    },
    {
      code: "DC",
      cells: {
        state: "District of Columbia",
        kind: "district",
        complaints: 62267,
        per_100k_2025: 2473.6,
      },
    },
    { code: "PR", cells: { state: "Puerto Rico", kind: "territory", complaints: 68441 } },
    { code: "NR", cells: { state: "Not recorded", kind: "unrecorded", complaints: 63343 } },
    { code: "ZZ", cells: { state: "No total", kind: "state" } },
  ],
  stateRankings: {
    per_100k_2025: [
      { code: "GA", name: "Georgia", value: 3777.28, rank: 1 },
      { code: "XYZ", name: "bad", value: 1, rank: 2 },
    ],
    rate_change_pct: [{ code: "MS", name: "Mississippi", value: 1049.23, rank: 1 }],
  },
  companies: [
    {
      cells: {
        rank: 3,
        company: "Experian Information Solutions Inc.",
        complaints: 4507587,
        window_change: 696.39,
        top_product: "Credit reporting",
        timely_rate: 99.998,
        relief_rate: 13.17,
      },
    },
    { cells: { company: "", complaints: 5 } },
    { cells: { company: "No total" } },
  ],
  reports: [
    {
      d: "2024-07-18",
      t: "Data Spotlight: Developments in the Paycheck Advance Market",
      cat: "Data spotlight",
      u: "https://www.consumerfinance.gov/data-research/research-reports/x/",
    },
    {
      d: "2026-01-02",
      t: "Newest report",
      cat: null,
      u: "https://www.consumerfinance.gov/data-research/research-reports/y/",
    },
    { d: "not a date", t: "Bad date", cat: "x", u: "https://www.consumerfinance.gov/z/" },
    { d: "2025-05-05", t: "Off-site link", cat: "x", u: "https://example.org/z/" },
  ],
  reportCount: 620,
  ...over,
});

describe("parseConsumerComplaints", () => {
  it("reads the stored national, state, company and report shapes", () => {
    const v = parseConsumerComplaints(input())!;
    expect(v.complaints).toBe(18504768);
    expect(v.from).toBe("2011-12-01");
    expect(v.timelyRate).toBe(99.4);
    expect(v.ytd).toMatchObject({
      complaints: 5822407,
      previousComplaints: 4218975,
      changePct: 38.01,
    });
    expect(v.productShift.rows).toHaveLength(1); // the row missing fields is dropped, never repaired
    expect(v.topCompanies).toEqual([
      {
        rank: 3,
        company: "Experian Information Solutions Inc.",
        complaints: 4507587,
        windowChangePct: 696.39,
        topProduct: "Credit reporting",
        timelyRate: 99.998,
        reliefRate: 13.17,
      },
    ]);
    expect(v.perCapitaRanking).toEqual([{ code: "GA", name: "Georgia", value: 3777.28, rank: 1 }]);
    expect(v.riseRanking[0]?.code).toBe("MS");
  });

  it("keeps only the 50 states and DC, in the view's state list", () => {
    const v = parseConsumerComplaints(input())!;
    expect(v.states.map((s) => s.code)).toEqual(["TX", "DC"]);
    expect(v.states[0]).toMatchObject({ per100k2025: 2491.02, rateChangePct: 764.64 });
  });

  it("sorts years ascending, drops malformed years and flags the partial year", () => {
    const years = parseYears(NATIONAL.years).sort((a, b) => a.year - b.year);
    expect(years.map((y) => [y.year, y.complete])).toEqual([
      [2011, false],
      [2025, true],
    ]);
    expect(years[1]).toMatchObject({
      creditReporting: 4810295,
      creditReportingSharePct: 88.38,
      yoyPct: 99.06,
    });
    expect(years[0]?.creditReporting).toBeNull(); // not recorded stays null, never 0
  });

  it("lists only dated reports on consumerfinance.gov, newest first", () => {
    const v = parseConsumerComplaints(input())!;
    expect(v.reports.map((r) => r.title)).toEqual([
      "Newest report",
      "Data Spotlight: Developments in the Paycheck Advance Market",
    ]);
    expect(v.reports[0]?.category).toBeNull();
    expect(v.reportCount).toBe(620);
  });

  it("returns null when the national row or its years are missing", () => {
    expect(parseConsumerComplaints(input({ national: null }))).toBeNull();
    expect(parseConsumerComplaints(input({ national: { ...NATIONAL, years: [] } }))).toBeNull();
    expect(
      parseConsumerComplaints(input({ national: { ...NATIONAL, complaints: "many" } })),
    ).toBeNull();
  });

  it("leaves the year-to-date block out when either span is missing", () => {
    const national = {
      ...NATIONAL,
      analytics: { ytd: { current: NATIONAL.analytics.ytd.current } },
    };
    expect(parseConsumerComplaints(input({ national }))!.ytd).toBeNull();
  });
});
