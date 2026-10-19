import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));

import { restGet } from "./rest.server";
import {
  courtHref,
  courtHrefIn,
  getClbCiteEdges,
  getClbDocketOverview,
  groupCounts,
  isPartialYear,
  levelFamily,
  parseAppealEdge,
  parseCitingCourt,
  parseCitingDetail,
  parseCiteEdge,
  parseCorrelations,
  parseDisclosures,
  parseDocketCause,
  parseDocketDetail,
  parseDocketLevel,
  parseDocketNos,
  parseDocketNosList,
  parseDocketOverview,
  parseDocketState,
  parseDocketYears,
  parseFlowsOverview,
  parseFlowYears,
  parseMatrix,
  parseNote,
  parseSchemaNote,
  parseSchemaTable,
  parseSchemaTableRow,
  parseSchemaTables,
  parseScotusCiters,
  parseTopCited,
  parseTopCitedDetail,
  parseTopCitedList,
} from "./clbCollection.functions";

const mocked = vi.mocked(restGet);
beforeEach(() => mocked.mockReset());

// Values below are copied from the published rows (clb_docket_master, clb_court_flows, clb_top_cited,
// clb_disclosure_coverage, clb_bulk_schema, clb_district_crossview; snapshot 2026-09-30).
const SNAP = "2026-09-30";

const YEAR_2025 = {
  by_group: { Federal: 1360977, State: 37371 },
  cited_clusters: 9510,
  civil: 344948,
  clusters: 221754,
  criminal: 144812,
  dockets: 1398348,
  partial: false,
  recap: 1355471,
  terminated: 242443,
  year: 2025,
  yoy_pct: 13.8,
};
const YEAR_2026 = {
  by_group: { Federal: 1118837, State: 17428 },
  cited_clusters: 2836,
  civil: 314309,
  clusters: 179329,
  criminal: 107607,
  dockets: 1136265,
  partial: true,
  recap: 1116289,
  terminated: 58847,
  year: 2026,
  yoy_pct: null,
};
const OVERVIEW = {
  sources: [
    { count: 52494652, flags: ["RECAP"], share_pct: 71.91, value: 1 },
    { count: 8658519, flags: ["RECAP", "FJC IDB"], share_pct: 11.86, value: 9 },
  ],
  totals: {
    clusters: 10174551,
    courts_with_dockets: 2204,
    dockets: 72998758,
    dockets_with_filing_date: 63841109,
    first_filed: "1871-10-12",
    implausible_filing_dates: 45,
    last_filed: "2026-09-30",
    no_filing_date: 9157604,
    recap_dockets: 61272199,
    with_assigned_judge: 32552940,
    with_fjc_record: 8408620,
    with_nature_of_suit: 10674611,
  },
};
const CASETYPE = {
  case_types: [
    { count: 11639855, label: "cv", share_pct: 15.9, value: "cv" },
    { count: 6288224, label: "bk", share_pct: 8.6, value: "bk" },
  ],
  total: 72998758,
  without_case_type: 42013542,
};

describe("court links and partial years", () => {
  it("links a court only on its exact path", () => {
    expect(courtHref("ca9", "/courts/ca9")).toBe("/courts/ca9");
    expect(courtHref("ca9", "/courts/ca8")).toBeNull();
    expect(courtHref("ca9", null)).toBeNull();
    expect(courtHref("ca 9", "/courts/ca 9")).toBeNull();
    expect(courtHrefIn("cal", ["/courts/calctapp", "/courts/cal"])).toBe("/courts/cal");
    expect(courtHrefIn("cal", ["/courts/calctapp"])).toBeNull();
    expect(courtHrefIn(null, ["/courts/cal"])).toBeNull();
  });
  it("calls the snapshot's own year partial unless the snapshot is the last day of it", () => {
    expect(isPartialYear(2026, SNAP)).toBe(true);
    expect(isPartialYear(2025, SNAP)).toBe(false);
    expect(isPartialYear(2026, "2026-12-31")).toBe(false);
    expect(isPartialYear(2026, null)).toBe(false);
  });
  it("treats a group left out of a record as zero only when the groups present sum to the whole", () => {
    expect(groupCounts({ Federal: 90, State: 10 }, 100)).toEqual({
      federal: 90,
      state: 10,
      other: 0,
    });
    expect(groupCounts({ Federal: 90 }, 100)).toEqual({ federal: 90, state: null, other: null });
    expect(groupCounts(null, 5)).toEqual({ federal: null, state: null, other: null });
    expect(groupCounts({}, 0)).toEqual({ federal: 0, state: 0, other: 0 });
  });
  it("classes court levels by the dataset's definition", () => {
    expect(levelFamily("FB")).toBe("federal");
    expect(levelFamily("SAG")).toBe("state");
    expect(levelFamily("TS")).toBe("other");
    expect(levelFamily(null)).toBe("other");
  });
});

describe("dataset notes", () => {
  it("reads the snapshot, caveats and definitions and drops blank ones", () => {
    const n = parseNote("clb_docket_master", {
      snapshot: SNAP,
      source: "CourtListener bulk data",
      caveats: ["Not a census.", "", 4],
      definitions: { year: "calendar year of date_filed", empty: " " },
    });
    expect(n).toMatchObject({ snapshot: SNAP, caveats: ["Not a census."] });
    expect(n?.definitions).toEqual([{ term: "year", text: "calendar year of date_filed" }]);
    expect(parseNote("x", null)).toBeNull();
    expect(parseNote("x", { snapshot: "2026-13-45" })?.snapshot).toBeNull();
  });
  it("reads the bulk-file statement of what is not published", () => {
    const n = parseSchemaNote({
      snapshot: SNAP,
      not_in_bulk: { statement: "No COPY statement.", tables: ["people_db_attorney", 3] },
      load_status: { "No public bulk file": 105, bad: "x" },
      totals: { tables_in_schema: 138, tables_with_bulk_file: 33 },
    });
    expect(n?.notInBulk).toEqual({
      statement: "No COPY statement.",
      tables: ["people_db_attorney"],
    });
    expect(n?.loadStatus).toEqual([{ label: "No public bulk file", count: 105 }]);
    expect(n?.totals?.tables).toBe(138);
    expect(parseSchemaNote({ snapshot: SNAP })?.notInBulk).toBeNull();
  });
});

