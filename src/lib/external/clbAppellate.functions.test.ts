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
  getClbAppellateCourt,
  getClbJudgePanels,
  parseAppellatePanels,
  parseAppellateTiming,
  parseJudgePanels,
} from "./clbAppellate.functions";

const TIMING = {
  court_id: "ca9",
  name: "Court of Appeals for the Ninth Circuit",
  appeals: 100,
  court_dockets: 1000,
  appeals_pct_of_dockets: 10,
  first_filed: "1990-01-01",
  last_filed: "2026-09-01",
  fields: { lower_judge_id: 46 },
  intervals: [
    {
      key: "judgment_to_noa",
      label: "Lower-court judgment to notice of appeal",
      n: 50,
      negative_set_aside: 2,
      p25: 9,
      p50: 23,
      p75: 29,
      p90: 31,
    },
    { key: "noa_to_received", label: "Notice of appeal to receipt", n: 10, negative_set_aside: 0 },
    { key: "bad", label: "Out of order", n: 40, negative_set_aside: 0, p25: 30, p50: 20, p75: 10 },
    { key: "too_many", label: "More than the appeals", n: 500, negative_set_aside: 0 },
  ],
  by_year: [{ yr: 2020, appeals: 10, median_days: 512, median_days_to_notice: null }],
  from_courts: [
    {
      court_id: "cacd",
      name: "District Court, C.D. California",
      appeals: 40,
      share_pct: 40,
      median_days: 500,
      link: "/courts/cacd",
    },
    {
      court_id: "cand",
      name: "District Court, N.D. California",
      appeals: 30,
      share_pct: 30,
      link: "/courts/cacd",
    },
  ],
  lower_judges: [
    {
      person_id: 3046,
      name: "Josephine Staton",
      stats_record: "/records/clb_judge_dockets/3046",
      appeals: 12,
      main_from_name: "District Court, C.D. California",
    },
  ],
  lower_judges_with_id: 30,
};
const PANELS = {
  court_id: "ca9",
  name: "Court of Appeals for the Ninth Circuit",
  clusters_with_panel: 4316,
  court_clusters: 212446,
  panel_pct_of_clusters: 2,
  median_size: 3,
  sizes: [
    { size: 3, clusters: 2329, share_pct: 54 },
    { size: 0, clusters: 1 },
  ],
  by_year: [{ yr: 1925, clusters: 81, median_size: 3 }],
  judges: [
    {
      person_id: 1,
      name: "Curtis Dwight Wilbur",
      panels: 646,
      share_pct: 15,
      stats_record: "/records/clb_judge_dockets/1",
    },
  ],
  judges_count: 63,
  pairs: [
    { a: { person_id: 1, name: "A" }, b: { person_id: 2, name: "B" }, panels: 217 },
    { a: { person_id: 3, name: "C" }, b: { person_id: 3, name: "C" }, panels: 2 },
  ],
  pairs_count: 14,
};
const JUDGE = {
  person_id: 1,
  name: "Curtis Dwight Wilbur",
  panels: 646,
  courts: [{ court_id: "ca9", name: "Ninth Circuit", panels: 646, link: "/courts/ca9" }],
  by_year: [{ yr: 1930, panels: 50 }],
  co_panelists: [
    { person_id: 2, name: "B", panels: 217, stats_record: null },
    { person_id: 1, name: "Self", panels: 646 },
  ],
  co_panelists_count: 20,
  joined_by_opinions: 0,
};
const CROSSWALK = {
  judges_id: "00124e25efc84bd50ee40f2b0083469f",
  tier: "exact_id",
  cl_person_id: 1,
  cl_name: "Curtis Dwight Wilbur",
  matched_positions: [],
  candidates: [],
  unresolved_courts: [],
  cl_record: "/records/cl_people/cl:people:1",
  cl_dockets_record: "/records/clb_judge_dockets/1",
};

describe("parsers", () => {
  it("timing keeps ordered quartiles and exact court links", () => {
    const t = parseAppellateTiming(TIMING, "ca9")!;
    expect(t.intervals.map((i) => i.key)).toEqual(["judgment_to_noa", "noa_to_received", "bad"]);
    expect(t.intervals[0]!.p50).toBe(23);
    expect(t.intervals[1]!.p50).toBeNull();
    expect(t.intervals[2]!.p50).toBeNull();
    expect(t.fromCourts[0]!.link).toBe("/courts/cacd");
    expect(t.fromCourts[1]!.link).toBeNull();
    expect(t.lowerJudgeIdPct).toBe(46);
    expect(parseAppellateTiming(TIMING, "ca2")).toBeNull();
  });

  it("panels drop a pair of one person and impossible sizes", () => {
    const p = parseAppellatePanels(PANELS, "ca9")!;
    expect(p.pairs).toHaveLength(1);
    expect(p.sizes.map((s) => s.size)).toEqual([3]);
    expect(p.judges[0]!.statsRecord).toBe("/records/clb_judge_dockets/1");
  });

  it("judge panels never list the person as their own co-panelist", () => {
    const j = parseJudgePanels(JUDGE, 1)!;
    expect(j.coPanelists.map((c) => c.personId)).toEqual([2]);
    expect(parseJudgePanels(JUDGE, 2)).toBeNull();
  });
});

describe("server functions", () => {
  it("reads both court records by exact id", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce({ rows: [{ p: TIMING }], total: null })
      .mockResolvedValueOnce({ rows: [], total: null });
    const handler = getClbAppellateCourt as unknown as (a: {
      data: { id: string };
    }) => Promise<{ timing: unknown; panels: unknown }>;
    const r = await handler({ data: { id: "ca9" } });
    expect(r.timing).not.toBeNull();
    expect(r.panels).toBeNull();
    expect(mocked.mock.calls[1]![0]).toContain("dataset=eq.clb_appellate_panels&id=eq.court:ca9");
  });

  it("reaches a judge's panel record only through a linked crosswalk", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce({ rows: [{ p: CROSSWALK }], total: null })
      .mockResolvedValueOnce({ rows: [{ p: JUDGE }], total: null });
    const handler = getClbJudgePanels as unknown as (a: {
      data: { id: string };
    }) => Promise<{ panels: number } | null>;
    expect((await handler({ data: { id: CROSSWALK.judges_id } }))!.panels).toBe(646);
    expect(mocked.mock.calls[1]![0]).toContain("id=eq.judge:1");
    mocked.mockReset();
    mocked.mockResolvedValueOnce({
      rows: [{ p: { ...CROSSWALK, tier: "ambiguous" } }],
      total: null,
    });
    expect(await handler({ data: { id: CROSSWALK.judges_id } })).toBeNull();
    expect(mocked).toHaveBeenCalledTimes(1);
  });
});
