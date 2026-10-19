import { describe, expect, it } from "vitest";
import type {
  AppealEdge,
  CiteEdge,
  CitingCourt,
  DocketCause,
  DocketNos,
  DocketState,
  SchemaTableRow,
  TopCited,
} from "@/lib/external/clbCollection.functions";
import {
  APPEAL_DEFAULT_SORT,
  CAUSE_DEFAULT_SORT,
  CITE_DEFAULT_SORT,
  CITING_DEFAULT_SORT,
  disclosureCourtRows,
  DISC_DEFAULT_SORT,
  filterAppealEdges,
  filterCauses,
  filterCiteEdges,
  filterCiting,
  filterDisclosureCourts,
  filterNos,
  filterSchemaTables,
  filterStates,
  filterTopCited,
  nosRows,
  parseSort,
  sortAppealEdges,
  sortCauses,
  sortCiteEdges,
  sortCiting,
  sortDisclosureCourts,
  sortNos,
  sortSchemaTables,
  sortStates,
  sortTopCited,
  STATE_DEFAULT_SORT,
  STATE_SORT_KEYS,
  stateRows,
  topCitedCourtOptions,
  topCitedDecades,
  TOP_DEFAULT_SORT,
} from "./collectionTables";

const state = (code: string, dockets: number, over: Partial<DocketState> = {}): DocketState => ({
  code,
  courts: 5,
  dockets,
  civil: 10,
  recap: dockets / 2,
  clusters: 1,
  federal: dockets - 10,
  stateCourts: 10,
  other: 0,
  topCourts: [],
  ...over,
});

describe("state table", () => {
  const rows = stateRows(
    [
      state("CA", 6500483),
      state("PR", 604030, { federal: 545124, stateCourts: 0, other: 58906 }),
      state("TX", 6500483),
    ],
    72998758,
  );
  it("names each place, ranks competitively, and shares over all dockets", () => {
    expect(rows.map((r) => r.name)).toEqual(["California", "Puerto Rico", "Texas"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 3, 1]);
    expect(rows[0]!.sharePct).toBeCloseTo(8.9, 1);
    expect(rows[1]!.federalPct).toBeCloseTo(90.25, 1);
    expect(rows[1]!.recapPct).toBe(50);
  });
  it("has no share when the collection total is unknown", () => {
    expect(stateRows([state("CA", 10)], null)[0]!.sharePct).toBeNull();
  });
  it("searches the name and the code by word start", () => {
    expect(filterStates(rows, { q: "puer" }).map((r) => r.code)).toEqual(["PR"]);
    expect(filterStates(rows, { q: "tx" }).map((r) => r.code)).toEqual(["TX"]);
    expect(filterStates(rows, { q: "xyz" })).toEqual([]);
    expect(filterStates(rows, {})).toHaveLength(3);
  });
  it("sorts descending by dockets with ties by name, and ascending by name", () => {
    expect(sortStates(rows, STATE_DEFAULT_SORT).map((r) => r.code)).toEqual(["CA", "TX", "PR"]);
    expect(sortStates(rows, { key: "name", desc: false }).map((r) => r.code)).toEqual([
      "CA",
      "PR",
      "TX",
    ]);
  });
  it("sorts a missing value last in either direction", () => {
    const withGap = stateRows(
      [state("AA", 5, { civil: null }), state("BB", 6, { civil: 3 }), state("CC", 7, { civil: 9 })],
      100,
    );
    expect(sortStates(withGap, { key: "civil", desc: true }).map((r) => r.code)).toEqual([
      "CC",
      "BB",
      "AA",
    ]);
    expect(sortStates(withGap, { key: "civil", desc: false }).map((r) => r.code)).toEqual([
      "BB",
      "CC",
      "AA",
    ]);
  });
  it("falls back to the default sort for a key it does not know", () => {
    expect(parseSort("bogus", STATE_SORT_KEYS, STATE_DEFAULT_SORT)).toEqual(STATE_DEFAULT_SORT);
    expect(parseSort("-courts", STATE_SORT_KEYS, STATE_DEFAULT_SORT)).toEqual({
      key: "courts",
      desc: true,
    });
  });
});

