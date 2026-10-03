import { describe, expect, it } from "vitest";
import {
  computeFacets,
  filterCases,
  masterCase,
  mergeCases,
  pageCases,
  parseFjcCase,
  parseInventoryCase,
  scopedFacets,
  sortCases,
  type CaseRow,
} from "./cases";

const inventoryItem = (over: Record<string, unknown> = {}) => ({
  id: "cl_docket:111",
  cells: {
    mdl: "9001",
    court: "cand",
    filed: "2022-01-20",
    docket: "4:22-cv-00401",
    status: "active",
  },
  title: "4:22-cv-00401 (cand)",
  badges: ["MDL 9001", "public_docket", "Caption withheld"],
  ...over,
});
const inventoryFacts = (basis: string, over: Record<string, string> = {}) =>
  Object.entries({
    "CourtListener docket id": "111",
    "Docket number (AWS release)": "4:22-cv-00401",
    "Date terminated (AWS release)": "not recorded",
    Caption: 'withheld — caption begins with "In re"',
    "Defendant as recorded": "EXAMPLE CORP",
    "MDL membership basis": basis,
    "MDL membership evidence":
      "SW-BULK catalog points at a master docket that resolves to mdl:9001",
    ...over,
  });

describe("saved-docket-sample cases", () => {
  it("maps each membership basis to its evidence class and keeps the source text", () => {
    const row = parseInventoryCase(
      inventoryItem(),
      inventoryFacts("catalog_mdl_master_docket_id"),
    )!;
    expect(row).toMatchObject({
      clDocketId: "111",
      docketNumber: "4:22-cv-00401",
      courtId: "cand",
      dateFiled: "2022-01-20",
      dateTerminated: null,
      status: "active",
      role: "member",
      evidence: "catalog_master_reference",
      captionWithheld: true,
      caption: null,
      defendant: "EXAMPLE CORP",
      route: null,
      sourceUrl: "https://www.courtlistener.com/docket/111/",
    });
    expect(row.evidenceDetail).toContain("mdl:9001");
    expect(parseInventoryCase(inventoryItem(), inventoryFacts("member_of_mdl"))!.evidence).toBe(
      "crosswalk_member_edge",
    );
    const master = parseInventoryCase(inventoryItem(), inventoryFacts("master_docket_of_mdl"))!;
    expect(master).toMatchObject({ evidence: "crosswalk_master", role: "master" });
  });

  it("drops rows with no recognised membership basis rather than guessing", () => {
    expect(parseInventoryCase(inventoryItem(), inventoryFacts("something_new"))).toBeNull();
    expect(parseInventoryCase(inventoryItem(), [])).toBeNull();
    expect(parseInventoryCase(null, inventoryFacts("member_of_mdl"))).toBeNull();
  });

  it("shows a real collective caption but never the projected placeholder title", () => {
    const facts = inventoryFacts("master_docket_of_mdl", { Caption: "In re the EXXON VALDEZ" });
    const row = parseInventoryCase(
      inventoryItem({ title: "In re the EXXON VALDEZ", badges: ["MDL 9001"] }),
      facts,
    )!;
    expect(row.caption).toBe("In re the EXXON VALDEZ");
    expect(row.captionWithheld).toBe(false);
  });
});

describe("FJC IDB cases and the master docket", () => {
  it("labels FJC associations as historical evidence and withholds captions", () => {
    const row = parseFjcCase({
      cells: {
        native_id: "222",
        docket_number: "2:19-cv-1",
        court_id: "njd",
        date_filed: "2019-02-01",
        date_terminated: "2020-03-04",
        mdl_number_raw: "2885",
      },
    })!;
    expect(row).toMatchObject({
      clDocketId: "222",
      courtId: "njd",
      evidence: "fjc_idb",
      status: "terminated",
      caption: null,
      captionWithheld: true,
    });
    expect(row.evidenceDetail).toContain("2885");
    expect(parseFjcCase({ cells: {} })).toBeNull();
    expect(parseFjcCase("x")).toBeNull();
  });

  it("builds the master docket row from the MDL record", () => {
    const row = masterCase({
      clDocketId: "333",
      docketNumber: "3:25-md-9001",
      courtId: "flnd",
      dateFiled: "2025-02-07",
      dateTerminated: null,
      title: "IN RE: Example",
    })!;
    expect(row).toMatchObject({
      role: "master",
      evidence: "master_docket",
      status: null,
      caption: "IN RE: Example",
    });
    expect(
      masterCase({
        clDocketId: null,
        docketNumber: null,
        courtId: null,
        dateFiled: null,
        dateTerminated: null,
        title: null,
      }),
    ).toBeNull();
  });

  it("merges by CourtListener docket id and lets the strongest evidence win without losing a filing date", () => {
    const master = masterCase({
      clDocketId: "111",
      docketNumber: "4:22-md-03047",
      courtId: "cand",
      dateFiled: null,
      dateTerminated: null,
      title: "IN RE",
    })!;
    const member = parseInventoryCase(inventoryItem(), inventoryFacts("member_of_mdl"))!;
    const fjc = parseFjcCase({
      cells: { native_id: "111", docket_number: "x", court_id: "cand", date_filed: "2022-10-06" },
    })!;
    const merged = mergeCases([fjc, member, master]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ evidence: "master_docket", dateFiled: "2022-01-20" });
  });
});