describe("docket overview", () => {
  it("reads the totals, source mix and case types, with shares over all dockets", () => {
    const o = parseDocketOverview(OVERVIEW, CASETYPE)!;
    expect(o.dockets).toBe(72998758);
    expect(o.noFilingDate).toBe(9157604);
    expect(o.firstFiled).toBe("1871-10-12");
    expect(o.sources[0]).toMatchObject({ flags: ["RECAP"], count: 52494652 });
    expect(o.sources[0]!.sharePct).toBeCloseTo(71.91, 1);
    expect(o.caseTypes.map((c) => c.code)).toEqual(["cv", "bk"]);
    expect(o.withoutCaseType).toBe(42013542);
    expect(o.withCaseType).toBe(72998758 - 42013542);
  });
  it("nulls a part larger than the whole and drops case types that do not cover the same dockets", () => {
    const o = parseDocketOverview(
      { ...OVERVIEW, totals: { ...OVERVIEW.totals, with_assigned_judge: 80000000 } },
      { ...CASETYPE, total: 5 },
    )!;
    expect(o.assignedJudge).toBeNull();
    expect(o.caseTypes).toEqual([]);
  });
  it("has no overview without a positive docket total", () => {
    expect(parseDocketOverview({ totals: {} }, null)).toBeNull();
    expect(parseDocketOverview({ totals: { dockets: 0 } }, null)).toBeNull();
    expect(parseDocketOverview(null, null)).toBeNull();
  });
});

describe("dockets by year", () => {
  const rows = [
    { id: "year:2026", p: YEAR_2026 },
    { id: "year:2025", p: YEAR_2025 },
  ];
  it("sorts by year and marks the snapshot year partial", () => {
    const { rows: out, dropped } = parseDocketYears(rows, SNAP, 2);
    expect(out.map((y) => y.year)).toEqual([2025, 2026]);
    expect(dropped).toBe(0);
    expect(out[1]!.partial).toBe(true);
    expect(out[0]!.partial).toBe(false);
  });
  it("flags the snapshot year as partial even when the record lacks the flag, and never carries its change", () => {
    const { partial: _p, ...bare } = YEAR_2026;
    const y = parseDocketYears([{ id: "year:2026", p: { ...bare, yoy_pct: 7 } }], SNAP).rows[0]!;
    expect(y.partial).toBe(true);
    expect(y.yoyPct).toBeNull();
  });
  it("derives other dockets and leaves it null when civil and criminal exceed the total", () => {
    const y = parseDocketYears(rows, SNAP).rows[0]!;
    expect(y.other).toBe(1398348 - 344948 - 144812);
    expect(y.federal).toBe(1360977);
    expect(y.otherGroup).toBe(0);
    const bad = parseDocketYears(
      [{ id: "year:2025", p: { ...YEAR_2025, civil: 1000000, criminal: 1000000 } }],
      SNAP,
    ).rows[0]!;
    expect(bad.civil).toBe(1000000);
    expect(bad.other).toBeNull();
  });
  it("drops a record whose id disagrees with its year and a repeated year", () => {
    const listed = parseDocketYears(
      [
        { id: "year:2024", p: YEAR_2025 },
        { id: "year:2025", p: YEAR_2025 },
        { id: "year:2025", p: YEAR_2025 },
        { id: "year:2023", p: { year: 2023 } },
      ],
      SNAP,
    );
    expect(listed.rows.map((y) => y.year)).toEqual([2025]);
    expect(listed.dropped).toBe(3);
  });
});

describe("court levels and states", () => {
  const SA = {
    clusters: 3735912,
    code: "SA",
    courts: 106,
    dockets: 4741249,
    label: "State appellate",
    recap: 2,
    terminated: 2,
    top_courts: [
      {
        court_id: "nyappdiv",
        dockets: 774729,
        link: "/courts/nyappdiv",
        name: "Appellate Division of the Supreme Court of the State of New York",
      },
      { court_id: "xx", dockets: 5, link: null, name: "A court with no link" },
      { court_id: "bad id", dockets: 5, link: "/courts/bad id", name: "Bad" },
    ],
  };
  it("reads a level with its family and links only the courts whose own link matches", () => {
    const l = parseDocketLevel({ id: "level:SA", p: SA })!;
    expect(l.family).toBe("state");
    expect(l.dockets).toBe(4741249);
    expect(l.topCourts.map((c) => c.courtId)).toEqual(["nyappdiv", "xx"]);
    expect(l.topCourts[0]!.href).toBe("/courts/nyappdiv");
    expect(l.topCourts[1]!.href).toBeNull();
  });
  it("keeps the record of courts without a level code, and drops a record whose id and code disagree", () => {
    const none = parseDocketLevel({
      id: "level:none",
      p: { clusters: 4, code: null, courts: 0, dockets: 0, label: "Not recorded", top_courts: [] },
    })!;
    expect(none.code).toBeNull();
    expect(none.family).toBe("other");
    expect(parseDocketLevel({ id: "level:FD", p: SA })).toBeNull();
    expect(parseDocketLevel({ id: "level:SA", p: { ...SA, dockets: -1 } })).toBeNull();
  });
  it("reads a state, counting an absent group as zero only because the groups add up", () => {
    const pr = parseDocketState({
      id: "state:PR",
      p: {
        by_group: { Federal: 545124, Other: 58906 },
        civil: 47918,
        clusters: 70847,
        courts: 4,
        dockets: 604030,
        recap: 527278,
        state: "PR",
        top_courts: [],
      },
    })!;
    expect(pr.federal).toBe(545124);
    expect(pr.stateCourts).toBe(0);
    expect(pr.other).toBe(58906);
    const partial = parseDocketState({
      id: "state:PR",
      p: { by_group: { Federal: 1 }, courts: 4, dockets: 10, state: "PR" },
    })!;
    expect(partial.stateCourts).toBeNull();
  });
  it("drops states with a malformed code or an id that disagrees", () => {
    const p = { courts: 4, dockets: 10, state: "pr", by_group: {} };
    expect(parseDocketState({ id: "state:pr", p })).toBeNull();
    expect(parseDocketState({ id: "state:PR", p: { ...p, state: "PR" } })).not.toBeNull();
    expect(parseDocketState({ id: "state:CA", p: { ...p, state: "PR" } })).toBeNull();
  });
});

