import { describe, expect, it } from "vitest";
import type {
  CitationMatrix,
  DisclosureData,
  DocketLevel,
  DocketNosList,
  DocketOverview,
  DocketState,
  DocketYear,
  FlowsMap,
  ScotusCiters,
  SchemaTableRow,
  TopCited,
} from "@/lib/external/clbCollection.functions";
import {
  citationTakeaways,
  citedTakeaways,
  diagonalShare,
  disclosureTakeaways,
  docketTakeaways,
  schemaTakeaways,
  topScotusCiter,
} from "./collectionTakeaways";

const overview: DocketOverview = {
  dockets: 72998758,
  courtsWithDockets: 2204,
  clusters: 10174551,
  withFilingDate: 63841109,
  noFilingDate: 9157604,
  implausibleDates: 45,
  firstFiled: "1871-10-12",
  lastFiled: "2026-09-30",
  recap: 61272199,
  assignedJudge: 32552940,
  natureOfSuit: 10674611,
  fjcRecord: 8408620,
  sources: [],
  caseTypes: [],
  withCaseType: null,
  withoutCaseType: null,
};
const year = (y: number, dockets: number, over: Partial<DocketYear> = {}): DocketYear => ({
  year: y,
  partial: false,
  dockets,
  civil: null,
  criminal: null,
  other: null,
  recap: null,
  terminated: null,
  clusters: null,
  citedClusters: null,
  federal: null,
  state: null,
  otherGroup: null,
  yoyPct: null,
  ...over,
});
const level = (code: string, dockets: number, family: DocketLevel["family"]): DocketLevel => ({
  id: `level:${code}`,
  code,
  label: code,
  family,
  courts: 1,
  dockets,
  recap: null,
  terminated: null,
  clusters: null,
  topCourts: [],
});
const st = (code: string, dockets: number): DocketState => ({
  code,
  courts: 1,
  dockets,
  civil: null,
  recap: null,
  clusters: null,
  federal: null,
  stateCourts: null,
  other: null,
  topCourts: [],
});
const nosList: DocketNosList = {
  nos: { rows: [], total: 0, dropped: 0 },
  groups: {
    rows: [
      {
        id: "group:product",
        key: "product",
        label: "Product liability",
        dockets: 1305541,
        fjcHref: null,
      },
      { id: "group:tax", key: "tax", label: "Tax suits", dockets: 52738, fjcHref: null },
    ],
    total: 2,
    dropped: 0,
  },
  numericCodeDockets: 8956707,
};

describe("docket takeaways", () => {
  const input = {
    overview,
    years: [
      year(2005, 2562269),
      year(2024, 1228927),
      year(2025, 1398348, { yoyPct: 13.8 }),
      year(2026, 1136265, { partial: true }),
    ],
    levels: [
      level("FB", 37024068, "federal"),
      level("FD", 24041875, "federal"),
      level("SA", 4741249, "state"),
      level("S", 2881096, "state"),
    ],
    states: [st("TX", 6198167), st("CA", 6500483)],
    nos: nosList,
    snapshot: "2026-09-30",
  };
  it("states the totals with their denominators and never compares the partial year", () => {
    const t = docketTakeaways(input);
    const byId = new Map(t.map((x) => [x.id, x]));
    expect(byId.get("size")!.figure).toBe("73M");
    expect(byId.get("size")!.text).toContain("not a count of court filings");
    expect(byId.get("bankruptcy")!.figure).toBe("50.7%");
    const latest = byId.get("latest-year")!;
    expect(latest.text).toContain("2025, the latest complete year");
    expect(latest.text).toContain("+13.8% on 2024");
    expect(latest.text).toContain(
      "2026 is a partial year, through Sep 30, 2026 and is not compared",
    );
    expect(byId.get("nos-group")!.figure).toBe("14.6%");
    expect(byId.get("nos-group")!.text).toContain("dockets with a numeric nature-of-suit code");
    expect(t.length).toBeLessThanOrEqual(5);
  });
  it("names the busiest complete year when the court-level takeaways are not available", () => {
    const t = docketTakeaways({ ...input, levels: [], nos: null });
    const peak = t.find((x) => x.id === "peak-year")!;
    expect(peak.figure).toBe("2005");
    expect(peak.text).toContain("reflects what CourtListener collected");
  });
  it("never offers a partial year as the latest or the peak", () => {
    const t = docketTakeaways({ ...input, years: [year(2026, 9e9, { partial: true })] });
    expect(t.some((x) => x.id === "latest-year" || x.id === "peak-year")).toBe(false);
  });
  it("shows nothing when fewer than two takeaways can be computed", () => {
    expect(
      docketTakeaways({
        overview: null,
        years: [],
        levels: [],
        states: [],
        nos: null,
        snapshot: null,
      }),
    ).toEqual([]);
    expect(
      docketTakeaways({ overview, years: [], levels: [], states: [], nos: null, snapshot: null }),
    ).toEqual([]);
  });
});