describe("filters and facets are scoped to the matter's own rows", () => {
  const mk = (over: Partial<CaseRow>): CaseRow => ({
    id: String(Math.random()),
    clDocketId: null,
    docketNumber: "1:20-cv-1",
    caption: null,
    captionWithheld: true,
    courtId: "cand",
    dateFiled: "2022-05-01",
    dateTerminated: null,
    status: "active",
    role: "member",
    evidence: "crosswalk_member_edge",
    evidenceDetail: null,
    route: null,
    defendant: null,
    sourceUrl: null,
    source: "inventory",
    ...over,
  });
  const rows = [
    mk({ courtId: "cand", dateFiled: "2022-05-01" }),
    mk({ courtId: "cand", dateFiled: "2023-05-01", status: "terminated" }),
    mk({ courtId: "njd", dateFiled: "2023-06-01", evidence: "fjc_idb" }),
    mk({ courtId: "njd", dateFiled: null, role: "master", evidence: "master_docket" }),
  ];

  it("counts only the rows passed in and omits unrecorded values", () => {
    const f = computeFacets(rows);
    expect(f.court).toEqual([
      { value: "cand", label: "cand", count: 2 },
      { value: "njd", label: "njd", count: 2 },
    ]);
    expect(f.year.map((o) => [o.value, o.count])).toEqual([
      ["2023", 2],
      ["2022", 1],
    ]);
    expect(f.routeRecorded).toBe(false);
    expect(f.route).toEqual([]);
    expect(f.evidence.find((o) => o.value === "fjc_idb")!.label).toContain("historical");
  });

  it("filters on every dimension", () => {
    expect(filterCases(rows, { court: "njd" })).toHaveLength(2);
    expect(filterCases(rows, { year: "2023" })).toHaveLength(2);
    expect(filterCases(rows, { status: "terminated" })).toHaveLength(1);
    expect(filterCases(rows, { evidence: "fjc_idb" })).toHaveLength(1);
    expect(filterCases(rows, { role: "master" })).toHaveLength(1);
    expect(filterCases(rows, { court: "njd", year: "2023" })).toHaveLength(1);
    expect(filterCases(rows, { q: "NJD" })).toHaveLength(2);
  });

  it("scopes each facet to the other active filters, so counts match the table", () => {
    const f = scopedFacets(rows, { court: "njd" });
    // Court options ignore the court filter itself; year options reflect only njd rows.
    expect(f.court.map((o) => o.count)).toEqual([2, 2]);
    expect(f.year.map((o) => [o.value, o.count])).toEqual([["2023", 1]]);
    expect(f.evidence.reduce((n, o) => n + o.count, 0)).toBe(2);
  });

  it("sorts by filing date with unknown dates last, and by docket number naturally", () => {
    expect(sortCases(rows, "filed-desc").map((r) => r.dateFiled)).toEqual([
      "2023-06-01",
      "2023-05-01",
      "2022-05-01",
      null,
    ]);
    expect(sortCases(rows, "filed-asc").map((r) => r.dateFiled)).toEqual([
      "2022-05-01",
      "2023-05-01",
      "2023-06-01",
      null,
    ]);
    const numbered = [mk({ docketNumber: "1:20-cv-10" }), mk({ docketNumber: "1:20-cv-2" })];
    expect(sortCases(numbered, "docket").map((r) => r.docketNumber)).toEqual([
      "1:20-cv-2",
      "1:20-cv-10",
    ]);
  });
});

