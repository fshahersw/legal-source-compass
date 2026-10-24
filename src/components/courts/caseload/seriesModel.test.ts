import { describe, expect, it } from "vitest";
import {
  breakAnnotations,
  buildAxis,
  cardFromCatalog,
  compareTables,
  defaultPub,
  formatterFor,
  matchesQuery,
  parseCoverageSummary,
  parseHeld,
  parseLatest,
  parsePublicationCoverage,
  parseSeriesCard,
  parseSeriesDetail,
  periodIndices,
  periodText,
  pubCounts,
  quarterEnds,
  rankingItems,
  sameQuarterYearEarlier,
  seriesPoints,
  shortName,
  spliceColumns,
} from "./seriesModel";

const periods = [
  { end: "2023-09-30", months: 12, pub: "JB" },
  { end: "2023-12-31", months: 12, pub: "STFJ" },
  { end: "2024-03-31", months: 12, pub: "FJCS" },
  { end: "2024-09-30", months: 12, pub: "JB" },
  { end: "2025-09-30", months: 12, pub: "JB" },
];

describe("series index records", () => {
  it("reads a series card and refuses unknown datasets and malformed ids", () => {
    const card = parseSeriesCard({
      cells: { first: "1997-09-30", last: "2025-09-30", periods: 40 },
      tk: "c",
      table: "C",
      title: "Civil Cases Commenced",
      scope: "district",
      geo: "U.S. district courts",
      fam: "tables",
      pubs: ["JB", "STFJ", 3],
      nat: { dataset: "uscourts_tables_national", id: "c" },
      cds: "uscourts_tables_district",
      ccount: 94,
      latest: { dataset: "some_other_dataset", id: "latest:c" },
      rstatus: "reconciled",
      held: [{}, {}],
      page: "javascript:alert(1)",
    });
    expect(card).toMatchObject({
      tableKey: "c",
      scope: "district",
      pubs: ["JB", "STFJ"],
      courtCount: 94,
      held: 2,
    });
    expect(card?.latest).toBeNull();
    expect(card?.page).toBeNull();
    expect(
      parseSeriesCard({ tk: "C D", table: "C", title: "x", scope: "district", cells: {} }),
    ).toBeNull();
  });

  it("builds a card from the national catalog when the index is not published", () => {
    const card = cardFromCatalog({
      tableKey: "f-2",
      table: "F-2",
      title: "Bankruptcy",
      scopes: ["bankruptcy"],
      firstEnd: "1997-09-30",
      lastEnd: "2026-09-30",
      periods: 106,
      pubs: ["BF", "JB"],
    });
    expect(card.courtsDataset).toBe("uscourts_tables_bankruptcy");
    expect(card.latest).toEqual({ dataset: "uscourts_tables_bankruptcy", id: "latest:f-2" });
    const cat = cardFromCatalog({
      tableKey: "c-2",
      table: "C-2",
      title: "By nature of suit",
      scopes: [],
      firstEnd: "2017-09-30",
      lastEnd: "2025-09-30",
      periods: 9,
      pubs: ["JB"],
    });
    expect(cat.scope).toBe("category");
    expect(cat.latest).toBeNull();
  });

  it("parses a series detail with its held periods and coverage", () => {
    const d = parseSeriesDetail({
      v: 1,
      tableKey: "m-4b",
      table: "M-4B",
      title: "Magistrate judges",
      scope: "district",
      periods: [
        { end: "2021-09-30", months: 12, pub: "JB" },
        { end: "bad", pub: "JB" },
      ],
      cols: [
        { k: "total", label: "Total", unit: "count", dec: 0 },
        { k: "total", label: "dup" },
        { k: "x", label: "X", unit: "weird" },
      ],
      courts: { dataset: "uscourts_tables_district", ids: ["azd", "BAD ID"], count: 94 },
      rec: {
        status: "held_periods",
        tests: 10,
        passed: 9,
        held: [
          {
            end: "2022-09-30",
            pub: "JB",
            tableNumber: "M-4B",
            failureCount: 3,
            failures: [
              { kind: "coltotal", entity: "national", col: "total", printed: 42016, sum: 42017 },
            ],
          },
        ],
      },
      coverage: { listed: 9, published: 8, note: "x" },
    });
    expect(d?.periods).toHaveLength(1);
    expect(d?.cols.map((c) => [c.k, c.unit])).toEqual([
      ["total", "count"],
      ["x", "number"],
    ]);
    expect(d?.courts?.ids).toEqual(["azd"]);
    expect(d?.rec?.held[0]).toMatchObject({ end: "2022-09-30", failureCount: 3 });
    expect(d?.coverage).toEqual({ listed: 9, published: 8 });
  });

  it("parses the latest-period record, coverage and held lists", () => {
    const l = parseLatest({
      kind: "latest",
      table: "C",
      tableKey: "c",
      title: "t",
      end: "2025-09-30",
      cols: [{ k: "filed", label: "Filed", unit: "count" }],
      courts: { azd: { filed: 10, other: 3 }, BAD: { filed: 1 } },
    });
    expect(l?.courts).toEqual({ azd: { filed: 10 } });
    expect(parseLatest({ kind: "national" })).toBeNull();
    expect(
      parseCoverageSummary({
        v: 1,
        totals: { listed: 10 },
        publications: [{ code: "JB", title: "Judicial Business", counts: { listed: 4 } }],
      })?.publications[0]?.code,
    ).toBe("JB");
    const pub = parsePublicationCoverage({
      v: 1,
      code: "JB",
      title: "Judicial Business",
      tables: [
        {
          table: "C",
          periods: [["2025-09-30", "a", "p", "p"], ["x"]],
          gaps: [["not acquired", 2]],
        },
      ],
    });
    expect(pub?.tables[0]?.periods).toEqual([
      { end: "2025-09-30", acq: "a", parse: "p", pub: "p" },
    ]);
    expect(
      parseHeld({
        v: 1,
        items: [{ end: "2021-09-30", pub: "JB", tableNumber: "V-1", table: "v-1" }, { pub: "JB" }],
      }),
    ).toHaveLength(1);
  });
});

