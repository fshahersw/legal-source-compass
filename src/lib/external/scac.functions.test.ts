import { describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  getScacStatistics,
  parseAlignment,
  parseCurrentTrend,
  parseStatistics,
} from "./scac.functions";

// Shapes copied from published scac_statistics and scac_trend_alignment records.
const ROWS = [
  {
    id: "overview:all",
    p: {
      kind: "overview",
      total: 6879,
      through: "2025-07-28",
      settlements_total_usd: 119351176861,
      key_stats: [{ label: "Most Active District Court", value: "S.D. New York" }],
    },
  },
  {
    id: "year:2001",
    p: {
      kind: "year",
      year: 2001,
      filings: 498,
      partial: false,
      fjc_nos850: { fy: 2001, filings: 3166, class_action: 1110 },
    },
  },
  {
    id: "year:2025",
    p: {
      kind: "year",
      year: 2025,
      filings: 129,
      partial: true,
      fjc_nos850: { fy: 2024, filings: 1, class_action: 1 },
    },
  },
  { id: "year:1999", p: { kind: "year", year: 2000, filings: 1 } },
  { id: "circuit:2nd", p: { kind: "circuit", label: "2nd", filings: 2006, court_id: "ca2" } },
  {
    id: "status:case-dismissed",
    p: { kind: "status", label: "Case Dismissed", filings: 3306, rank: 1 },
  },
  {
    id: "top_settlement:1",
    p: {
      kind: "top_settlement",
      rank: 1,
      entity: "Enron Corporation",
      amount_usd: 7227390000,
      fees_usd: 688047528,
      case_id: 102098,
      settled_on: "2008-09-08",
    },
  },
  {
    id: "top_settlement:2",
    p: { kind: "top_settlement", rank: 2, entity: "X", amount_usd: 10, fees_usd: 50 },
  },
  {
    id: "top_duration:1",
    p: {
      kind: "top_duration",
      rank: 1,
      entity: "Halliburton Company",
      days: 5845,
      details: {
        "Filing Date": "06/03/2002",
        "Last Stage of Litigation Recorded Date": "06/04/2018",
      },
    },
  },
  {
    id: "top_plaintiff_firm:2",
    p: {
      kind: "top_plaintiff_firm",
      rank: 2,
      entity: "Robbins Geller Rudman & Dowd LLP",
      filings: 956,
      mdl_profile: "firm:robbins-geller-rudman-and-dowd",
      mdl: { appearances: 32, mdls: 3 },
    },
  },
  { id: "junk", p: null },
];

describe("parseStatistics", () => {
  it("reads every kind and drops what does not fit", () => {
    const s = parseStatistics(ROWS);
    expect(s.total).toBe(6879);
    expect(s.years.map((y) => [y.year, y.nos850ClassActions])).toEqual([
      [2001, 1110],
      [2025, null], // FJC fiscal year 2024 is not 2025
    ]);
    expect(s.circuits[0]).toMatchObject({ label: "2nd", courtId: "ca2" });
    expect(s.settlements[0]).toMatchObject({
      amountUsd: 7227390000,
      feesUsd: 688047528,
      casePage: "https://securities.stanford.edu/filings-case.html?id=102098",
    });
    expect(s.settlements[1]!.feesUsd).toBeNull(); // fees above the settlement
    expect(s.durations[0]).toMatchObject({
      days: 5845,
      filed: "2002-06-03",
      lastStage: "2018-06-04",
    });
    expect(s.firms[0]!.mdlProfile).toBe("firm:robbins-geller-rudman-and-dowd");
    expect(s.dropped).toBe(2); // the mislabelled year and the junk row
  });
});

describe("parseCurrentTrend", () => {
  it("links courts only on the exact stored link and hides N/A values", () => {
    const t = parseCurrentTrend({
      name: "SPACs",
      filings: 2,
      first: "2019-01-30",
      last: "2025-04-18",
      by_year: [
        { year: 2025, filings: 1 },
        { year: 2019, filings: 1 },
        { year: 2020, filings: 9 },
      ],
      by_court: [{ court: "S.D. New York", filings: 1, court_id: "nysd", link: "/courts/nysd" }],
      by_sector: [],
      rows: [
        {
          name: "Acme",
          filed: "2025-04-18",
          court: "S.D. New York",
          court_id: "nysd",
          court_link: "/courts/nysd",
          exchange: "N/A",
          ticker: "ACME",
          case_page: "https://securities.stanford.edu/filings-case.html?id=5",
        },
        {
          name: "Beta",
          filed: "bad",
          court: "D. District Columbia",
          court_id: "dcd",
          court_link: "/courts/nysd",
          case_page: "https://evil.example/",
        },
      ],
    })!;
    expect(t.byYear.map((y) => y.year)).toEqual([2019, 2025]);
    expect(t.rows[0]).toMatchObject({ courtId: "nysd", exchange: null, ticker: "ACME" });
    expect(t.rows[1]).toMatchObject({ courtId: null, filed: null, casePage: null });
  });
});

describe("parseAlignment", () => {
  it("parses years and correlations whose interval holds rho", () => {
    const a = parseAlignment([
      {
        id: "year:2008",
        p: {
          year: 2008,
          filings: 223,
          vix_mean: 32.69,
          nasdaq_return_pct: -40.54,
          nasdaq_max_drawdown_pct: -54,
          fjc_nos850_class_actions: 321,
        },
      },
      {
        id: "corr:vix_mean:lag0",
        p: {
          label: "VIX",
          lag: 0,
          rho: 0.136,
          n: 29,
          ci: [-0.24, 0.48],
          points: [{ year: 1996, x: 110, y: 17.9 }],
        },
      },
      { id: "corr:bad:lag0", p: { label: "Bad", rho: 0.9, n: 29, ci: [-0.2, 0.5] } },
    ]);
    expect(a.years[0]).toMatchObject({
      vixMean: 32.69,
      nasdaqReturn: -40.54,
      nasdaqDrawdown: -54,
      nos850ClassActions: 321,
    });
    expect(a.correlations.map((c) => c.id)).toEqual(["corr:vix_mean:lag0"]);
    expect(a.dropped).toBe(1);
  });
});

describe("getScacStatistics", () => {
  it("reads the dataset once", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: ROWS, total: null });
    const handler = getScacStatistics as unknown as () => Promise<{ total: number }>;
    expect((await handler()).total).toBe(6879);
    expect(mocked.mock.calls[0]![0]).toContain("dataset=eq.scac_statistics");
  });
});