describe("server-side paging of the member-case list", () => {
  const mk = (n: number, over: Partial<CaseRow> = {}): CaseRow => ({
    id: `row-${n}`,
    clDocketId: null,
    docketNumber: `1:22-cv-${String(n).padStart(5, "0")}`,
    caption: null,
    captionWithheld: true,
    courtId: n % 3 === 0 ? "njd" : "cand",
    // Row 0 has no filing date; the others are one day apart, newest = highest number.
    dateFiled:
      n === 0
        ? null
        : `2023-${String(1 + (n % 12)).padStart(2, "0")}-${String(1 + (n % 27)).padStart(2, "0")}`,
    dateTerminated: null,
    status: "active",
    role: n % 5 === 0 ? "transferor" : "member",
    evidence: "registry",
    evidenceDetail: null,
    route: n % 2 === 0 ? "transferred" : null,
    defendant: null,
    sourceUrl: null,
    source: "registry",
    registry: {
      rowId: `sw-md:9001:cand:1:22-cv-${n}`,
      docketKey: `cand:1:22-cv-${n}`,
      basisKinds: n % 4 === 0 ? ["jpml_schedule_a", "native_crosswalk"] : ["native_crosswalk"],
      evidenceCount: 1,
      countsAsAction: n % 5 !== 0,
      actionId: null,
      conflict: false,
      nativeCaseIds: [],
      links: [],
      captionSource: null,
    },
    ...over,
  });
  const rows = Array.from({ length: 137 }, (_, i) => mk(i));

  it("returns one page and the exact total of the filtered list", () => {
    const page = pageCases(rows, {}, "docket", 0, 50);
    expect(page.rows).toHaveLength(50);
    expect(page.total).toBe(137);
    expect(page.offset).toBe(0);
    expect(page.pageSize).toBe(50);
    expect(page.rows[0]!.docketNumber).toBe("1:22-cv-00000");
    const last = pageCases(rows, {}, "docket", 100, 50);
    expect(last.rows).toHaveLength(37);
    expect(last.offset).toBe(100);
    expect(last.rows.at(-1)!.docketNumber).toBe("1:22-cv-00136");
  });

  it("filters before it pages, so totals and pages describe the same rows", () => {
    const filtered = filterCases(rows, { court: "njd", role: "member" });
    const page = pageCases(rows, { court: "njd", role: "member" }, "docket", 0, 10);
    expect(page.total).toBe(filtered.length);
    expect(page.rows.every((r) => r.courtId === "njd" && r.role === "member")).toBe(true);
    expect(page.rows).toHaveLength(Math.min(10, filtered.length));
  });

  it("walks the whole sorted list page by page without losing or repeating a row", () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 137; offset += 25) {
      seen.push(...pageCases(rows, {}, "filed-desc", offset, 25).rows.map((r) => r.id));
    }
    expect(seen).toHaveLength(137);
    expect(new Set(seen).size).toBe(137);
    expect(seen).toEqual(sortCases(rows, "filed-desc").map((r) => r.id));
  });

  it("clamps an offset past the end to the last page and aligns it to a page boundary", () => {
    const beyond = pageCases(rows, {}, "docket", 9999, 50);
    expect(beyond.offset).toBe(100);
    expect(beyond.rows).toHaveLength(37);
    const unaligned = pageCases(rows, {}, "docket", 61, 50);
    expect(unaligned.offset).toBe(50);
    expect(pageCases([], {}, "docket", 40, 50)).toMatchObject({ rows: [], total: 0, offset: 0 });
  });

  it("scopes the facets to the other filters exactly as the table is scoped", () => {
    const page = pageCases(rows, { court: "njd" }, "docket", 0, 50);
    expect(page.facets).toEqual(scopedFacets(rows, { court: "njd" }));
    // The court facet ignores its own filter; the role facet reflects only the njd rows.
    expect(page.facets.court.map((o) => o.value).sort()).toEqual(["cand", "njd"]);
    const njdRoles = filterCases(rows, { court: "njd" }).length;
    expect(page.facets.role.reduce((n, o) => n + o.count, 0)).toBe(njdRoles);
  });

  it("ships a small page instead of the whole list", () => {
    const page = pageCases(rows, {}, "docket", 0, 50);
    expect(JSON.stringify(page.rows).length).toBeLessThan(JSON.stringify(rows).length / 2);
  });
});
