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
  bankruptcyDistrict,
  countyPayloads,
  courtScope,
  FEDERAL_CIRCUIT_IDS,
  FEDERAL_DISTRICT_IDS,
  loadCountyTables,
  loadCourtTables,
  parseUstCatalog,
  parseUstNational,
  parseUstTable,
} from "./uscourtsTables.functions";

const mocked = vi.mocked(restGet);

// Shaped like the stored record for S.D.N.Y. Table C (values are invented fixtures, not published figures).
const SRC = (end: string, pub = "JB") => ({
  pub,
  end,
  page: `https://www.uscourts.gov/data-news/data-tables/${end.slice(0, 4)}/09/30/judicial-business/c`,
  url: `https://www.uscourts.gov/sites/default/files/document/jb_c_0930.${end.slice(0, 4)}.xlsx`,
  sha256: "a".repeat(64),
  fmt: "xlsx",
  sheet: "Table C",
});
const COURT_RECORD = {
  v: 1,
  scope: "district",
  court: "nysd",
  courtLabel: "NY,S",
  table: "C",
  tableKey: "c",
  title: "U.S. District Courts - Civil Cases Filed, Terminated, and Pending",
  periods: [
    { end: "2023-09-30", months: 12, pub: "JB", src: 0 },
    { end: "2024-09-30", months: 12, pub: "JB", src: 1 },
    { end: "2024-12-31", months: 12, pub: "STFJ", src: 2 },
  ],
  cols: [
    { k: "filed/y0", label: "Filed / 2024", unit: "count", dec: 0 },
    { k: "pending", label: "Pending", unit: "count", dec: 0 },
    { k: "bad", label: "Wrong length", unit: "count", dec: 0 },
  ],
  data: {
    "filed/y0": [100, 120, null],
    pending: [50, "x", 60],
    bad: [1, 2],
    orphan: [1, 2, 3],
  },
  dash: { pending: [1, 7, -1], "filed/y0": [2] },
  nat: { "filed/y0": [1000, 1100, 1200], pending: [500, 510, 520] },
  natDash: {},
  circuitId: "ca2",
  circ: { "filed/y0": [300, 310, 320], pending: [150, 151, 152] },
  notes: [
    { at: [0, 1], lines: ["NOTE: Land condemnation cases omitted."] },
    { at: [9], lines: ["out of range"] },
  ],
  marks: [
    {
      at: [0, 1],
      col: null,
      text: "² The higher number of pending cases reported for the Southern District of West Virginia is the result of a transfer.",
    },
    { at: [1], col: "pending", text: "¹ Percent change not computed." },
    { at: [1], col: "unknown-col", text: "dropped: no such column" },
    { at: [7], col: null, text: "dropped: period out of range" },
  ],
  breaks: [{ at: 2, kind: "notes", detail: "The footnotes differ from the previous period." }],
  src: [
    SRC("2023-09-30"),
    SRC("2024-09-30"),
    { ...SRC("2024-12-31", "STFJ"), url: "javascript:alert(1)" },
  ],
};

