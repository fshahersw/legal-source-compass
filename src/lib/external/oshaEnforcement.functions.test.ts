import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { parseOshaEnforcement } from "./oshaEnforcement.functions";

// Values copied from the published rows (osha-national:summary, osha-national:FY2025, osha-sir:summary).
const SUMMARY = {
  rate_fy: 2025,
  series: [
    { fy: 2026, inspections: 63022, current_penalty: 100, yoy_inspections_pct: -15.0 },
    {
      fy: 2025,
      inspections: 74123,
      programmed: 33355,
      unprogrammed: 40753,
      fat_cat: 2062,
      accident: 2750,
      state_plan: 40561,
      current_penalty: 330835643.3,
      yoy_inspections_pct: -4.08,
      yoy_current_penalty_pct: -3.72,
      median_days_to_close: 101,
    },
    { fy: "bad", inspections: 5 },
    { fy: 2024, inspections: null },
  ],
  ten_fy: {
    fy_range: [2016, 2025],
    inspections: 737164,
    state_plan: 399580,
    current_penalty: 2786492878.2,
  },
  state_rates_latest_fy: [
    { code: "TX", inspections: 3894, covered_jobs: 13000000, per_100k_covered_jobs: 29.95 },
    { code: "VI", inspections: 124, covered_jobs: 34266, per_100k_covered_jobs: 361.87 },
    { code: "ZZ", inspections: 1 },
  ],
  rate_denominator: {
    source: "https://data.bls.gov/cew/data/api/2025/a/industry/10.csv",
    year: 2025,
  },
};
const YEAR = {
  fy: 2025,
  inspections: 74123,
  federal: 33562,
  state_plan: 40561,
  violation_records: 133951,
  violation_items: 113336,
  violations: { serious: 78452, willful: 577, repeat: 5212 },
  current_penalty: 330835643.3,
  penalized_inspections: 36005,
  median_current_penalty: 4708,
  p90_current_penalty: 18900,
  top1pct_share_current_penalty: 16.62,
  median_days_to_close: 101,
  penalty_distribution: { "0": 38118, "1-999": 4723, "500000+": 6, junk: 9 },
  top_sections: [
    { section: "1926.501", records: 8820 },
    { section: null, records: 3 },
  ],
  top_naics: [{ sector: "23", title: "Construction", inspections: 31231 }],
};
const SIR = {
  series: [
    { year: 2025, reports: 6000, hospitalized: 4700, amputations: 1500 },
    { year: 2024, reports: 9034, hospitalized: 7327, amputations: 2426 },
  ],
  series_note: "2025 is partial (OSHA footnote: as of November 2025)",
};
const EMPLOYERS = [
  {
    id: "osha-employer:b",
    cells: { rank: 2, name: "THOMAS BUILDERS OF VIRGINIA, INC.", current_penalty: 6916968 },
  },
  {
    id: "osha-employer:a",
    cells: {
      rank: 1,
      name: "DOLLAR TREE STORES, INC.",
      inspections: 213,
      current_penalty: 8873959.01,
    },
  },
  { id: "osha-employer:x", cells: { name: "no rank" } },
];

describe("parseOshaEnforcement", () => {
  const v = parseOshaEnforcement({ summary: SUMMARY, year: YEAR, sir: SIR, employers: EMPLOYERS })!;

  it("orders the series by fiscal year, drops malformed rows and flags the year in progress", () => {
    expect(v.series.map((y) => y.fy)).toEqual([2025, 2026]);
    expect(v.series[1]).toMatchObject({ fy: 2026, partial: true, programmed: null });
    expect(v.series[0]).toMatchObject({ fy: 2025, partial: false, yoyPenaltyPct: -3.72 });
  });

  it("reads the latest complete year and keeps unstated figures null", () => {
    expect(v.latestFy).toBe(2025);
    expect(v.latest).toMatchObject({
      inspections: 74123,
      serious: 78452,
      willful: 577,
      repeat: 5212,
      violationRecords: 133951,
      violationItems: 113336,
      top1pctSharePct: 16.62,
      p99CurrentPenalty: null,
    });
    expect(v.latest?.distribution).toEqual([
      { bucket: "0", inspections: 38118 },
      { bucket: "1-999", inspections: 4723 },
      { bucket: "500000+", inspections: 6 },
    ]);
    expect(v.latest?.topSections).toEqual([{ section: "1926.501", records: 8820 }]);
  });

  it("ranks state rates highest first and drops rows without a rate", () => {
    expect(v.stateRates.map((s) => s.code)).toEqual(["VI", "TX"]);
    expect(v.rateDenominator).toEqual({
      source: "https://data.bls.gov/cew/data/api/2025/a/industry/10.csv",
      year: 2025,
      measure: null,
    });
  });

  it("computes the State Plan share of ten-year inspections from the stored counts", () => {
    expect(v.tenFy).toMatchObject({ from: 2016, to: 2025, inspections: 737164 });
    expect(v.tenFy?.statePlanSharePct).toBeCloseTo(54.2, 1);
  });

  it("orders employers by their stored rank and skips rows without one", () => {
    expect(v.employers.map((e) => e.name)).toEqual([
      "DOLLAR TREE STORES, INC.",
      "THOMAS BUILDERS OF VIRGINIA, INC.",
    ]);
    expect(v.employers[1]).toMatchObject({ inspections: null, serious: null });
  });

  it("marks the newest Severe Injury year partial only when OSHA's note says so", () => {
    expect(v.sir?.series.map((s) => [s.year, s.partial])).toEqual([
      [2024, false],
      [2025, true],
    ]);
    const quiet = parseOshaEnforcement({
      summary: SUMMARY,
      year: null,
      sir: { ...SIR, series_note: "figures as published" },
      employers: [],
    })!;
    expect(quiet.sir?.series.every((s) => !s.partial)).toBe(true);
    expect(quiet.latest).toBeNull();
  });

  it("returns null when the summary has no latest-year marker or no usable series", () => {
    expect(parseOshaEnforcement({ summary: null, year: YEAR, sir: SIR, employers: [] })).toBeNull();
    expect(
      parseOshaEnforcement({
        summary: { rate_fy: 2025, series: [] },
        year: YEAR,
        sir: SIR,
        employers: [],
      }),
    ).toBeNull();
  });
});