const matrix: CitationMatrix = {
  rows: [
    { key: "ca1", label: "First", total: null },
    { key: "ca2", label: "Second", total: null },
  ],
  columns: [
    { key: "ca1", label: "First" },
    { key: "ca2", label: "Second" },
    { key: "scotus", label: "Supreme Court" },
  ],
  cells: [
    [60, 20, 20],
    [10, 70, 20],
  ],
  meta: null,
};

describe("citation takeaways", () => {
  it("measures the diagonal of a matrix, and gives nothing when a cell is missing", () => {
    expect(diagonalShare(matrix)).toBeCloseTo(65, 5);
    expect(diagonalShare(null)).toBeNull();
    const gap: CitationMatrix = {
      ...matrix,
      cells: [
        [60, null, 20],
        [10, 70, 20],
      ],
    };
    expect(diagonalShare(gap)).toBeNull();
  });
  const citers: ScotusCiters = {
    total: 11963885,
    citers: [
      {
        courtId: "scotus",
        name: "Supreme Court of the United States",
        count: 534711,
        sharePct: 4.5,
        href: null,
      },
      {
        courtId: "ca9",
        name: "Court of Appeals for the Ninth Circuit",
        count: 514143,
        sharePct: 4.3,
        href: null,
      },
    ],
  };
  it("leaves the Supreme Court's own citations out of the top citer", () => {
    expect(topScotusCiter(citers)!.courtId).toBe("ca9");
    expect(topScotusCiter(null)).toBeNull();
  });
  const map: FlowsMap = {
    overview: {
      mapLinks: 78404647,
      resolved: 78193408,
      sameCourt: 29080157,
      unresolved: 178,
      notInOpinionTable: 19298,
      sameDecisionLinks: 191763,
      excluded: 211239,
      citingFiledBeforeCited: 162099,
      undatedLinks: 190,
      appealDockets: 852353,
      crossPairsAtLeast100: 18395,
      crossEdgesPublished: 1500,
      crossEdgeFloor: 2778,
      crossPairsNotPublished: 16895,
      crossLinksNotPublished: 8301387,
      reconciles: true,
    },
    circuits: matrix,
    levels: null,
    scotus: citers,
  };
  it("says what the map is, what it leaves out, and what each share is of", () => {
    const t = citationTakeaways(map);
    const byId = new Map(t.map((x) => [x.id, x]));
    expect(byId.get("resolved")!.text).toContain("extraction from opinion text, not a census");
    expect(byId.get("resolved")!.text).toContain("37.2% stay within one court");
    expect(byId.get("excluded")!.figure).toBe("211,239");
    expect(byId.get("excluded")!.text).toContain("0.27%");
    expect(byId.get("excluded")!.text).toContain("same decision");
    // The unpublished tail is named, so the page never reads as if every pair were listed.
    expect(byId.get("tail")!.figure).toBe("8.3M");
    expect(byId.get("tail")!.text).toContain("16,895 smaller court pairs that are not published");
    expect(byId.get("tail")!.text).toContain("1,500 largest pairs");
    expect(byId.get("self")!.figure).toBe("65.0%");
    expect(byId.get("top-citer")!.text).toContain("Ninth Circuit");
  });
  it("does not name an unpublished tail the overview does not state", () => {
    const t = citationTakeaways({
      ...map,
      overview: { ...map.overview, crossPairsNotPublished: null, crossLinksNotPublished: null },
    });
    expect(t.some((x) => x.id === "tail")).toBe(false);
  });
  it("is empty without the map", () => {
    expect(citationTakeaways(null)).toEqual([]);
  });
});

const top = (rank: number, courtId: string, year: number, cited: number): TopCited => ({
  clusterId: rank,
  rank,
  caseName: `Case ${rank}`,
  courtId,
  court: courtId,
  year,
  dateFiled: null,
  citation: null,
  timesCited: cited,
  mapLinks: cited,
  knownCitingCourt: null,
  linksCitingFiledBeforeCited: null,
  mapToCountRatio: null,
  lowMapRatio: false,
  twinRanks: [],
  federalPct: null,
  statePct: null,
  otherPct: null,
  parentheticals: null,
  url: null,
  courtHref: null,
});

