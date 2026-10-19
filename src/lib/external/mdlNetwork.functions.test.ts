import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: (h: unknown) => h }),
  }),
}));
vi.mock("./rest.server", () => ({ restGet: vi.fn(), rpcPost: vi.fn() }));

const { parseEdges, parseMdlHierarchy, parsePerson, parseScopeTests, parseStateScope } =
  await import("./mdlNetwork.functions");

const person = (id: number, name: string) => ({
  person_id: id,
  name,
  link: `/records/clb_judge_dockets/${id}`,
});

describe("parseMdlHierarchy", () => {
  const raw = {
    mdl: 3047,
    title: "IN RE: Social Media Adolescent Addiction",
    actions: 2425,
    records: 2429,
    jpml_total: 4009,
    jpml_pending: 3824,
    registry_share_of_jpml_pct: 60.5,
    master_docket: { cl_docket_id: 65407433, docket_number: "4:22-md-03047" },
    transferee_court: "cand",
    transferee_court_name: "District Court, N.D. California",
    transferee_judge: person(2766, "Yvonne Gonzalez Rogers"),
    member_judges: {
      joined: 1620,
      top: [{ ...person(2766, "Yvonne Gonzalez Rogers"), dockets: 1491, share_pct: 92 }],
    },
    by_basis: [
      { basis: "jpml_cto", label: "JPML conditional transfer order", actions: 324 },
      { basis: "party_list", label: "Master docket party list", actions: 2037 },
      { basis: "bad", label: "", actions: 3 },
    ],
    members_by_year: [
      { year: 2024, actions: 112 },
      { year: 2022, actions: 12 },
      { year: 1800, actions: 1 },
    ],
    origin: {
      dockets: 345,
      courts: 50,
      states: 34,
      n_days: 195,
      median_days_to_close_in_origin: 33,
      by_year: [{ year: 2026, dockets: 95 }],
      by_court: [
        {
          court_id: "kyed",
          court: "E.D. Kentucky",
          state: "KY",
          dockets: 18,
          link: "/courts/kyed",
        },
        { court_id: "mnd", court: "D. Minnesota", state: "MN", dockets: 153, link: "/courts/mnd" },
        { court_id: "BAD ID", court: "x", state: "XX", dockets: 1 },
        { court_id: "evil", court: "Evil", state: "KY", dockets: 1, link: "https://evil.example/" },
      ],
      by_state: [
        { state: "KY", dockets: 24 },
        { state: "MN", dockets: 153 },
        { state: "Minnesota", dockets: 1 },
      ],
    },
  };

  it("reads the MDL's evidence, judges and origins and sorts them", () => {
    const h = parseMdlHierarchy(raw, 3047)!;
    expect(h).toMatchObject({
      mdl: 3047,
      actions: 2425,
      jpmlTotal: 4009,
      registrySharePct: 60.5,
      masterDocket: { number: "4:22-md-03047", clDocketId: 65407433 },
      transfereeCourt: { id: "cand", name: "District Court, N.D. California" },
      transfereeJudge: { personId: 2766, name: "Yvonne Gonzalez Rogers" },
    });
    expect(h.memberJudges.top[0]).toMatchObject({ dockets: 1491, sharePct: 92 });
    expect(h.byBasis.map((b) => b.basis)).toEqual(["party_list", "jpml_cto"]);
    expect(h.membersByYear).toEqual([
      { year: 2022, n: 12 },
      { year: 2024, n: 112 },
    ]);
    expect(h.origin?.byCourt.map((c) => c.courtId)).toEqual(["mnd", "kyed", "evil"]);
    expect(h.origin?.byCourt.find((c) => c.courtId === "evil")?.link).toBeNull();
    expect(h.origin?.byState.map((s) => s.state)).toEqual(["MN", "KY"]);
    expect(h.origin?.medianDaysToClose).toBe(33);
  });

  it("refuses a record for another MDL and reports no origin when none is recorded", () => {
    expect(parseMdlHierarchy(raw, 3048)).toBeNull();
    expect(parseMdlHierarchy({ ...raw, actions: "many" }, 3047)).toBeNull();
    expect(parseMdlHierarchy({ ...raw, origin: { dockets: 0 } }, 3047)?.origin).toBeNull();
  });
});