describe("chart model", () => {
  it("chooses Judicial Business first and lists publications in the publisher's order", () => {
    expect(defaultPub(periods)).toBe("JB");
    expect(defaultPub([{ pub: "BF" }, { pub: "BF" }, { pub: "STFJ" }])).toBe("BF");
    expect(pubCounts(periods).map((p) => p.pub)).toEqual(["JB", "STFJ", "FJCS"]);
    expect(periodIndices(periods, "JB")).toEqual([0, 3, 4]);
    expect(periodIndices(periods, "all")).toHaveLength(5);
  });

  it("puts one publication on its own period ends and all publications on a quarter axis with gaps", () => {
    const jb = buildAxis(periods, periodIndices(periods, "JB"), "JB");
    expect(jb.keys).toEqual(["2023-09-30", "2024-09-30", "2025-09-30"]);
    expect(jb.tick("2024-09-30")).toBe("2024");
    expect(jb.label("2024-09-30")).toBe("12 months ending September 30, 2024 (Judicial Business)");
    const all = buildAxis(periods, periodIndices(periods, "all"), "all");
    expect(all.keys[0]).toBe("2023-09-30");
    expect(all.keys).toContain("2024-06-30");
    expect(all.label("2024-06-30")).toMatch(/^No table for the period ending June 30, 2024/);
    expect(all.tick("2024-06-30")).toBe("Jun 24");
    expect(quarterEnds("2024-03-31", "2024-12-31")).toEqual([
      "2024-03-31",
      "2024-06-30",
      "2024-09-30",
      "2024-12-31",
    ]);
  });

  it("keeps a dash or a missing cell as a gap, never zero", () => {
    const pts = seriesPoints([5, null, 7, 0, 9], periods, [0, 1, 3]);
    expect(pts).toEqual([
      { key: "2023-09-30", value: 5 },
      { key: "2023-12-31", value: null },
      { key: "2024-09-30", value: 0 },
    ]);
    expect(seriesPoints(undefined, periods, [0])).toEqual([{ key: "2023-09-30", value: null }]);
  });

  it("writes period lengths and units as published", () => {
    expect(periodText({ end: "2026-09-30", months: 3 })).toBe("3 months ending September 30, 2026");
    expect(periodText({ end: "2026-09-30", months: 0 })).toBe("As of September 30, 2026");
    expect(formatterFor("count", 0).full(1234)).toBe("1,234");
    expect(formatterFor("number", 2).full(1.5)).toBe("1.50");
    expect(formatterFor("percent", 1).full(null)).toBe("Not recorded");
  });

  it("marks the publisher's breaks on the shown axis only, once per period", () => {
    const a = breakAnnotations(
      [
        { at: 3, kind: "columns", detail: "x" },
        { at: 3, kind: "title", detail: "y" },
        { at: 1, kind: "columns", detail: "z" },
        { at: 4, kind: "notes", detail: "n" },
      ],
      periods,
      ["2023-09-30", "2024-09-30", "2025-09-30"],
    );
    expect(a).toEqual([{ key: "2024-09-30", label: "Columns changed" }]);
    const crowded = breakAnnotations(
      [
        { at: 0, kind: "source", detail: "" },
        { at: 3, kind: "columns", detail: "" },
        { at: 4, kind: "title", detail: "" },
      ],
      periods,
      ["2023-09-30", "2024-09-30", "2025-09-30"],
    );
    expect(crowded.map((x) => x.key)).toEqual(["2023-09-30", "2025-09-30"]);
  });

  it("ranks courts by name and lists courts without a value apart", () => {
    const latest = {
      table: "C",
      tableKey: "c",
      title: "t",
      end: "2025-09-30",
      scope: "district",
      cols: [],
      courts: { azd: { filed: 10 }, cand: {} },
    };
    const items = rankingItems(latest, "filed", new Map([["azd", "D. Arizona"]]));
    expect(items).toEqual([
      { id: "azd", label: "D. Arizona", value: 10 },
      { id: "cand", label: "CAND", value: null },
    ]);
    expect(shortName("U.S. District Court, S.D. New York")).toBe("S.D. New York");
  });

  it("joins renamed columns only where exactly one carries a value", () => {
    const s = spliceColumns(
      { total_filings: [1, 2, null, 5], total_all_chapters: [null, null, 3, 6] },
      ["total_filings", "total_all_chapters"],
      4,
    );
    expect(s.values).toEqual([1, 2, 3, null]);
    expect(s.from).toEqual([0, 0, 1, -1]);
    expect(s.conflicts).toEqual([3]);
  });

  it("compares the newest quarter with the same quarter a year earlier only when both are printed", () => {
    const q = [
      { end: "2025-06-30" },
      { end: "2025-09-30" },
      { end: "2026-06-30" },
      { end: "2026-09-30" },
    ];
    expect(sameQuarterYearEarlier(q, [1, 100, 2, 110])).toEqual({
      latestEnd: "2026-09-30",
      latest: 110,
      priorEnd: "2025-09-30",
      prior: 100,
      change: 10,
      percent: 10,
    });
    expect(sameQuarterYearEarlier(q, [1, null, 2, 110])).toBeNull();
    expect(sameQuarterYearEarlier(q.slice(2), [2, 110])).toBeNull();
    expect(sameQuarterYearEarlier(q, [1, 0, 2, 5])?.percent).toBeNull();
  });

  it("searches cards by table, title, geography and publication, and orders table numbers naturally", () => {
    const card = cardFromCatalog({
      tableKey: "c-2",
      table: "C-2",
      title: "Civil Cases Commenced, by Nature of Suit",
      scopes: [],
      firstEnd: "2017-09-30",
      lastEnd: "2025-09-30",
      periods: 9,
      pubs: ["JB"],
    });
    expect(matchesQuery(card, "nature judicial")).toBe(true);
    expect(matchesQuery(card, "bankruptcy")).toBe(false);
    expect(["C-10", "C-2", "B", "C"].sort(compareTables)).toEqual(["B", "C", "C-2", "C-10"]);
  });
});