describe("nature of suit, groups and causes", () => {
  const NOS = {
    id: "nos:365",
    code: 365,
    text: "365 Personal injury - Product liability",
    dockets: 713032,
    dated: 713032,
    terminated: 662933,
    tpct: 93,
    grp: "product",
    grpLabel: "Product liability and health-care / pharma injury",
    l0: "/records/fjc_civil_nos/nos:365",
    l1: null,
  };
  it("links the FJC record only when the record's own links contain that exact path", () => {
    expect(parseDocketNos(NOS)!.fjcHref).toBe("/records/fjc_civil_nos/nos:365");
    expect(parseDocketNos({ ...NOS, l0: null })!.fjcHref).toBeNull();
    expect(parseDocketNos({ ...NOS, l0: "/records/fjc_civil_nos/nos:550" })!.fjcHref).toBeNull();
    expect(
      parseDocketNos({ ...NOS, l0: null, l1: "/records/fjc_civil_nos/nos:365" })!.fjcHref,
    ).toBe("/records/fjc_civil_nos/nos:365");
  });
  it("falls back to the counts for the terminated share and rejects an id that does not carry the code", () => {
    expect(parseDocketNos({ ...NOS, tpct: null })!.terminatedPct).toBeCloseTo(92.97, 1);
    expect(parseDocketNos({ ...NOS, tpct: 140 })!.terminatedPct).toBeCloseTo(92.97, 1);
    expect(parseDocketNos({ ...NOS, id: "nos:366" })).toBeNull();
    expect(parseDocketNos({ ...NOS, code: 99, id: "nos:99" })).toBeNull();
    expect(parseDocketNos({ ...NOS, terminated: 800000 })!.terminated).toBeNull();
  });
  it("sums the groups into the denominator of every nature-of-suit share", () => {
    const list = parseDocketNosList(
      [NOS, { ...NOS, id: "nos:bad" }],
      [
        { id: "group:product", key: "product", label: "Product", dockets: 100, l0: null },
        {
          id: "group:tax",
          key: "tax",
          label: "Tax",
          dockets: 50,
          l0: "/records/fjc_civil_nos/group:tax",
        },
        { id: "group:tax", key: "tax", label: "Tax", dockets: 50 },
        { id: "group:ip", key: "other", label: "IP", dockets: 5 },
      ],
      { nos: 2, groups: 4 },
    );
    expect(list.numericCodeDockets).toBe(150);
    expect(list.nos.dropped).toBe(1);
    expect(list.groups.dropped).toBe(2);
    expect(list.groups.rows.find((g) => g.key === "tax")!.fjcHref).toBe(
      "/records/fjc_civil_nos/group:tax",
    );
  });
  it("reads a cause only when its id carries the rank", () => {
    const p = { cause: "42:1983 Prisoner Civil Rights", dockets: 294977, rank: 1, top_courts: [] };
    expect(parseDocketCause({ id: "cause:001", p })!.cause).toBe("42:1983 Prisoner Civil Rights");
    expect(parseDocketCause({ id: "cause:002", p })).toBeNull();
    expect(parseDocketCause({ id: "cause:000", p: { ...p, rank: 0 } })).toBeNull();
  });
  it("reads a drill-down with the partial year flagged and no termination counts for a group", () => {
    const d = parseDocketDetail(
      "nos:365",
      {
        by_year: [
          { n: 5575, n_term: 206, yr: 2026 },
          { n: 20086, n_term: 1169, yr: 2025 },
          { n: 5, n_term: 9, yr: 2024 },
          { n: 1, yr: 2025 },
        ],
        top_courts: [
          { court_id: "flnd", dockets: 106066, link: "/courts/flnd", name: "N.D. Florida" },
        ],
      },
      SNAP,
    )!;
    expect(d.byYear.map((y) => y.year)).toEqual([2024, 2025, 2026]);
    expect(d.byYear[2]!.partial).toBe(true);
    expect(d.byYear[0]!.terminated).toBeNull();
    expect(d.topCourts[0]!.href).toBe("/courts/flnd");
    const g = parseDocketDetail("group:tax", { by_year: [{ n: 4, yr: 2020 }] }, SNAP)!;
    expect(g.byYear[0]!.terminated).toBeNull();
    expect(parseDocketDetail("tax", { by_year: [{ n: 4, yr: 2020 }] }, SNAP)).toBeNull();
    expect(parseDocketDetail("nos:365", {}, SNAP)).toBeNull();
  });
});

describe("cross-source correlations", () => {
  const row = {
    id: "corr:fjc_filings|fcms_filings",
    c: {
      ci_high: 0.979,
      ci_low: 0.953,
      n: 94,
      rho: 0.969,
      role: "validity",
      strength: "very strong",
      why: "Two official sources count the same court's workload.",
    },
    a: { key: "fjc_filings", label: "Civil filings", period: "FY2025", source: "FJC IDB" },
    b: { key: "fcms_filings", label: "Total filings", period: "12 months", source: "FCMS" },
  };
  it("keeps validity pairs and drops context pairs", () => {
    expect(parseCorrelations([row])).toHaveLength(1);
    expect(parseCorrelations([{ ...row, c: { ...row.c, role: "context" } }])).toEqual([]);
  });
  it("drops a pair whose interval does not contain its estimate, whose id disagrees, or whose n is too small", () => {
    expect(parseCorrelations([{ ...row, c: { ...row.c, ci_low: 0.98, ci_high: 0.99 } }])).toEqual(
      [],
    );
    expect(parseCorrelations([{ ...row, id: "corr:a|b" }])).toEqual([]);
    expect(parseCorrelations([{ ...row, c: { ...row.c, n: 3 } }])).toEqual([]);
    expect(parseCorrelations([{ ...row, c: { ...row.c, rho: 1.2 } }])).toEqual([]);
    expect(parseCorrelations([{ ...row, b: null }])).toEqual([]);
  });
});