describe("nature-of-suit table", () => {
  const nos = (code: number, dockets: number, group: string | null): DocketNos => ({
    id: `nos:${code}`,
    code,
    name: `${code} Some suit`,
    dockets,
    dated: dockets,
    terminated: dockets / 2,
    terminatedPct: 50,
    group,
    groupLabel: group ? `Group ${group}` : null,
    fjcHref: null,
  });
  const rows = nosRows(
    [nos(365, 713032, "product"), nos(190, 200000, "contract"), nos(999, 5, null)],
    8956707,
  );
  it("shares each code over the dockets with a numeric code", () => {
    expect(rows[0]!.sharePct).toBeCloseTo(7.96, 2);
    expect(nosRows([nos(365, 1, "product")], null)[0]!.sharePct).toBeNull();
  });
  it("filters by group and by word in the code, name or group", () => {
    expect(filterNos(rows, { group: "contract" }).map((r) => r.code)).toEqual([190]);
    expect(filterNos(rows, { q: "365" }).map((r) => r.code)).toEqual([365]);
    expect(filterNos(rows, { q: "group contract" }).map((r) => r.code)).toEqual([190]);
    expect(filterNos(rows, { group: "contract", q: "365" })).toEqual([]);
  });
  it("sorts by code, and puts a code without a group last", () => {
    expect(sortNos(rows, { key: "code", desc: false }).map((r) => r.code)).toEqual([190, 365, 999]);
    expect(sortNos(rows, { key: "group", desc: false }).map((r) => r.code)).toEqual([
      190, 365, 999,
    ]);
    expect(sortNos(rows, { key: "group", desc: true }).map((r) => r.code)).toEqual([365, 190, 999]);
  });
});