describe("bankruptcy measures", () => {
  it("joins the renamed total columns and keeps the heading printed in each period", async () => {
    const { measureSeries, BANKRUPTCY_MEASURES } = await import("./seriesModel");
    const m = measureSeries(
      { total_filings: [10, 11, null], total_all_chapters: [null, null, 12] },
      "total",
      3,
    );
    expect(m.values).toEqual([10, 11, 12]);
    expect(m.printed).toEqual(["Total Filings", "Total Filings", "Total All Chapters"]);
    expect(measureSeries({ total_chapter_7: [1, null] }, "ch7", 2).printed).toEqual([
      "Total Chapter 7",
      null,
    ]);
    expect(Object.keys(BANKRUPTCY_MEASURES)).toEqual([
      "total",
      "business",
      "nonbusiness",
      "ch7",
      "ch11",
      "ch13",
    ]);
  });
});

describe("column headings over many editions", () => {
  it("writes the relative year instead of the last edition's year", async () => {
    const { columnDisplay } = await import("./seriesModel");
    expect(columnDisplay("Filed / 2026", "filed/y0")).toBe("Filed (this period)");
    expect(columnDisplay("2026 / Total", "y0/total")).toBe("Total (this period)");
    expect(columnDisplay("2026", "y0")).toBe("This period");
    expect(columnDisplay("Pending October 1, 2024", "pending_october_1_ym1")).toBe(
      "Pending October 1 (previous year)",
    );
    expect(
      columnDisplay(
        "Not Terminated as of September 30, 2025 / Total",
        "not_terminated_as_of_september_30_y0/total",
      ),
    ).toBe("Not Terminated as of September 30 (this period) / Total");
    expect(columnDisplay("Total Filings", "total_filings")).toBe("Total Filings");
    expect(columnDisplay("A / B", "a")).toBe("A / B");
  });
});