describe("citation flows", () => {
  const OVERVIEW_FLOWS = {
    appeal_dockets: 852353,
    citations: 78193408,
    citing_filed_before_cited: 162099,
    cross_edge_floor: 2778,
    cross_edges_published: 1500,
    cross_links_not_published: 8301387,
    cross_pairs_at_least_100: 18395,
    cross_pairs_not_published: 16895,
    map_links: 78404647,
    opinion_not_in_opinion_table: 19298,
    same_court: 29080157,
    same_decision_links: 191763,
    undated_links: 190,
    unresolved: 178,
  };
  it("reads the overview and checks that every excluded group reconciles", () => {
    const o = parseFlowsOverview(OVERVIEW_FLOWS)!;
    expect(o.reconciles).toBe(true);
    expect(o.excluded).toBe(211239);
    expect(o.sameDecisionLinks).toBe(191763);
    expect(o.sameCourt).toBe(29080157);
    expect(o.citingFiledBeforeCited).toBe(162099);
    expect(o.undatedLinks).toBe(190);
    // A group that does not add up is not reported as reconciled.
    expect(parseFlowsOverview({ ...OVERVIEW_FLOWS, same_decision_links: 5 })!.reconciles).toBe(
      false,
    );
    expect(
      parseFlowsOverview({
        citations: 100,
        map_links: 130,
        unresolved: 5,
        opinion_not_in_opinion_table: 5,
      })!.reconciles,
    ).toBe(false);
    expect(parseFlowsOverview({ citations: 0 })).toBeNull();
    expect(parseFlowsOverview({ citations: 10, same_court: 11 })!.sameCourt).toBeNull();
  });
  it("reads an overview from before same-decision links were set aside", () => {
    const o = parseFlowsOverview({
      citations: 78385171,
      map_links: 78404647,
      opinion_not_in_opinion_table: 19298,
      unresolved: 178,
    })!;
    expect(o.reconciles).toBe(true);
    expect(o.sameDecisionLinks).toBeNull();
    expect(o.crossEdgesPublished).toBeNull();
  });
  it("states the published pairs, the smallest one, and the unpublished tail only when they agree", () => {
    const o = parseFlowsOverview(OVERVIEW_FLOWS)!;
    expect(o).toMatchObject({
      crossPairsAtLeast100: 18395,
      crossEdgesPublished: 1500,
      crossEdgeFloor: 2778,
      crossPairsNotPublished: 16895,
      crossLinksNotPublished: 8301387,
    });
    // 18,395 pairs less 1,500 published is 16,895: a tail count that disagrees is not shown.
    const bad = parseFlowsOverview({ ...OVERVIEW_FLOWS, cross_pairs_not_published: 100 })!;
    expect(bad.crossPairsNotPublished).toBeNull();
    expect(bad.crossLinksNotPublished).toBeNull();
    expect(bad.crossEdgeFloor).toBe(2778);
    expect(
      parseFlowsOverview({ ...OVERVIEW_FLOWS, cross_edges_published: 20000 })!
        .crossPairsNotPublished,
    ).toBeNull();
  });
  it("reads a circuit matrix with row totals, and rejects a grid of the wrong shape", () => {
    const raw = {
      columns: ["ca1", "ca2", "scotus"],
      rows: ["ca1", "ca2"],
      names: { ca1: "First Circuit", ca2: "Second Circuit", scotus: "Supreme Court" },
      cells: [
        [10, 2, 6],
        [3, 20, "x"],
      ],
    };
    const m = parseMatrix(raw, "circuits", new Map([["ca1", 40]]))!;
    expect(m.rows[0]).toEqual({ key: "ca1", label: "First Circuit", total: 40 });
    expect(m.rows[1]!.total).toBeNull();
    expect(m.columns[2]!.label).toBe("Supreme Court");
    expect(m.cells[1]![2]).toBeNull();
    expect(parseMatrix({ ...raw, cells: [[1, 2, 3]] }, "circuits")).toBeNull();
    expect(
      parseMatrix(
        {
          ...raw,
          cells: [
            [1, 2],
            [3, 4],
          ],
        },
        "circuits",
      ),
    ).toBeNull();
    expect(parseMatrix({ ...raw, rows: ["ca1", "ca1"] }, "circuits")).toBeNull();
  });
  it("reads a level matrix with each level's total links and how complete the table is", () => {
    const m = parseMatrix(
      {
        levels: ["A", "B"],
        cells: [
          [10, 20],
          [30, 40],
        ],
        row_totals: [35, 70],
        total_links: 120,
        shown_links: 100,
        omitted_levels: ["C", "D", 7],
        federal_appellate_cited_scotus_pct: 38.8,
      },
      "levels",
    )!;
    // Row A makes 35 links, 30 of them to the levels shown; row B makes 70, all 70 to levels shown.
    expect(m.rows.map((r) => r.total)).toEqual([35, 70]);
    expect(m.meta).toEqual({
      totalLinks: 120,
      shownLinks: 100,
      omittedLevels: ["C", "D"],
      federalAppellateCitedScotusPct: 38.8,
    });
  });
  it("does not trust a level total smaller than its own cells, or a shown count above the total", () => {
    const m = parseMatrix(
      {
        levels: ["A", "B"],
        cells: [
          [10, 20],
          [30, 40],
        ],
        row_totals: [29, 70],
        total_links: 90,
        shown_links: 100,
      },
      "levels",
    )!;
    expect(m.rows.map((r) => r.total)).toEqual([null, 70]);
    expect(m.meta?.shownLinks).toBeNull();
    const none = parseMatrix({ levels: ["A"], cells: [[1]] }, "levels")!;
    expect(none.rows[0]!.total).toBeNull();
    expect(none.meta?.omittedLevels).toEqual([]);
    expect(parseMatrix({ columns: ["a"], rows: ["a"], cells: [[1]] }, "circuits")!.meta).toBeNull();
  });
  it("reads a level matrix where rows and columns are the same levels", () => {
    const m = parseMatrix(
      {
        levels: ["A", "B"],
        cells: [
          [1, 2],
          [3, 4],
        ],
      },
      "levels",
    )!;
    expect(m.rows.map((r) => r.key)).toEqual(["A", "B"]);
    expect(m.columns.map((c) => c.key)).toEqual(["A", "B"]);
  });
  it("keeps Supreme Court citers whose count fits within the total and links them by their own link", () => {
    const s = parseScotusCiters({
      total: 11963885,
      citers: [
        {
          count: 534711,
          court_id: "ca9",
          link: "/courts/ca9",
          name: "Ninth Circuit",
          share_pct: 4.5,
        },
        {
          count: 99999999,
          court_id: "ca5",
          link: "/courts/ca5",
          name: "Fifth Circuit",
          share_pct: 3.5,
        },
        { count: 9, court_id: "ca6", link: "/courts/ca5", name: "Sixth Circuit", share_pct: 0 },
      ],
    })!;
    expect(s.citers.map((c) => c.courtId)).toEqual(["ca9", "ca6"]);
    expect(s.citers[1]!.href).toBeNull();
    expect(parseScotusCiters({ total: 0, citers: [] })).toBeNull();
  });
  const CA9 = {
    id: "citing:ca9",
    name: "Court of Appeals for the Ninth Circuit",
    level: "Federal appellate",
    courtId: "ca9",
    total: 1987369,
    selfPct: 49.9,
    scotusPct: 26.9,
    groups: { Federal: 1844432, Other: 205, State: 142732 },
    lag: { mean_years: 13.4, median_years: 8, n: 1983523, p90_years: 31.3 },
    l0: "/courts/ca9",
  };
  it("reads a citing court with group shares over its citations and the age of what it cites", () => {
    const c = parseCitingCourt(CA9)!;
    expect(c.federalPct).toBeCloseTo(92.8, 1);
    expect(c.statePct).toBeCloseTo(7.18, 1);
    expect(c.lag).toEqual({ median: 8, mean: 13.4, p90: 31.3, n: 1983523 });
    expect(c.href).toBe("/courts/ca9");
  });
  it("does not assume a missing group is zero unless the groups add up, and does not link without the record's link", () => {
    const short = parseCitingCourt({ ...CA9, groups: { Federal: 1844432 }, l0: null })!;
    expect(short.statePct).toBeNull();
    expect(short.href).toBeNull();
    const whole = parseCitingCourt({ ...CA9, groups: { Federal: 1844432, State: 142937 } })!;
    expect(whole.otherPct).toBe(0);
  });
  it("drops a citing court whose id disagrees or that has no citations", () => {
    expect(parseCitingCourt({ ...CA9, id: "citing:ca5" })).toBeNull();
    expect(parseCitingCourt({ ...CA9, total: 0 })).toBeNull();
    expect(parseCitingCourt({ ...CA9, name: " " })).toBeNull();
  });
  it("reads the most-cited courts of one citing court only for that court", () => {
    const p = {
      court_id: "ca9",
      total: 1987369,
      top: [
        { count: 990863, court_id: "ca9", link: "/courts/ca9", name: "Ninth", share_pct: 49.9 },
      ],
    };
    expect(parseCitingDetail("ca9", p)!.top[0]!.sharePct).toBe(49.9);
    expect(parseCitingDetail("ca5", p)).toBeNull();
    expect(parseCitingDetail("ca9", { court_id: "ca9", top: [] })).toBeNull();
  });
  const CITE = {
    id: "cite:calctapp>cal",
    p: {
      cited_court: "cal",
      citing_court: "calctapp",
      count: 895200,
      share_of_cited_pct: 57.2,
      share_of_citing_pct: 40,
    },
    from: "California Court of Appeal",
    to: "California Supreme Court",
    fl: "State appellate",
    tl: "State supreme",
    l0: "/courts/calctapp",
    l1: "/courts/cal",
  };
  it("reads a cross-court edge and links each court only when the record links it", () => {
    const e = parseCiteEdge(CITE)!;
    expect(e.links).toBe(895200);
    expect(e.citing.href).toBe("/courts/calctapp");
    expect(e.cited.href).toBe("/courts/cal");
    const half = parseCiteEdge({ ...CITE, l1: null })!;
    expect(half.cited.href).toBeNull();
    expect(half.citing.href).toBe("/courts/calctapp");
  });
  it("drops an edge from a court to itself, with an id that disagrees, or with no links", () => {
    expect(parseCiteEdge({ ...CITE, p: { ...CITE.p, cited_court: "calctapp" } })).toBeNull();
    expect(parseCiteEdge({ ...CITE, id: "cite:cal>calctapp" })).toBeNull();
    expect(parseCiteEdge({ ...CITE, p: { ...CITE.p, count: 0 } })).toBeNull();
  });
  it("reads an appeal edge in the order appealed from, then receiving court", () => {
    const e = parseAppealEdge({
      id: "appeal:txctapp5>texcrimapp",
      p: { appellate_court: "texcrimapp", dockets: 27024, from_court: "txctapp5", share_pct: 11.2 },
      from: "Texas Court of Appeals, 5th District (Dallas)",
      to: "Court of Criminal Appeals of Texas",
      fl: "State appellate",
      tl: "State supreme",
      l0: "/courts/texcrimapp",
      l1: "/courts/txctapp5",
    })!;
    expect(e.from.id).toBe("txctapp5");
    expect(e.to.id).toBe("texcrimapp");
    expect(e.from.href).toBe("/courts/txctapp5");
    expect(e.sharePct).toBe(11.2);
  });
  it("flags the snapshot year of the citation series as partial and drops repeats", () => {
    const rows = [
      {
        id: "year:2026",
        p: {
          by_group: { Federal: 1180762, Other: 19499, State: 506513 },
          citations: 1706774,
          same_court: 368709,
          year: 2026,
        },
      },
      {
        id: "year:2025",
        p: {
          by_group: { Federal: 1499894, Other: 29709, State: 741388 },
          citations: 2270991,
          same_court: 515342,
          year: 2025,
        },
      },
      { id: "year:2025", p: { citations: 1, year: 2025 } },
    ];
    const listed = parseFlowYears(rows, SNAP, 3);
    expect(listed.rows.map((y) => [y.year, y.partial])).toEqual([
      [2025, false],
      [2026, true],
    ]);
    expect(listed.dropped).toBe(1);
    expect(listed.rows[1]!.federal).toBe(1180762);
  });
});

