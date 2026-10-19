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
  getJudgeCourtListener,
  JUDGE_ID,
  parseCrosswalk,
  parseJudgeActivity,
} from "./judgeCourtListener.functions";

// Shapes copied from published judge_cl_crosswalk and clb_judge_dockets rows.
const LINKED = {
  judges_id: "00124e25efc84bd50ee40f2b0083469f",
  tier: "exact_id",
  linked: true,
  cl_person_id: 134,
  cl_name: "Marvin E. Aspen",
  matched_positions: [
    {
      court: "District Court, N.D. Illinois",
      court_id: "ilnd",
      end: null,
      position: "jud",
      start: "1979-07-24",
    },
  ],
  candidates: [],
  unresolved_courts: [],
  cl_record: "/records/cl_people/cl:people:134",
  cl_dockets_record: "/records/clb_judge_dockets/134",
};
const REVIEW = {
  judges_id: "00d02a365849e343faedcc92c8aec2e6",
  tier: "compatible_name_same_court",
  linked: false,
  cl_person_id: 15731,
  cl_name: "Sydney Beasley Hewlett",
  matched_positions: [
    {
      court: "Texas 18th Judicial District Court",
      court_id: "texdistct19",
      end: "2020-12-31",
      start: "2019-05-20",
    },
  ],
  candidates: [],
  unresolved_courts: [],
  cl_record: null,
  cl_dockets_record: null,
};
const ACTIVITY = {
  person_id: 134,
  dockets: {
    assigned: 120,
    terminated_pct: 81.7,
    first_year: 1990,
    last_year: 2026,
    civil_numbered: 100,
    criminal_numbered: 20,
    duration_civil: { median_days: 249.0, n: 55 },
    courts: [
      {
        court_id: "ilnd",
        name: "District Court, N.D. Illinois",
        dockets: 120,
        link: "/courts/ilnd",
      },
    ],
    by_year: [
      { yr: 2001, dockets: 70 },
      { yr: 1990, dockets: 50 },
    ],
  },
  referred: null,
  opinions: {
    authored: 30,
    per_curiam: 0,
    lead_or_combined: 25,
    first_filed: "1981-02-03",
    last_filed: "2019-06-07",
    courts: [
      {
        court_id: "ilnd",
        name: "District Court, N.D. Illinois",
        opinions: 30,
        link: "/courts/ilnd",
      },
    ],
    by_year: [{ yr: 1981, opinions: 30 }],
    times_cited_total: 412,
    times_cited_median: 3.0,
    clusters_with_lead_opinion: 25,
    excluded_outside_lifespan: 0,
    before_first_recorded_position: null,
  },
};

describe("parseCrosswalk", () => {
  it("parses a linked record and keeps record links only when they name exactly that person", () => {
    const c = parseCrosswalk(LINKED, LINKED.judges_id)!;
    expect(c.linked).toBe(true);
    expect(c.clPersonId).toBe(134);
    expect(c.clRecord).toBe("/records/cl_people/cl:people:134");
    expect(c.clDocketsRecord).toBe("/records/clb_judge_dockets/134");
    expect(c.positions).toEqual([
      { courtId: "ilnd", court: "District Court, N.D. Illinois", start: "1979-07-24", end: null },
    ]);
    const wrong = parseCrosswalk(
      { ...LINKED, cl_dockets_record: "/records/clb_judge_dockets/999" },
      LINKED.judges_id,
    )!;
    expect(wrong.clDocketsRecord).toBeNull();
  });

  it("marks a possible match for review and never exposes record links for it", () => {
    const c = parseCrosswalk(
      { ...REVIEW, cl_record: "/records/cl_people/cl:people:15731" },
      REVIEW.judges_id,
    )!;
    expect(c.linked).toBe(false);
    expect(c.needsReview).toBe(true);
    expect(c.clRecord).toBeNull();
    expect(c.clDocketsRecord).toBeNull();
  });

  it("rejects a record for another judge, an unknown tier, or a linked tier without a person id", () => {
    expect(parseCrosswalk(LINKED, "ffffffffffffffffffffffffffffffff")).toBeNull();
    expect(parseCrosswalk({ ...LINKED, tier: "fuzzy" }, LINKED.judges_id)).toBeNull();
    expect(parseCrosswalk({ ...LINKED, cl_person_id: null }, LINKED.judges_id)).toBeNull();
  });

  it("drops malformed positions and candidates", () => {
    const c = parseCrosswalk(
      {
        ...LINKED,
        matched_positions: [
          { court_id: "ilnd" },
          { court: "X", court_id: "x", start: "not a date" },
        ],
        candidates: [3, "x", -1],
      },
      LINKED.judges_id,
    )!;
    expect(c.positions).toEqual([{ courtId: "x", court: "X", start: null, end: null }]);
    expect(c.candidates).toEqual([3]);
  });
});