describe("most-cited takeaways", () => {
  it("names the top case, the Supreme Court share and the busiest decade of decision", () => {
    const t = citedTakeaways([
      top(1, "scotus", 2009, 159280),
      top(2, "scotus", 2007, 155999),
      top(3, "ca9", 1985, 5000),
      top(4, "ca9", 1986, 4000),
    ]);
    const byId = new Map(t.map((x) => [x.id, x]));
    expect(byId.get("top")!.figure).toBe("159,280");
    expect(byId.get("top")!.text).toContain("citation_count");
    expect(byId.get("scotus")!.figure).toBe("50%");
    expect(byId.get("decade")!.figure).toBe("1980s");
  });
  it("counts the clusters that carry a flag, and says what each flag means", () => {
    const t = citedTakeaways([
      top(1, "scotus", 2009, 159280),
      { ...top(2, "scotus", 1963, 8445), twinRanks: [3] },
      { ...top(3, "scotus", 1963, 7000), twinRanks: [2] },
      { ...top(4, "co", 2012, 6061), lowMapRatio: true, mapToCountRatio: 0.084 },
    ]);
    const flags = t.find((x) => x.id === "flags")!;
    expect(flags.figure).toBe("3");
    expect(flags.text).toContain("2 share a reporter citation with another listed cluster");
    expect(flags.text).toContain("1 have under half as many map links as times cited");
    expect(
      citedTakeaways([top(1, "scotus", 2009, 5), top(2, "scotus", 2007, 4)]).some(
        (x) => x.id === "flags",
      ),
    ).toBe(false);
  });
  it("is empty without rows", () => {
    expect(citedTakeaways([])).toEqual([]);
  });
});

describe("disclosure takeaways", () => {
  const data: DisclosureData = {
    overview: {
      reports: 32336,
      people: 3392,
      firstYear: 1987,
      lastYear: 2022,
      judicialPeople: 15378,
      judicialWithReport: 3387,
      sections: [
        { section: "investments", items: 1901720 },
        { section: "gifts", items: 2025 },
      ],
      reportsPerPerson: [],
    },
    years: {
      rows: [
        {
          year: 1987,
          reports: 5,
          people: 5,
          amended: 0,
          extracted: 0,
          medianPages: 5,
          lineItems: 0,
        },
        {
          year: 2011,
          reports: 2515,
          people: 2366,
          amended: 1,
          extracted: 1,
          medianPages: 8,
          lineItems: 1,
        },
        {
          year: 2022,
          reports: 12,
          people: 12,
          amended: 0,
          extracted: 0,
          medianPages: 6,
          lineItems: 0,
        },
      ],
      total: 3,
      dropped: 0,
    },
    courts: {
      rows: [
        {
          id: "a",
          name: "A",
          level: null,
          people: 100,
          withReport: 0,
          reports: 0,
          firstYear: null,
          lastYear: null,
          href: null,
        },
        {
          id: "b",
          name: "B",
          level: null,
          people: 100,
          withReport: 50,
          reports: 5,
          firstYear: 2000,
          lastYear: 2010,
          href: null,
        },
        {
          id: "c",
          name: "C",
          level: null,
          people: 100,
          withReport: 100,
          reports: 5,
          firstYear: 2000,
          lastYear: 2010,
          href: null,
        },
      ],
      total: 3,
      dropped: 0,
    },
  };
  it("states coverage as a share of people on record and calls thin years thin coverage", () => {
    const byId = new Map(disclosureTakeaways(data).map((x) => [x.id, x]));
    expect(byId.get("people")!.figure).toBe("22.0%");
    expect(byId.get("people")!.text).toContain("not whether a judge had to file");
    expect(byId.get("busiest")!.figure).toBe("2011");
    expect(byId.get("busiest")!.text).toContain("1987, 2022");
    expect(byId.get("busiest")!.text).toContain("thin coverage");
    expect(byId.get("median-court")!.figure).toBe("50.0%");
    expect(byId.get("median-court")!.text).toContain("1 of them have no report");
    expect(byId.get("items")!.text).toContain("counts of rows");
  });
  it("is empty without data", () => {
    expect(disclosureTakeaways(null)).toEqual([]);
  });
});

describe("schema takeaways", () => {
  const table = (
    t: string,
    bulk: boolean,
    load: SchemaTableRow["load"],
    rows: number | null,
  ): SchemaTableRow => ({
    table: t,
    label: t,
    group: "g",
    bulk,
    load,
    loadLabel: load,
    columns: 1,
    foreignKeys: 0,
    referencedBy: 0,
    rowsLoaded: rows,
    compressedMb: null,
  });
  const tables = [
    table("people_db_attorney", false, "none", null),
    table("search_opinionscited", true, "selected", 78404647),
    table("disclosures_gift", true, "not_loaded", null),
  ];
  it("counts what has a bulk file and names the attorney and firm gap without implying any statistics", () => {
    const t = schemaTakeaways(tables, ["people_db_attorney", "people_db_party"]);
    const byId = new Map(t.map((x) => [x.id, x]));
    expect(byId.get("bulk")!.figure).toBe("2 of 3");
    expect(byId.get("not-in-bulk")!.figure).toBe("2 tables");
    expect(byId.get("not-in-bulk")!.text).toContain("no attorney or firm statistics");
    expect(byId.get("loaded")!.figure).toBe("1");
    expect(byId.get("largest")!.figure).toBe("78.4M");
  });
  it("omits the missing-table line when none are named", () => {
    expect(schemaTakeaways(tables, []).some((x) => x.id === "not-in-bulk")).toBe(false);
    expect(schemaTakeaways([], ["x"])).toEqual([]);
  });
});