describe("most-cited opinions", () => {
  const IQBAL = {
    id: "cluster:145875",
    c: {
      case: "Ashcroft v. Iqbal",
      citation: "556 U.S. 662",
      court: "Supreme Court of the United States",
      federal_pct: 99.6,
      map_links: 159004,
      rank: 1,
      state_pct: 0.3,
      times_cited: 159280,
      year: 2009,
    },
    courtId: "scotus",
    cluster: 145875,
    url: "https://www.courtlistener.com/opinion/145875/",
    filed: "2009-05-18",
    known: 158841,
    groups: { Federal: 158227, Other: 104, State: 510 },
    par: { avg_score: 0.55, describing_opinions: 14940, n: 16070 },
    ratio: 0.998,
    twins: [],
    before: 4,
    l0: "https://www.courtlistener.com/opinion/145875/",
    l1: "/courts/scotus",
  };
  it("keeps times cited and map links as two separate measures", () => {
    const r = parseTopCited(IQBAL)!;
    expect(r.timesCited).toBe(159280);
    expect(r.mapLinks).toBe(159004);
    expect(r.knownCitingCourt).toBe(158841);
    expect(r.linksCitingFiledBeforeCited).toBe(4);
    expect(r.mapToCountRatio).toBe(0.998);
    expect(r.lowMapRatio).toBe(false);
    expect(r.twinRanks).toEqual([]);
    expect(r.federalPct).toBe(99.6);
    expect(r.otherPct).toBeCloseTo(0.065, 2);
    expect(r.parentheticals).toBe(16070);
    expect(r.courtHref).toBe("/courts/scotus");
  });
  it("flags a cluster whose map holds under half the links its citation_count says", () => {
    const low = parseTopCited({ ...IQBAL, ratio: 0.084 })!;
    expect(low.lowMapRatio).toBe(true);
    expect(low.mapToCountRatio).toBe(0.084);
    expect(parseTopCited({ ...IQBAL, ratio: 0.5 })!.lowMapRatio).toBe(false);
    // More map links than citation_count is not a flag; a missing ratio is not a flag either.
    expect(parseTopCited({ ...IQBAL, ratio: 1.007 })!.lowMapRatio).toBe(false);
    const unknown = parseTopCited({ ...IQBAL, ratio: null })!;
    expect(unknown.lowMapRatio).toBe(false);
    expect(unknown.mapToCountRatio).toBeNull();
  });
  it("names the other listed ranks that carry the same reporter citation, never its own rank", () => {
    expect(parseTopCited({ ...IQBAL, twins: [631] })!.twinRanks).toEqual([631]);
    expect(parseTopCited({ ...IQBAL, twins: [1, 5, "x", -2, 0] })!.twinRanks).toEqual([5]);
    expect(parseTopCited({ ...IQBAL, twins: null })!.twinRanks).toEqual([]);
  });
  it("uses the record's url only when it is exactly the opinion URL of this cluster", () => {
    expect(parseTopCited(IQBAL)!.url).toBe("https://www.courtlistener.com/opinion/145875/");
    expect(parseTopCited({ ...IQBAL, url: "https://example.com/opinion/145875/" })!.url).toBeNull();
    expect(
      parseTopCited({ ...IQBAL, url: "https://www.courtlistener.com/opinion/1/" })!.url,
    ).toBeNull();
  });
  it("shows Not recorded (null) for parentheticals when the record has none, and links no court without the link", () => {
    const r = parseTopCited({ ...IQBAL, par: null, l1: null })!;
    expect(r.parentheticals).toBeNull();
    expect(r.courtHref).toBeNull();
  });
  it("drops a record whose id, rank or counts are unreadable", () => {
    expect(parseTopCited({ ...IQBAL, id: "cluster:1" })).toBeNull();
    expect(parseTopCited({ ...IQBAL, c: { ...IQBAL.c, rank: 0 } })).toBeNull();
    expect(parseTopCited({ ...IQBAL, c: { ...IQBAL.c, times_cited: null } })).toBeNull();
    expect(parseTopCited({ ...IQBAL, known: 999999999 })!.knownCitingCourt).toBeNull();
  });
  it("sorts the list by rank and drops a repeated cluster", () => {
    const second = {
      ...IQBAL,
      id: "cluster:145730",
      cluster: 145730,
      c: { ...IQBAL.c, rank: 2, case: "Bell Atlantic Corp. v. Twombly" },
      url: "https://www.courtlistener.com/opinion/145730/",
    };
    const listed = parseTopCitedList([second, IQBAL, IQBAL], 3);
    expect(listed.rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(listed.dropped).toBe(1);
  });
  it("reads the citing courts and decades of one cluster and drops decades that are not decades", () => {
    const d = parseTopCitedDetail(145875, {
      cluster_id: 145875,
      citing_by_decade: [
        { decade: 2020, n: 123242 },
        { decade: 1955, n: 3 },
        { decade: 2000, n: 1166 },
      ],
      citing_courts: [
        {
          count: 9233,
          court_id: "nysd",
          link: "/courts/nysd",
          name: "S.D. New York",
          share_pct: 5.8,
        },
      ],
      citations: [
        { page: "662", reporter: "U.S.", type: 1, volume: "556" },
        { page: "1937", reporter: "S. Ct.", type: 1, volume: "129" },
        { page: "662", reporter: "U.S.", type: 1, volume: "556" },
        { page: "", reporter: "L. Ed. 2d", type: 1, volume: "173" },
      ],
      citing_groups: { Federal: 158227, Other: 104, State: 510 },
      links_with_known_citing_court: 158841,
      first_cited_year: 1958,
      last_cited_year: 2026,
      parentheticals: { describing_opinions: 14940, n: 16070 },
    })!;
    expect(d.byDecade.map((x) => x.decade)).toEqual([2000, 2020]);
    // Every reporter citation is listed once; one without a page is not invented.
    expect(d.reporterCitations).toEqual(["556 U.S. 662", "129 S. Ct. 1937"]);
    expect(d.citingCourts[0]!.href).toBe("/courts/nysd");
    expect(d.parentheticals).toEqual({ total: 16070, describingOpinions: 14940 });
    expect(parseTopCitedDetail(1, { cluster_id: 145875 })).toBeNull();
  });
});

describe("disclosure coverage (counts only)", () => {
  const rows = [
    {
      id: "overview:all",
      p: {
        first_year: 1987,
        judicial_people: 15378,
        judicial_people_with_report: 3387,
        last_year: 2022,
        persons: 3392,
        reports: 32336,
        reports_by_person_distribution: { "1": 201, "11+": 1140, "2-5": 696, "6-10": 1355 },
        sections: { investments: 1901720, gifts: 2025 },
      },
    },
    {
      id: "year:2015",
      p: {
        amended: 539,
        extracted: 2351,
        items: { agreements: 646, debts: 1478, gifts: 178, investments: 145393 },
        median_pages: 8,
        persons: 2338,
        reports: 2360,
        year: 2015,
      },
    },
    {
      id: "court:calsuppctla",
      p: {
        court_id: "calsuppctla",
        first_year: 1997,
        last_year: 2020,
        level: "State trial",
        name: "Superior Court of California, County of Los Angeles",
        people: 1046,
        reports: 133,
        with_report: 17,
      },
      l0: "/courts/calsuppctla",
      l1: "/records/clb_court_benches/calsuppctla",
    },
  ];
  it("reads the overview, a year and a court", () => {
    const d = parseDisclosures(rows);
    expect(d.overview?.judicialWithReport).toBe(3387);
    expect(d.overview?.reportsPerPerson.map((b) => b.bucket)).toEqual(["1", "2-5", "6-10", "11+"]);
    expect(d.overview?.sections[0]).toEqual({ section: "investments", items: 1901720 });
    expect(d.years.rows[0]).toMatchObject({
      year: 2015,
      reports: 2360,
      amended: 539,
      lineItems: 147695,
    });
    expect(d.courts.rows[0]).toMatchObject({ id: "calsuppctla", people: 1046, withReport: 17 });
    expect(d.courts.rows[0]!.href).toBe("/courts/calsuppctla");
  });
  it("has no line-item total when a section count is unreadable", () => {
    const bad = rows.map((r) =>
      r.id === "year:2015" ? { ...r, p: { ...r.p, items: { gifts: 178, debts: "n/a" } } } : r,
    );
    expect(parseDisclosures(bad).years.rows[0]!.lineItems).toBeNull();
  });
  it("drops a court with more people with a report than people, and ignores reversed filing years", () => {
    const court = rows[2]!;
    const broken = [{ ...court, p: { ...(court.p as object), with_report: 2000 } }];
    expect(parseDisclosures(broken).courts.rows).toEqual([]);
    expect(parseDisclosures(broken).courts.dropped).toBe(1);
    const reversed = [
      { ...court, p: { ...(court.p as object), first_year: 2020, last_year: 1997 } },
    ];
    expect(parseDisclosures(reversed).courts.rows[0]).toMatchObject({
      firstYear: null,
      lastYear: null,
    });
  });
  it("reports no overview when the record is missing, but still returns the years", () => {
    const d = parseDisclosures(rows.slice(1));
    expect(d.overview).toBeNull();
    expect(d.years.rows).toHaveLength(1);
  });
});

describe("bulk schema", () => {
  const ATTORNEY = {
    bulk: "No",
    columns: 8,
    compressed_mb: null,
    foreign_keys: 0,
    group: "people_db",
    label: "Attorneys named on RECAP dockets",
    loaded: "No public bulk file",
    referenced_by: 2,
    rows_loaded: null,
    table: "people_db_attorney",
  };
  const AUDIO = {
    bulk: "Yes",
    columns: 22,
    compressed_mb: 691.9,
    foreign_keys: 1,
    group: "audio",
    label: "Oral argument recordings",
    loaded: "Public bulk file, loaded here (selected columns)",
    referenced_by: 2,
    rows_loaded: 103710,
    table: "audio_audio",
  };
  it("reads a table without a bulk file and one loaded with selected columns", () => {
    expect(parseSchemaTableRow({ id: "table:people_db_attorney", c: ATTORNEY })).toMatchObject({
      bulk: false,
      load: "none",
      rowsLoaded: null,
      compressedMb: null,
    });
    expect(parseSchemaTableRow({ id: "table:audio_audio", c: AUDIO })).toMatchObject({
      bulk: true,
      load: "selected",
      rowsLoaded: 103710,
      compressedMb: 691.9,
    });
  });
  it("drops a table whose bulk flag contradicts its load status, or whose id disagrees", () => {
    expect(
      parseSchemaTableRow({ id: "table:audio_audio", c: { ...AUDIO, bulk: "No" } }),
    ).toBeNull();
    expect(
      parseSchemaTableRow({ id: "table:people_db_attorney", c: { ...ATTORNEY, bulk: "Yes" } }),
    ).toBeNull();
    expect(parseSchemaTableRow({ id: "table:other", c: AUDIO })).toBeNull();
    expect(
      parseSchemaTableRow({ id: "table:audio_audio", c: { ...AUDIO, bulk: "Maybe" } }),
    ).toBeNull();
  });
  it("keeps an unrecognised load status as unknown rather than guessing", () => {
    const r = parseSchemaTableRow({
      id: "table:audio_audio",
      c: { ...AUDIO, loaded: "Public bulk file, partially loaded" },
    })!;
    expect(r.load).toBe("unknown");
    expect(r.loadLabel).toBe("Public bulk file, partially loaded");
  });
  it("lists tables once each and counts the ones it dropped", () => {
    const listed = parseSchemaTables(
      [
        { id: "table:audio_audio", c: AUDIO },
        { id: "table:audio_audio", c: AUDIO },
        { id: "table:people_db_attorney", c: ATTORNEY },
        { id: "table:x", c: {} },
      ],
      4,
    );
    expect(listed.rows).toHaveLength(2);
    expect(listed.dropped).toBe(2);
  });
  const PROFILE = {
    bulk_file: "oral-arguments-2026-09-30.csv.bz2",
    columns: [
      { comment: null, in_bulk_file: true, name: "id", not_null: true, type: "integer" },
      {
        comment: "Seconds of audio.",
        in_bulk_file: true,
        name: "duration",
        not_null: false,
        type: "integer",
      },
      { comment: null, in_bulk_file: true, name: "case_name", not_null: true, type: "text" },
    ],
    foreign_keys: [
      { column: "docket_id", referenced_column: "id", references: "search_docket" },
      { column: "x", referenced_column: "id", references: "Bad Name" },
    ],
    group: "audio",
    label: "Oral argument recordings",
    load_profile: {
      columns: [
        { name: "id", populated: 103710, populated_pct: 100, type: "BIGINT" },
        { name: "duration", populated: 103640, populated_pct: 99.93, type: "INTEGER" },
      ],
      rows: 103710,
    },
    loaded: "Public bulk file, loaded here (selected columns)",
    table: "audio_audio",
  };
  const LINKS = [
    { label: "Published schema (SQL)", url: "https://example.org/schema.sql" },
    { label: "Bulk-data load script", url: "javascript:alert(1)" },
  ];
  it("joins the populated share to the columns that were loaded and marks the rest not loaded", () => {
    const t = parseSchemaTable("audio_audio", PROFILE, LINKS)!;
    expect(t.columns.map((c) => [c.name, c.loadedHere, c.populatedPct])).toEqual([
      ["id", true, 100],
      ["duration", true, 99.93],
      ["case_name", false, null],
    ]);
    expect(t.columns[1]!.comment).toBe("Seconds of audio.");
    expect(t.foreignKeys).toEqual([
      { column: "docket_id", references: "search_docket", referencedColumn: "id" },
    ]);
    expect(t.rowsLoaded).toBe(103710);
  });
  it("links the schema and load script only as http(s)", () => {
    const t = parseSchemaTable("audio_audio", PROFILE, LINKS)!;
    expect(t.schemaUrl).toBe("https://example.org/schema.sql");
    expect(t.loadScriptUrl).toBeNull();
  });
  it("has no populated share for a table loaded with no rows", () => {
    const t = parseSchemaTable(
      "audio_audio",
      {
        ...PROFILE,
        load_profile: {
          columns: [{ name: "id", populated: 0, populated_pct: null, type: "VARCHAR" }],
          rows: 0,
        },
      },
      LINKS,
    )!;
    expect(t.columns[0]!.loadedHere).toBe(true);
    expect(t.columns[0]!.populatedPct).toBeNull();
  });
  it("rejects a table record that names another table or has no columns", () => {
    expect(parseSchemaTable("people_db_attorney", PROFILE, LINKS)).toBeNull();
    expect(parseSchemaTable("audio_audio", { ...PROFILE, columns: [] }, LINKS)).toBeNull();
    expect(parseSchemaTable("Audio", PROFILE, LINKS)).toBeNull();
  });
});

describe("server reads", () => {
  it("reads the docket overview from the two overview records and caches the result", async () => {
    mocked.mockResolvedValue({
      rows: [
        { id: "overview:all", p: OVERVIEW },
        { id: "casetype:all", p: CASETYPE },
      ],
      total: null,
    });
    const first = await (
      getClbDocketOverview as unknown as () => Promise<{ dockets: number } | null>
    )();
    expect(first?.dockets).toBe(72998758);
    expect(mocked).toHaveBeenCalledTimes(1);
    const path = mocked.mock.calls[0]![0] as string;
    expect(path).toContain("dataset=eq.clb_docket_master");
    expect(path).toContain("id=in.(overview:all,casetype:all)");
  });
  it("reads a 1,500-row listing in two ranged pages and parses every row", async () => {
    const edge = (i: number) => ({
      id: `cite:a${i}>b${i}`,
      p: {
        cited_court: `b${i}`,
        citing_court: `a${i}`,
        count: 3000 + i,
        share_of_cited_pct: 1,
        share_of_citing_pct: 1,
      },
      from: `Court A${i}`,
      to: `Court B${i}`,
      fl: "State appellate",
      tl: "State supreme",
      l0: `/courts/a${i}`,
      l1: `/courts/b${i}`,
    });
    mocked
      .mockResolvedValueOnce({ rows: Array.from({ length: 1000 }, (_, i) => edge(i)), total: 1500 })
      .mockResolvedValueOnce({
        rows: Array.from({ length: 500 }, (_, i) => edge(i + 1000)),
        total: null,
      });
    const listed = await (
      getClbCiteEdges as unknown as () => Promise<{
        rows: unknown[];
        total: number;
        dropped: number;
      }>
    )();
    expect(listed.rows).toHaveLength(1500);
    expect(listed.total).toBe(1500);
    expect(listed.dropped).toBe(0);
    expect(mocked.mock.calls.map((c) => (c[1] as { range: number[] }).range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
});