describe("parseUstTable", () => {
  it("reads a court record and keeps published labels", () => {
    const t = parseUstTable(COURT_RECORD)!;
    expect(t.court).toBe("nysd");
    expect(t.courtLabel).toBe("NY,S");
    expect(t.table).toBe("C");
    expect(t.periods.map((p) => p.end)).toEqual(["2023-09-30", "2024-09-30", "2024-12-31"]);
    expect(t.columns.map((c) => c.key)).toEqual(["filed/y0", "pending"]);
    expect(t.data["filed/y0"]).toEqual([100, 120, null]);
  });

  it("turns a non-numeric value into null, never zero", () => {
    const t = parseUstTable(COURT_RECORD)!;
    expect(t.data["pending"]).toEqual([50, null, 60]);
  });

  it("drops a column whose array length differs from the periods and columns that are not declared", () => {
    const t = parseUstTable(COURT_RECORD)!;
    expect(t.data["bad"]).toBeUndefined();
    expect(t.data["orphan"]).toBeUndefined();
    expect(t.columns.find((c) => c.key === "bad")).toBeUndefined();
  });

  it("keeps only valid dash indexes and in-range notes", () => {
    const t = parseUstTable(COURT_RECORD)!;
    expect(t.dash["pending"]).toEqual([1]);
    expect(t.dash["filed/y0"]).toEqual([2]);
    expect(t.notes).toHaveLength(1);
    expect(t.notes[0]!.at).toEqual([0, 1]);
  });

  it("keeps footnotes attached to the row or a known column, and drops marks that point nowhere", () => {
    const t = parseUstTable(COURT_RECORD)!;
    expect(t.marks).toHaveLength(2);
    expect(t.marks[0]).toMatchObject({ col: null, at: [0, 1] });
    expect(t.marks[1]).toMatchObject({ col: "pending", at: [1] });
  });

  it("carries the national and circuit rows for the same columns", () => {
    const t = parseUstTable(COURT_RECORD)!;
    expect(t.national["filed/y0"]).toEqual([1000, 1100, 1200]);
    expect(t.circuitId).toBe("ca2");
    expect(t.circuit!["pending"]).toEqual([150, 151, 152]);
  });

  it("keeps a source only when its link is http(s)", () => {
    const t = parseUstTable(COURT_RECORD)!;
    expect(t.sources[0]!.url).toMatch(/^https:\/\/www\.uscourts\.gov\//);
    expect(t.sources[2]!.url).toBe("");
  });

  it("rejects unordered periods, unknown versions and missing titles", () => {
    expect(
      parseUstTable({ ...COURT_RECORD, periods: [...COURT_RECORD.periods].reverse() }),
    ).toBeNull();
    expect(parseUstTable({ ...COURT_RECORD, v: 2 })).toBeNull();
    expect(parseUstTable({ ...COURT_RECORD, title: "" })).toBeNull();
    expect(parseUstTable({ ...COURT_RECORD, scope: "state" })).toBeNull();
    expect(parseUstTable(null)).toBeNull();
    expect(
      parseUstTable({ ...COURT_RECORD, periods: [{ end: "2023-13-45", pub: "JB", src: 0 }] }),
    ).toBeNull();
  });
});

describe("county records", () => {
  const COUNTY = {
    ...COURT_RECORD,
    scope: "county",
    court: "01001:dcd",
    courtLabel: "AUTAUGA",
    table: "F-5A",
    tableKey: "f-5a",
    fips: "01001",
    district: "dcd",
    state: "AL",
    districtRow: { "filed/y0": [200, 210, 220], pending: [1, 2, 3] },
    outsideAt: [1, 9, -1],
  };
  it("reads the FIPS code, the reporting district and its row", () => {
    const t = parseUstTable(COUNTY)!;
    expect(t.scope).toBe("county");
    expect(t.county).toMatchObject({ fips: "01001", district: "dcd", state: "AL", outsideAt: [1] });
    expect(t.county!.districtRow!["filed/y0"]).toEqual([200, 210, 220]);
  });
  it("rejects a county record without a 5-digit FIPS code or a district", () => {
    expect(parseUstTable({ ...COUNTY, fips: "1001" })).toBeNull();
    expect(parseUstTable({ ...COUNTY, fips: undefined })).toBeNull();
    expect(parseUstTable({ ...COUNTY, district: undefined })).toBeNull();
  });
  // What is stored: one shared record per table and one record per county (its series under each reporting district).
  const SHARED = {
    v: 1,
    kind: "county-table",
    scope: "county",
    table: "F-5A",
    tableKey: "f-5a",
    title: "U.S. Bankruptcy Courts - Cases Commenced, by County and Chapter",
    periods: COURT_RECORD.periods,
    cols: COURT_RECORD.cols,
    src: COURT_RECORD.src,
    notes: COURT_RECORD.notes,
    breaks: COURT_RECORD.breaks,
    nat: COURT_RECORD.nat,
    natDash: {},
    marks: [{ at: [0, 1], col: "pending", text: "¹ Heading footnote shared by every county." }],
    districtRows: { dcd: { data: { "filed/y0": [200, 210, 220], pending: [1, 2, 3] }, dash: {} } },
  };
  const COUNTY_RECORD = {
    v: 1,
    scope: "county",
    fips: "01001",
    state: "AL",
    courtLabel: "AUTAUGA",
    table: "F-5A",
    tableKey: "f-5a",
    ref: "table:f-5a",
    districts: [
      {
        district: "dcd",
        label: "AUTAUGA",
        data: { "filed/y0": [4, 5, null], pending: [1, 1, 2] },
        dash: { "filed/y0": [2] },
        marks: [],
      },
      {
        district: "gamd",
        label: "AUTAUGA",
        data: { "filed/y0": [1, 1, 1] },
        dash: {},
        marks: [],
        outsideAt: [0, 1, 2],
      },
    ],
  };
  it("joins a county's stored series to the shared table record, one table per reporting district", () => {
    const payloads = countyPayloads(SHARED, COUNTY_RECORD);
    expect(payloads).toHaveLength(2);
    const tables = payloads.map((p) => parseUstTable(p)!);
    expect(tables.map((t) => t.county!.district)).toEqual(["dcd", "gamd"]);
    expect(tables[0]!.data["filed/y0"]).toEqual([4, 5, null]);
    expect(tables[0]!.dash["filed/y0"]).toEqual([2]);
    expect(tables[0]!.county!.districtRow!["filed/y0"]).toEqual([200, 210, 220]);
    expect(tables[0]!.national["filed/y0"]).toEqual([1000, 1100, 1200]);
    // the column-heading footnote is stored once in the shared record and applies to every county
    expect(tables[0]!.marks).toEqual([
      { at: [0, 1], col: "pending", text: "¹ Heading footnote shared by every county." },
    ]);
    expect(tables[1]!.county).toMatchObject({
      district: "gamd",
      outsideAt: [0, 1, 2],
      districtRow: null,
    });
    expect(tables[1]!.sources).toHaveLength(3);
  });
  it("refuses to join a county record to another table's shared record", () => {
    expect(countyPayloads(SHARED, { ...COUNTY_RECORD, tableKey: "f-5a-s2" })).toEqual([]);
    expect(countyPayloads({ ...SHARED, kind: "other" }, COUNTY_RECORD)).toEqual([]);
    expect(countyPayloads(null, COUNTY_RECORD)).toEqual([]);
  });
  it("loadCountyTables asks for the shared and the county record of each table key only", async () => {
    mocked.mockReset();
    mocked.mockResolvedValue({
      rows: [
        { id: "table:f-5a", ust: SHARED },
        { id: "01001:f-5a", ust: COUNTY_RECORD },
      ],
      total: null,
    });
    const out = await loadCountyTables("01001", ["f-5a", "../x"]);
    expect(out.map((t) => t.county!.fips)).toEqual(["01001", "01001"]);
    expect(mocked).toHaveBeenCalledTimes(1);
    const url = decodeURIComponent(String(mocked.mock.calls[0]![0]));
    expect(url).toContain('id=in.("table:f-5a","01001:f-5a")');
    expect(url).not.toContain("..");
    expect(await loadCountyTables("1001")).toEqual([]);
  });
});

describe("parseUstNational", () => {
  const NATIONAL = {
    v: 1,
    scope: "national",
    table: "C-2",
    tableKey: "c-2",
    title: "U.S. District Courts - Civil Cases Filed, by Jurisdiction and Nature of Suit",
    periods: [{ end: "2024-09-30", months: 12, pub: "JB", src: 0 }],
    cols: [{ k: "total", label: "Total", unit: "count", dec: 0 }],
    rows: [
      {
        k: "total-cases",
        label: "Total Cases",
        path: ["Total Cases"],
        depth: 0,
        data: { total: [10] },
        dash: {},
      },
      {
        k: "contract/franchise",
        label: "Franchise",
        path: ["Contract Actions", "Franchise"],
        depth: 1,
        data: { total: [null] },
        dash: { total: [0] },
      },
      { k: "empty", label: "No data", path: ["No data"], depth: 0, data: {} },
    ],
    totals: { total: [10] },
    notes: [],
    breaks: [],
    src: [SRC("2024-09-30")],
  };
  it("reads rows with published labels and dash positions", () => {
    const t = parseUstNational(NATIONAL)!;
    expect(t.rows.map((r) => r.label)).toEqual(["Total Cases", "Franchise"]);
    expect(t.rows[1]!.dash["total"]).toEqual([0]);
    expect(t.rows[1]!.data["total"]).toEqual([null]);
    expect(t.totals["total"]).toEqual([10]);
  });
  it("rejects a record with no readable rows", () => {
    expect(parseUstNational({ ...NATIONAL, rows: [] })).toBeNull();
    expect(parseUstNational({ ...NATIONAL, scope: "district" })).toBeNull();
  });
});

describe("parseUstCatalog", () => {
  it("keeps entries with a table, title, dates and a period count", () => {
    const c = parseUstCatalog({
      tables: [
        {
          tableKey: "c",
          table: "C",
          title: "Civil",
          scopes: ["district", "bogus"],
          firstEnd: "2017-09-30",
          lastEnd: "2026-06-30",
          periods: 35,
          pubs: ["JB", "STFJ"],
        },
        {
          tableKey: "x",
          table: "X",
          title: "",
          firstEnd: "2017-09-30",
          lastEnd: "2026-06-30",
          periods: 1,
        },
        {
          tableKey: "y",
          table: "Y",
          title: "Bad date",
          firstEnd: "2017-99-30",
          lastEnd: "2026-06-30",
          periods: 1,
        },
      ],
    });
    expect(c).toHaveLength(1);
    expect(c[0]!.scopes).toEqual(["district"]);
    expect(parseUstCatalog(null)).toEqual([]);
  });
});

describe("courtScope", () => {
  it("routes court ids to their table dataset", () => {
    expect(courtScope("nysd")).toBe("district");
    expect(courtScope("txsb")).toBe("bankruptcy");
    expect(courtScope("ca9")).toBe("circuit");
    expect(courtScope("cadc")).toBe("circuit");
    expect(courtScope("cafc")).toBe("circuit");
    expect(courtScope("scotus")).toBeNull();
    expect(courtScope("NYSD")).toBeNull();
    // directory ids that look like districts but are not among the 94 federal districts
    expect(courtScope("orld")).toBeNull();
    expect(courtScope("ind")).toBeNull();
    expect(courtScope("ohiod")).toBeNull();
  });
  it("pairs bankruptcy courts with their district and leaves the unpaired ones out", () => {
    expect(bankruptcyDistrict("nysb")).toBe("nysd");
    expect(bankruptcyDistrict("arb")).toBe("azd");
    expect(bankruptcyDistrict("areb")).toBe("ared");
    expect(bankruptcyDistrict("neb")).toBeNull();
    expect(bankruptcyDistrict("ptab")).toBeNull();
    expect(bankruptcyDistrict("nysd")).toBeNull();
    expect(courtScope("arb")).toBe("bankruptcy");
    expect(courtScope("neb")).toBeNull();
    expect(FEDERAL_DISTRICT_IDS.size).toBe(94);
    expect(FEDERAL_CIRCUIT_IDS.size).toBe(13);
  });
});

describe("loadCourtTables", () => {
  beforeEach(() => mocked.mockReset());
  it("requests only well-formed table keys for this court and drops records of another court", async () => {
    mocked.mockResolvedValue({
      rows: [
        { id: "nysd:c", ust: COURT_RECORD },
        { id: "txsd:c", ust: { ...COURT_RECORD, court: "txsd" } },
      ],
      total: null,
    });
    const out = await loadCourtTables("nysd", ["c", "../etc", "d-1"]);
    expect(out.map((t) => t.court)).toEqual(["nysd"]);
    const path = decodeURIComponent(String(mocked.mock.calls[0]![0]));
    expect(path).toContain("dataset=eq.uscourts_tables_district");
    expect(path).toContain('"nysd:c","nysd:d-1"');
    expect(path).not.toContain("etc");
  });
  it("returns nothing for a court the tables do not cover, without a request", async () => {
    expect(await loadCourtTables("scotus", ["c"])).toEqual([]);
    expect(mocked).not.toHaveBeenCalled();
  });
});