describe("parseJudgeActivity", () => {
  it("parses dockets and opinions and sorts year series", () => {
    const a = parseJudgeActivity(ACTIVITY, 134)!;
    expect(a.dockets?.assigned).toBe(120);
    expect(a.dockets?.byYear.map((y) => y.yr)).toEqual([1990, 2001]);
    expect(a.dockets?.courts[0]?.link).toBe("/courts/ilnd");
    expect(a.opinions?.timesCitedTotal).toBe(412);
    expect(a.referred).toBeNull();
  });

  it("rejects another person's profile and drops court rows that exceed the total", () => {
    expect(parseJudgeActivity(ACTIVITY, 135)).toBeNull();
    const a = parseJudgeActivity(
      {
        ...ACTIVITY,
        dockets: {
          ...ACTIVITY.dockets,
          courts: [{ court_id: "ilnd", name: "N.D. Ill.", dockets: 500 }],
        },
      },
      134,
    )!;
    expect(a.dockets?.courts).toEqual([]);
  });

  it("does not link a court whose stored link names another court", () => {
    const a = parseJudgeActivity(
      {
        ...ACTIVITY,
        dockets: {
          ...ACTIVITY.dockets,
          courts: [{ court_id: "ilnd", name: "N.D. Ill.", dockets: 10, link: "/courts/cand" }],
        },
      },
      134,
    )!;
    expect(a.dockets?.courts[0]?.link).toBeNull();
  });

  it("returns null when there is no activity at all", () => {
    expect(
      parseJudgeActivity({ person_id: 134, dockets: null, opinions: null, referred: null }, 134),
    ).toBeNull();
  });
});

describe("getJudgeCourtListener", () => {
  it("reads the crosswalk by exact id and the activity only for a linked person", async () => {
    const mocked = vi.mocked(restGet);
    mocked.mockReset();
    mocked
      .mockResolvedValueOnce({ rows: [{ p: LINKED }], total: null })
      .mockResolvedValueOnce({ rows: [{ p: ACTIVITY }], total: null });
    const handler = getJudgeCourtListener as unknown as (a: {
      data: { id: string };
    }) => Promise<unknown>;
    const r = (await handler({ data: { id: LINKED.judges_id } })) as {
      activity: { dockets: { assigned: number } };
    };
    expect(r.activity.dockets.assigned).toBe(120);
    expect(mocked.mock.calls[0]![0]).toContain(
      "dataset=eq.judge_cl_crosswalk&id=eq.00124e25efc84bd50ee40f2b0083469f",
    );
    expect(mocked.mock.calls[1]![0]).toContain("dataset=eq.clb_judge_dockets&id=eq.134");

    mocked.mockReset();
    mocked.mockResolvedValueOnce({ rows: [{ p: REVIEW }], total: null });
    const r2 = (await handler({ data: { id: REVIEW.judges_id } })) as { activity: unknown };
    expect(r2.activity).toBeNull();
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("accepts only directory-style ids", () => {
    expect(JUDGE_ID.test("00124e25efc84bd50ee40f2b0083469f")).toBe(true);
    expect(JUDGE_ID.test("../x")).toBe(false);
  });
});
