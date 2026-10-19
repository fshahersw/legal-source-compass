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
  BK_COURT_ID,
  getClbBankruptcyCourt,
  parseBankruptcyProfile,
} from "./clbBankruptcy.functions";

// Shape of a clb_bankruptcy_courts profile (values cut down from the vtb record).
const PROFILE = {
  court_id: "vtb",
  name: "United States Bankruptcy Court, D. Vermont",
  file_date: "2022-09-19",
  dockets: 1000,
  no_filed_date: 2,
  implausible_filed: 1,
  first_filed: "1985-01-02",
  last_filed: "2022-09-16",
  terminated: 950,
  terminated_pct: 95,
  duration_days: { n: 940, p10: 60, p25: 100, p50: 130, p75: 400, p90: 1500 },
  by_year: [
    { yr: 2001, dockets: 300, terminated: 300, ap: 10, median_days: 120.5, n_dur: 300 },
    { yr: 2000, dockets: 200, terminated: 199, ap: 5, median_days: null, n_dur: 20 },
    { yr: 2000, dockets: 1, terminated: 1, ap: 0 },
    { yr: 2002, dockets: 5, terminated: 9, ap: 0 },
  ],
  before_series: 3,
  case_types: [
    { code: "bk", label: "bk (bankruptcy case)", dockets: 900, share_pct: 90, median_days: 125 },
    { code: "ap", label: "ap (adversary proceeding)", dockets: 2000, share_pct: 200 },
  ],
  judges: [
    {
      person_id: 8925,
      name: "Colleen A. Brown",
      dockets: 500,
      share_pct: 50,
      first_filed: "1990-01-01",
      last_filed: "2022-01-01",
      median_days: 140,
      record: "/records/cl_people/cl:people:8925",
      stats_record: "/records/clb_judge_dockets/8925",
    },
    {
      person_id: 77,
      name: "Other Judge",
      dockets: 10,
      share_pct: 1,
      record: "/records/cl_people/cl:people:78",
      stats_record: "/records/clb_judge_dockets/7",
    },
    { person_id: 5, name: "Too many", dockets: 5000 },
  ],
  judges_with_id: 4,
  with_judge_id_pct: 51,
  judge_name_only: 12,
  judge_names_without_id: [{ name: "COLLEEN BROWN", dockets: 12 }],
  blocked_pct: 99.9,
  in_2026_docket_file: { in_docket_file: 1000, in_docket_file_pct: 100 },
};

describe("parseBankruptcyProfile", () => {
  it("keeps valid rows, drops malformed ones and keeps only exact links", () => {
    const p = parseBankruptcyProfile(PROFILE, "vtb")!;
    expect(p.dockets).toBe(1000);
    expect(p.undated).toBe(3);
    expect(p.duration?.p50).toBe(130);
    expect(p.byYear.map((y) => y.yr)).toEqual([2000, 2001]);
    expect(p.byYear[0]!.medianDays).toBeNull();
    expect(p.caseTypes.map((t) => t.code)).toEqual(["bk"]);
    expect(p.judges).toHaveLength(2);
    expect(p.judges[0]!.statsRecord).toBe("/records/clb_judge_dockets/8925");
    expect(p.judges[1]!.record).toBeNull();
    expect(p.judges[1]!.statsRecord).toBeNull();
    expect(p.inDocketFilePct).toBe(100);
  });

  it("rejects a record for another court and unordered quantiles", () => {
    expect(parseBankruptcyProfile(PROFILE, "nysb")).toBeNull();
    const bad = parseBankruptcyProfile(
      { ...PROFILE, duration_days: { n: 5, p10: 9, p25: 1, p50: 2, p75: 3, p90: 4 } },
      "vtb",
    )!;
    expect(bad.duration).toBeNull();
    expect(parseBankruptcyProfile({ ...PROFILE, dockets: -1 }, "vtb")).toBeNull();
  });
});

describe("getClbBankruptcyCourt", () => {
  it("reads one record by exact id", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: [{ p: PROFILE }], total: null });
    const handler = getClbBankruptcyCourt as unknown as (a: {
      data: { id: string };
    }) => Promise<unknown>;
    const r = (await handler({ data: { id: "vtb" } })) as { courtId: string };
    expect(r.courtId).toBe("vtb");
    expect(mocked.mock.calls[0]![0]).toContain("dataset=eq.clb_bankruptcy_courts&id=eq.vtb");
    mocked.mockResolvedValueOnce({ rows: [], total: null });
    expect(await handler({ data: { id: "ca9" } })).toBeNull();
  });

  it("accepts only court-id shapes", () => {
    expect(BK_COURT_ID.test("vtb")).toBe(true);
    expect(BK_COURT_ID.test("../x")).toBe(false);
  });
});