describe("cause table", () => {
  const cause = (rank: number, name: string, dockets: number): DocketCause => ({
    id: `cause:${String(rank).padStart(3, "0")}`,
    rank,
    cause: name,
    dockets,
    topCourts: [],
  });
  const rows = [
    cause(1, "42:1983 Prisoner Civil Rights", 294977),
    cause(2, "28:2254 Petition for Writ of Habeas Corpus (State)", 173972),
    cause(3, "42:1983 Civil Rights Act", 153212),
  ];
  it("searches the exact cause text and keeps near-duplicates separate", () => {
    expect(filterCauses(rows, { q: "1983" }).map((r) => r.rank)).toEqual([1, 3]);
    expect(filterCauses(rows, { q: "habeas" }).map((r) => r.rank)).toEqual([2]);
    expect(filterCauses(rows, { q: "nothing here" })).toEqual([]);
  });
  it("is ordered by rank unless sorted otherwise", () => {
    expect(sortCauses(rows, CAUSE_DEFAULT_SORT).map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(sortCauses(rows, { key: "cause", desc: false }).map((r) => r.rank)).toEqual([2, 3, 1]);
  });
});

describe("citing-court and edge tables", () => {
  const citing = (
    id: string,
    name: string,
    level: string,
    total: number,
    extra: Partial<CitingCourt> = {},
  ): CitingCourt => ({
    id,
    name,
    level,
    total,
    selfPct: 40,
    scotusPct: 20,
    federal: Math.round(total * 0.9),
    state: Math.round(total * 0.1),
    other: 0,
    federalPct: 90,
    statePct: 10,
    otherPct: 0,
    lag: { median: 8, mean: 13, p90: 31, n: total },
    href: `/courts/${id}`,
    ...extra,
  });
  const courts = [
    citing("ca9", "Court of Appeals for the Ninth Circuit", "Federal appellate", 1987369),
    citing("nysd", "District Court, S.D. New York", "Federal district", 700000, { lag: null }),
    citing("cal", "California Supreme Court", "State supreme", 700000, { href: null }),
  ];
  it("filters by level and by word", () => {
    expect(filterCiting(courts, { level: "Federal district" }).map((c) => c.id)).toEqual(["nysd"]);
    expect(filterCiting(courts, { q: "ninth" }).map((c) => c.id)).toEqual(["ca9"]);
    expect(filterCiting(courts, { q: "s.d. new" }).map((c) => c.id)).toEqual(["nysd"]);
    expect(filterCiting(courts, { q: "ninth", level: "State supreme" })).toEqual([]);
  });
  it("sorts by total with ties by name, and a court without an age sorts last", () => {
    expect(sortCiting(courts, CITING_DEFAULT_SORT).map((c) => c.id)).toEqual([
      "ca9",
      "cal",
      "nysd",
    ]);
    expect(sortCiting(courts, { key: "lagMedian", desc: true }).map((c) => c.id)).toEqual([
      "cal",
      "ca9",
      "nysd",
    ]);
    expect(sortCiting(courts, { key: "lagMedian", desc: false }).at(-1)!.id).toBe("nysd");
  });

  const cite = (from: string, to: string, links: number, fl: string, tl: string): CiteEdge => ({
    id: `cite:${from}>${to}`,
    citing: { id: from, name: `Court ${from}`, level: fl, href: null },
    cited: { id: to, name: `Court ${to}`, level: tl, href: null },
    links,
    shareOfCitingPct: 10,
    shareOfCitedPct: links === 5 ? null : 20,
  });
  const edges = [
    cite("a", "b", 100, "State appellate", "State supreme"),
    cite("c", "d", 300, "Federal district", "Federal appellate"),
    cite("e", "f", 5, "Federal district", "State supreme"),
  ];
  it("filters edges by each side's level and by either court's name", () => {
    expect(filterCiteEdges(edges, { level: "Federal district" }).map((e) => e.id)).toEqual([
      "cite:c>d",
      "cite:e>f",
    ]);
    expect(
      filterCiteEdges(edges, { level: "Federal district", to: "State supreme" }).map((e) => e.id),
    ).toEqual(["cite:e>f"]);
    expect(filterCiteEdges(edges, { q: "court d" }).map((e) => e.id)).toEqual(["cite:c>d"]);
    expect(filterCiteEdges(edges, { q: "zzz" })).toEqual([]);
  });
  it("sorts edges by links descending, and by citing name; a missing share sorts last", () => {
    expect(sortCiteEdges(edges, CITE_DEFAULT_SORT).map((e) => e.links)).toEqual([300, 100, 5]);
    expect(sortCiteEdges(edges, { key: "citing", desc: false }).map((e) => e.citing.id)).toEqual([
      "a",
      "c",
      "e",
    ]);
    expect(sortCiteEdges(edges, { key: "shareOfCitedPct", desc: true }).at(-1)!.links).toBe(5);
  });

  const appeal = (from: string, to: string, dockets: number, fl: string): AppealEdge => ({
    id: `appeal:${from}>${to}`,
    from: { id: from, name: `Court ${from}`, level: fl, href: null },
    to: { id: to, name: `Court ${to}`, level: "State supreme", href: null },
    dockets,
    sharePct: 11.2,
  });
  const appeals = [appeal("x", "y", 25, "State appellate"), appeal("z", "y", 27024, "State trial")];
  it("filters and sorts appeal flows from the appealed-from court to the receiving court", () => {
    expect(filterAppealEdges(appeals, { level: "State trial" }).map((e) => e.from.id)).toEqual([
      "z",
    ]);
    expect(
      filterAppealEdges(appeals, { to: "State supreme", q: "court x" }).map((e) => e.from.id),
    ).toEqual(["x"]);
    expect(sortAppealEdges(appeals, APPEAL_DEFAULT_SORT).map((e) => e.dockets)).toEqual([
      27024, 25,
    ]);
  });
});

describe("most-cited table", () => {
  const top = (
    rank: number,
    name: string,
    courtId: string,
    year: number,
    cited: number,
    citation: string | null,
  ): TopCited => ({
    clusterId: 1000 + rank,
    rank,
    caseName: name,
    courtId,
    court:
      courtId === "scotus"
        ? "Supreme Court of the United States"
        : "Court of Appeals for the Ninth Circuit",
    year,
    dateFiled: null,
    citation,
    timesCited: cited,
    mapLinks: cited - 5,
    knownCitingCourt: null,
    linksCitingFiledBeforeCited: null,
    mapToCountRatio: null,
    lowMapRatio: false,
    twinRanks: [],
    federalPct: 99,
    statePct: rank === 2 ? null : 1,
    otherPct: 0,
    parentheticals: null,
    url: null,
    courtHref: null,
  });
  const rows = [
    top(1, "Ashcroft v. Iqbal", "scotus", 2009, 159280, "173 L. Ed. 2d 868"),
    top(
      2,
      "Bell Atlantic Corp. v. Twombly",
      "scotus",
      2007,
      155999,
      "20 Fla. L. Weekly Fed. S 267",
    ),
    top(3, "Smith v. Jones", "ca9", 1985, 5000, null),
  ];
  it("searches the case name and the citation, by court and by decade", () => {
    expect(filterTopCited(rows, { q: "twombly" }).map((r) => r.rank)).toEqual([2]);
    expect(filterTopCited(rows, { q: "173 L. Ed." }).map((r) => r.rank)).toEqual([1]);
    expect(filterTopCited(rows, { court: "ca9" }).map((r) => r.rank)).toEqual([3]);
    expect(filterTopCited(rows, { decade: 2000 }).map((r) => r.rank)).toEqual([1, 2]);
    expect(filterTopCited(rows, { decade: 1980 }).map((r) => r.rank)).toEqual([3]);
    expect(filterTopCited(rows, { decade: 1990 })).toEqual([]);
    expect(filterTopCited(rows, { court: "scotus", decade: 1980 })).toEqual([]);
  });
  it("lists the courts and decades that actually hold a row", () => {
    expect(topCitedCourtOptions(rows)).toEqual([
      { id: "scotus", label: "Supreme Court of the United States", count: 2 },
      { id: "ca9", label: "Court of Appeals for the Ninth Circuit", count: 1 },
    ]);
    expect(topCitedDecades(rows)).toEqual([1980, 2000]);
  });
  it("is ordered by rank, and sorts a missing share last", () => {
    expect(sortTopCited(rows, TOP_DEFAULT_SORT).map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(sortTopCited(rows, { key: "year", desc: false }).map((r) => r.rank)).toEqual([3, 2, 1]);
    expect(sortTopCited(rows, { key: "statePct", desc: true }).map((r) => r.rank)).toEqual([
      1, 3, 2,
    ]);
    expect(sortTopCited(rows, { key: "statePct", desc: false }).at(-1)!.rank).toBe(2);
  });
});

describe("disclosure courts", () => {
  const court = (
    id: string,
    level: string,
    people: number,
    withReport: number,
    first: number | null,
  ) => ({
    id,
    name: `Court ${id}`,
    level,
    people,
    withReport,
    reports: withReport * 7,
    firstYear: first,
    lastYear: first,
    href: null,
  });
  const rows = disclosureCourtRows([
    court("a", "State trial", 1046, 17, 1997),
    court("b", "Federal district", 40, 40, null),
    court("c", "Federal district", 5, 0, 2003),
  ]);
  it("gives each court its coverage as people with a report over people on record", () => {
    expect(rows.map((r) => r.coveragePct)).toEqual([expect.closeTo(1.63, 1), 100, 0]);
  });
  it("filters by level and name and sorts people descending by default", () => {
    expect(filterDisclosureCourts(rows, { level: "Federal district" }).map((r) => r.id)).toEqual([
      "b",
      "c",
    ]);
    expect(filterDisclosureCourts(rows, { q: "court a" }).map((r) => r.id)).toEqual(["a"]);
    expect(sortDisclosureCourts(rows, DISC_DEFAULT_SORT).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("sorts a court with no filing years last in either direction", () => {
    expect(sortDisclosureCourts(rows, { key: "firstYear", desc: false }).map((r) => r.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(sortDisclosureCourts(rows, { key: "firstYear", desc: true }).map((r) => r.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(sortDisclosureCourts(rows, { key: "coveragePct", desc: true }).map((r) => r.id)).toEqual(
      ["b", "a", "c"],
    );
  });
});

describe("schema tables", () => {
  const table = (
    t: string,
    group: string,
    bulk: boolean,
    load: SchemaTableRow["load"],
    rows: number | null,
    mb: number | null,
  ): SchemaTableRow => ({
    table: t,
    label: `Label of ${t}`,
    group,
    bulk,
    load,
    loadLabel: load,
    columns: 8,
    foreignKeys: 0,
    referencedBy: 0,
    rowsLoaded: rows,
    compressedMb: mb,
  });
  const rows = [
    table("people_db_attorney", "people_db", false, "none", null, null),
    table("search_citation", "search", true, "selected", 18130235, 127.5),
    table("disclosures_gift", "disclosures", true, "not_loaded", null, 0.1),
    table("people_db_school", "people_db", true, "all", 6011, 0.1),
  ];
  it("filters by group, bulk flag, load status and word", () => {
    expect(filterSchemaTables(rows, { bulk: "no" }).map((t) => t.table)).toEqual([
      "people_db_attorney",
    ]);
    expect(filterSchemaTables(rows, { bulk: "yes" })).toHaveLength(3);
    expect(
      filterSchemaTables(rows, { group: "people_db", bulk: "yes" }).map((t) => t.table),
    ).toEqual(["people_db_school"]);
    expect(filterSchemaTables(rows, { loaded: "not_loaded" }).map((t) => t.table)).toEqual([
      "disclosures_gift",
    ]);
    expect(filterSchemaTables(rows, { q: "attorney" }).map((t) => t.table)).toEqual([
      "people_db_attorney",
    ]);
    expect(filterSchemaTables(rows, { q: "attorney", bulk: "yes" })).toEqual([]);
  });
  it("sorts rows loaded with an unloaded table last, and load status in order of how much is loaded", () => {
    expect(sortSchemaTables(rows, { key: "rowsLoaded", desc: true }).map((t) => t.table)).toEqual([
      "search_citation",
      "people_db_school",
      "disclosures_gift",
      "people_db_attorney",
    ]);
    expect(sortSchemaTables(rows, { key: "load", desc: false }).map((t) => t.table)).toEqual([
      "people_db_attorney",
      "disclosures_gift",
      "search_citation",
      "people_db_school",
    ]);
    expect(sortSchemaTables(rows, { key: "table", desc: false })[0]!.table).toBe(
      "disclosures_gift",
    );
  });
});