describe("judge flows", () => {
  it("keeps only edges whose own side is this exact person", () => {
    const rows = [
      {
        id: "edge:10085~2766",
        p: { from: person(10085, "A"), to: person(2766, "B"), dockets: 13, mdls: [3047] },
      },
      {
        id: "edge:10085~733",
        p: { from: person(10085, "A"), to: person(733, "C"), dockets: 21, mdls: [3043, "x"] },
      },
      {
        id: "edge:99~733",
        p: { from: person(99, "Z"), to: person(733, "C"), dockets: 4, mdls: [1] },
      },
      {
        id: "edge:10085~1",
        p: { from: person(10085, "A"), to: { name: "No id" }, dockets: 2, mdls: [] },
      },
    ];
    const sent = parseEdges(rows, 10085, "from");
    expect(sent.map((e) => [e.other.personId, e.dockets, e.mdls])).toEqual([
      [733, 21, [3043]],
      [2766, 13, [3047]],
    ]);
    expect(parseEdges(rows, 733, "to").map((e) => e.other.personId)).toEqual([10085, 99]);
  });

  it("rejects people without a positive id or a name", () => {
    expect(parsePerson({ person_id: 0, name: "X" })).toBeNull();
    expect(parsePerson({ person_id: 5, name: "" })).toBeNull();
    expect(parsePerson({ person_id: 5, name: "Judge", link: "javascript:alert(1)" })).toEqual({
      personId: 5,
      name: "Judge",
      link: null,
    });
  });
});

describe("state scope", () => {
  const ranking = [
    { state: "DC", per100k: 145.175 },
    { state: "LA", per100k: 3.594 },
    { state: "MN", per100k: 2.744 },
    { state: "AK", per100k: 0 },
  ];

  it("ranks the state by originating dockets per resident and lists its MDLs", () => {
    const s = parseStateScope(
      {
        state: "MN",
        name: "Minnesota",
        dockets: 160,
        per_100k: 2.744,
        population: 5830405,
        population_year: 2025,
        mdls: [
          { mdl: 2885, dockets: 4 },
          { mdl: 3047, dockets: 153 },
          { mdl: -1, dockets: 3 },
        ],
      },
      "MN",
      ranking,
    )!;
    expect(s).toMatchObject({ name: "Minnesota", dockets: 160, rankPer100k: 3, rankedStates: 4 });
    expect(s.mdls).toEqual([
      { mdl: 3047, dockets: 153 },
      { mdl: 2885, dockets: 4 },
    ]);
    expect(
      parseStateScope({ state: "AK", dockets: 0, per_100k: 0 }, "AK", ranking)?.rankPer100k,
    ).toBeNull();
    expect(parseStateScope({ state: "MN", dockets: 1 }, "WI", ranking)).toBeNull();
  });

  it("puts associations that hold first and drops malformed tests", () => {
    const tests = parseScopeTests({
      tests: [
        {
          key: "fars_rate",
          label: "Traffic deaths",
          n: 51,
          rho: 0.031,
          ci: [-0.25, 0.3],
          p: 0.82,
          p_bh: 0.92,
          survives: false,
        },
        {
          key: "fjc",
          label: "Federal civil filings",
          n: 51,
          rho: 0.394,
          ci: [0.13, 0.6],
          p: 0.004,
          p_bh: 0.038,
          survives: true,
        },
        {
          key: "gdp",
          label: "GDP per resident",
          n: 51,
          rho: -0.246,
          ci: [-0.49],
          p: 0.08,
          p_bh: 0.24,
          survives: false,
        },
        { key: "bad", label: "Bad", n: 51, rho: 3 },
      ],
    });
    expect(tests.map((t) => t.key)).toEqual(["fjc", "gdp", "fars_rate"]);
    expect(tests[0]).toMatchObject({ holds: true, ci: [0.13, 0.6], pBh: 0.038 });
    expect(tests[1]!.ci).toBeNull();
  });
});
