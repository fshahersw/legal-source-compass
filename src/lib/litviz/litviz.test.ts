import { describe, expect, it } from "vitest";
import {
  compareMdls,
  clusterAuthorities,
  parseCitationGrid,
  parseCitationMap,
  parseFilingCitations,
} from "./citations";
import { childLevel, metricFor, parseCourtLevel } from "./courtTree";
import { docketRows, filingRowsYearly, fjcThrough, productRows } from "./derive";
import {
  assembleLanes,
  byDecade,
  filterLanes,
  fromWire,
  laneDecade,
  laneFacets,
  parseLanesSource,
  pendingPoints,
  rollupForLanes,
  sortLanes,
  toWire,
  type CompactRow,
} from "./lanes";
import {
  dateIndex,
  mdlAttributes,
  monthIndex,
  monthKey,
  parseSeriesRows,
  periodLabel,
  rowSpan,
  seriesMeta,
  yearlyFlow,
} from "./model";
import { mergeSignalRows, parseMdlDetail, productSignals } from "./signals";

const row = (series: string, month: string, value: number | null, basis = "") => ({
  series,
  month,
  value,
  unit: "u",
  source_dataset: "d",
  source_url: null,
  basis,
});

describe("model", () => {
  it("indexes months and dates exactly and refuses impossible ones", () => {
    expect(monthIndex("2024-10")).toBe(2024 * 12 + 9);
    expect(monthKey(2024 * 12 + 9)).toBe("2024-10");
    expect(monthIndex("2024-13")).toBeNull();
    expect(dateIndex("2023-02-29")).toBeNull();
    expect(dateIndex("2024-02-29")).toBeCloseTo(2024 * 12 + 1 + 28 / 29);
  });

  it("spans and labels each grain", () => {
    expect(rowSpan({ month: "2021-09" }, "fiscal_year")).toEqual([2021 * 12 - 3, 2021 * 12 + 9]);
    expect(rowSpan({ month: "2021-01" }, "calendar_year")).toEqual([2021 * 12, 2022 * 12]);
    expect(periodLabel({ month: "2021-09" }, "fiscal_year")).toBe("FY2021");
    expect(periodLabel({ month: "2021-03" }, "month")).toBe("Mar 2021");
  });

  it("describes a series it does not know from its row, never inventing a unit", () => {
    const m = seriesMeta("fda_recalls_class_i", { unit: "recalls", basis: "monthly", source_dataset: "x" });
    expect(m).toMatchObject({ label: "Fda recalls class i", unit: "recalls", grain: "month", group: "product" });
    expect(seriesMeta("faers_reports").grain).toBe("calendar_year");
  });

  it("parses rows defensively: bad months and series ids are dropped, unsafe links removed", () => {
    const rows = parseSeriesRows([
      { series: "a", month: "2024-01", value: "12", unit: "x", source_dataset: "d", source_url: "javascript:x", basis: "b" },
      { series: "a b", month: "2024-01", value: 1 },
      { series: "a", month: "2024-1", value: 1 },
      { series: "a", month: "2024-02", value: null, source_url: "/litigation/documents?mdl=1" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ value: 12, source_url: null });
    expect(rows[1]).toMatchObject({ value: null, source_url: "/litigation/documents?mdl=1" });
  });

  it("rolls monthly flows to calendar years, carrying the partial mark", () => {
    expect(
      yearlyFlow([row("x", "2025-12", 2), row("x", "2026-01", 3), row("x", "2026-02", 1, "a:partial_month")]),
    ).toEqual([
      { year: 2025, value: 2, partial: false },
      { year: 2026, value: 4, partial: true },
    ]);
  });

  it("labels an MDL from its records in order of authority and links a judge only on an exact match", () => {
    const a = mdlAttributes("2001", {
      m: { title: "M", cl_court_id: "nysd", court_name: "S.D. New York", judge_name_as_printed: "A", judge_profile_id: "0123456789abcdef0123456789abcdef", judge_match_kind: "middle_initial" },
      h: { title: "H", district: "NYS", date_filed: "2023-01-05", date_transferred: "2023-04-02", exit_status: "pending" },
    });
    expect(a).toMatchObject({ title: "M", status: "pending", court: { id: "nysd", label: "S.D. New York" } });
    expect(a.judge).toEqual({ name: "A", href: null });
    expect(a.dates.centralized).toBe("2023-04-02");
    const h = mdlAttributes("1500", { x: { caption: "Old PL", district: "Ohio Northern" }, t: { termination_year: 2004 } });
    expect(h).toMatchObject({ status: "historical", title: "Old PL", court: { label: "Ohio Northern" } });
    expect(h.dates.closedYear).toBe(2004);
    expect(mdlAttributes("7", {}).title).toBe("MDL No. 7");
  });
});

describe("derive (fallback-only paths)", () => {
  it("reads the FJC extract date from its published note", () => {
    expect(fjcThrough("cv88on.zip, last modified 2026-08-26 on fjc.gov; filing dates through 2026-06-30")).toBe(
      "2026-06-30",
    );
    expect(fjcThrough("no date")).toBeNull();
  });

  it("zero-fills filings per year only inside the collected span and marks the current year partial", () => {
    const rows = filingRowsYearly(
      [
        { mdl: "1", year: 2022, n: 3 },
        { mdl: "1", year: 2024, n: 1 },
        { mdl: "1", year: 2026, n: 2 },
        { mdl: "1", year: 2030, n: 9 },
      ],
      "2026-10-23",
    );
    expect(rows.map((r) => [r.month, r.value, r.basis])).toEqual([
      ["2022-01", 3, "documents:listing_rule:calendar_year"],
      ["2023-01", 0, "documents:listing_rule:calendar_year"],
      ["2024-01", 1, "documents:listing_rule:calendar_year"],
      ["2025-01", 0, "documents:listing_rule:calendar_year"],
      ["2026-01", 2, "documents:listing_rule:calendar_year:partial"],
    ]);
  });

  it("never counts the same MDL's docket from both docket datasets", () => {
    const rows = docketRows(
      [{ mdl: "5", date: "2026-01-01", url: "u" }],
      [
        { mdl: "5", date: "2026-02-01", url: "v" },
        { mdl: "6", date: "2026-02-01", url: "w" },
      ],
      "2026-10-23",
    );
    expect(rows.map((r) => [r.mdl, r.month, r.source_dataset])).toEqual([
      ["5", "2026-01", "sw_docket_entries_v1"],
      ["6", "2026-02", "mdl_docket_activity"],
    ]);
  });

  it("takes product series only from records that name the MDL", () => {
    const rows = productRows([
      { dataset: "fda_device_event_series", id: "national", item: { mdl: null, series: [{ year: 2025, reports: 1 }] } },
      { dataset: "fda_faers_product_series", id: "9", item: { mdl: 9, series: [{ year: 2025, reports: 4 }] } },
      { dataset: "agency_safety_openfda_drug_enforcement", id: "x", item: { mdl: 9, series: [{ year: 2025, reports: 4 }] } },
    ]);
    expect(rows.map((r) => [r.mdl, r.series, r.value])).toEqual([["9", "faers_reports", 4]]);
  });
});

const SRC = {
  scope: "reported",
  today: "2026-10-23",
  refreshed: "2026-10-23T06:17:00Z",
  mdls: [
    { mdl: "2001", src: { m: { title: "Widget", cl_court_id: "nysd", court_name: "S.D. New York", litigation_type: "Products Liability", date_transferred: "2023-04-02" } } },
    { mdl: "2002", src: { h: { title: "Gadget", exit_status: "terminated", date_closed: "2025-07-08", district: "NYS" } } },
    { mdl: "bad", src: {} },
  ],
  rows: [
    ["2001", "jpml_fy_pending", "2023-09", 10, "jpml_fy_statistical_analysis"],
    ["2001", "jpml_fy_pending", "2024-09", 90, "jpml_fy_statistical_analysis:attribution_unverified"],
    ["2001", "jpml_pending", "2024-10", 100, "jpml_monthly_report"],
    ["2001", "jpml_pending", "2024-11", 120, "jpml_monthly_report"],
    ["2001", "jpml_pending", "2025-01", 150, "jpml_monthly_report"],
    ["2001", "docket_entries", "2025", 5, ""],
    ["2001", "docket_entries", "2026", 7, "partial"],
    ["2001", "docket_entries_12m", "2025-10/2026-10", 6, ""],
    ["2002", "jpml_pending", "2024-10", 4, "jpml_monthly_report"],
    ["2002", "x", "2024", "bad", ""],
  ],
  national: [{ series: "jpml_motions_granted", month: "2025-01", value: 18, unit: "motions", source_dataset: "d", source_url: null, basis: "calendar_year_total" }],
};

describe("lanes", () => {
  const src = parseLanesSource(SRC)!;
  const p = assembleLanes(src, "precomputed");

  it("parses the RPC payload and drops malformed MDLs and rows", () => {
    expect(src.mdls.map((m) => m.mdl)).toEqual(["2001", "2002"]);
    expect(p.lanes).toHaveLength(2);
    expect(p.national).toHaveLength(1);
  });

  it("keeps unverified fiscal-year points out of the line and leaves gaps unjoined", () => {
    const l = p.lanes[0]!;
    expect(l.pendingFy).toEqual({ start: 2023, values: [10] });
    expect(l.pendingMonthly).toEqual({ start: 2024 * 12 + 9, values: [100, 120, null, 150] });
    const pts = pendingPoints(l);
    expect(pts.map((x) => [x[1], x[2]])).toEqual([
      [10, 0],
      [100, 0], // FY2023 → Oct 2024: FY2024 is missing, so no join
      [120, 1],
      [150, 0], // Dec 2024 report missing
    ]);
    expect(l.latest).toMatchObject({ value: 150, fy: false });
    expect(l.peak?.value).toBe(150);
    expect(l.docket).toEqual({ start: 2025, values: [5, 7], partial: 2026 });
    expect(l.activity12).toBe(6);
    expect(l.start).toBeCloseTo(dateIndex("2023-04-02")!);
  });

  it("joins a fiscal-year end to the next month's report", () => {
    const pts = pendingPoints({ pendingFy: { start: 2024, values: [5] }, pendingMonthly: { start: 2024 * 12 + 9, values: [6] } });
    expect(pts.map((x) => x[2])).toEqual([0, 1]);
  });

  it("round-trips the positional wire format", () => {
    const back = fromWire(toWire(p));
    expect(back.lanes).toEqual(p.lanes);
    expect(JSON.stringify(toWire(p)).length).toBeLessThan(JSON.stringify(p).length);
  });

  it("sorts with unrecorded values last and filters by facet", () => {
    expect(sortLanes(p.lanes, "size").map((l) => l.mdl)).toEqual(["2001", "2002"]);
    expect(sortLanes(p.lanes, "activity").map((l) => l.mdl)).toEqual(["2001", "2002"]);
    expect(sortLanes(p.lanes, "start").map((l) => l.mdl)).toEqual(["2001", "2002"]);
    const f = laneFacets(p.lanes);
    expect(f.court.map((c) => c[0])).toContain("NYS (as printed by the JPML)");
    expect(filterLanes(p.lanes, { court: "S.D. New York" }).map((l) => l.mdl)).toEqual(["2001"]);
    expect(filterLanes(p.lanes, { q: "MDL No. 2002" }).map((l) => l.mdl)).toEqual(["2002"]);
    expect(filterLanes(p.lanes, { status: "terminated" }).map((l) => l.mdl)).toEqual(["2002"]);
  });

  it("rolls derived rows up exactly like the lanes RPC", () => {
    const rows = rollupForLanes(
      [
        { mdl: "1", ...row("docket_entries", "2025-09", 1) },
        { mdl: "1", ...row("docket_entries", "2025-10", 2) },
        { mdl: "1", ...row("docket_entries", "2026-09", 3) },
        { mdl: "1", ...row("docket_entries", "2026-10", 4, "x:partial_month") },
        { mdl: "1", ...row("filings_year", "2026-01", 5, "y:partial") },
        { mdl: "1", ...row("jpml_pending", "2026-10", 9) },
      ],
      "2026-10-23",
    );
    const get = (s: string) => rows.filter((r) => r[1] === s).map((r) => [r[2], r[3], r[4]]);
    expect(get("docket_entries")).toEqual([
      ["2025", 3, ""],
      ["2026", 7, "partial"],
    ]);
    expect(get("docket_entries_12m")).toEqual([["2025-10/2026-10", 5, ""]]);
    expect(get("filings")).toEqual([["2026", 5, "partial"]]);
    expect(get("jpml_pending")).toEqual([["2026-10", 9, ""]]);
  });

  it("serves the historical scope one decade at a time", () => {
    const hist = assembleLanes(
      parseLanesSource({
        ...SRC,
        scope: "historical",
        mdls: [
          { mdl: "10", src: { t: { termination_year: 1975 } } },
          { mdl: "11", src: { x: { caption: "B" } } },
          { mdl: "12", src: { t: { termination_year: 1999 } } },
        ],
        rows: [["11", "jpml_fy_pending", "1994-09", 3, "jpml_fy_statistical_analysis"]] as CompactRow[],
      })!,
      "precomputed",
    );
    expect(hist.lanes.map(laneDecade)).toEqual([1970, 1990, 1990]);
    const d = byDecade(hist, null);
    expect(d.decades).toEqual([
      [1990, 2],
      [1970, 1],
    ]);
    expect(d.payload.lanes.map((l) => l.mdl)).toEqual(["11", "12"]);
    expect(byDecade(hist, 1970).payload.lanes.map((l) => l.mdl)).toEqual(["10"]);
  });
});

const AUTH = (key: string, filings: number, extra: Record<string, unknown> = {}) => ({
  key,
  kind: key.startsWith("record") ? "case" : "usc",
  class: key.startsWith("record") ? "scotus" : "usc",
  label: key,
  filings,
  mentions: filings + 1,
  ...extra,
});

describe("citations", () => {
  it("parses the map, links each authority to its page and drops edges to unknown nodes", () => {
    const m = parseCitationMap({
      mdl: "2001",
      meta: { filings: 4, with_text: 3, citing: 2, cites_unresolved: 1, cites_ambiguous: 0 },
      distinct_authorities: 3,
      authorities: [AUTH("record|caselaw/111", 2), AUTH("law_unit|usc:28:1407", 2), { key: "nope", filings: 1 }],
      edges: [
        ["law_unit|usc:28:1407", "record|caselaw/111", 2],
        ["record|caselaw/111", "record|caselaw/999", 3],
      ],
    })!;
    expect(m.authorities.map((a) => a.href)).toEqual(["/cases/111", "/law/uscode/28/1407"]);
    expect(m.edges).toEqual([["law_unit|usc:28:1407", "record|caselaw/111", 2]]);
    expect(m.meta?.citesUnresolved).toBe(1);
    expect(parseCitationMap({})).toBeNull();
  });

  it("clusters by class and compares two MDLs by share of citing filings", () => {
    const g = parseCitationGrid({
      mdls: [
        { mdl: "1", citing: 10, title: "A" },
        { mdl: "2", citing: 4, title: "B" },
      ],
      authorities: [AUTH("record|caselaw/1", 6), AUTH("law_unit|usc:28:1407", 5), AUTH("record|caselaw/2", 1)],
      cells: [
        ["record|caselaw/1", "1", 5],
        ["record|caselaw/1", "2", 1],
        ["law_unit|usc:28:1407", "1", 5],
        ["record|caselaw/2", "2", 1],
        ["record|caselaw/2", "9", 1],
      ],
    })!;
    expect(g.cells).toHaveLength(4);
    expect(clusterAuthorities(g.authorities).map((c) => [c.cls, c.items.length])).toEqual([
      ["scotus", 2],
      ["usc", 1],
    ]);
    const cmp = compareMdls(g, "1", "2");
    expect(cmp.map((r) => [r.key, r.both, r.shareA, r.shareB])).toEqual([
      ["record|caselaw/1", true, 50, 25],
      ["law_unit|usc:28:1407", false, 50, 0],
      ["record|caselaw/2", false, 0, 25],
    ]);
  });

  it("parses a filing's citations with its MDL context", () => {
    const f = parseFilingCitations({
      document: "d_000000000000000000000001",
      mdl: "2001",
      text_status: "text_layer",
      mdl_citing: 2,
      authorities: [{ ...AUTH("record|caselaw/111", 0), mentions: 3, first_page: 2, mdl_filings: 2, all_filings: 5 }],
    })!;
    expect(f.authorities[0]).toMatchObject({ mentions: 3, firstPage: 2, mdlFilings: 2, allFilings: 5 });
  });
});

describe("court tree", () => {
  const level = parseCourtLevel({
    type: "circuit",
    id: "ca2",
    nodes: [
      { type: "court", id: "nysd", label: "S.D.N.Y.", href: "/courts/nysd", children: 46, metrics: { usc_civil_pending: [13326, "2026-06-30", "court"] } },
      { type: "court", id: "vtd", label: "D. Vt.", href: "//evil", children: 5, metrics: { usc_civil_pending: [396, "2025-06-30", "court"] } },
      { type: "judges", id: "ca2", label: "Judges", children: 28 },
      { type: "planet", id: "x", label: "x" },
    ],
    catalog: { usc_civil_pending: { label: "Civil cases pending", unit: "cases", format: "count", source_links: [{ label: "U.S. Courts", url: "https://www.uscourts.gov" }] } },
  })!;

  it("parses nodes, refusing unknown types and unsafe links", () => {
    expect(level.nodes.map((n) => n.id)).toEqual(["nysd", "vtd", "ca2"]);
    expect(level.nodes[1]!.href).toBeNull();
    expect(level.catalog["usc_civil_pending"]!.sources).toHaveLength(1);
  });

  it("finds each node's child level", () => {
    expect(childLevel(level.nodes[0]!)).toEqual({ type: "court", id: "nysd" });
    expect(childLevel(level.nodes[2]!)).toEqual({ type: "judges", id: "ca2" });
    expect(childLevel({ type: "judge", id: "j", children: 0 })).toBeNull();
  });

  it("flags a sibling whose latest period is older than the others'", () => {
    const m = metricFor(level.nodes, "usc_civil_pending");
    expect(m.get("court:nysd")).toEqual({ value: 13326, period: "2026-06-30", stale: false });
    expect(m.get("court:vtd")?.stale).toBe(true);
    expect(m.get("judges:ca2")).toEqual({ value: null, period: null, stale: false });
  });
});

describe("product signals", () => {
  const detail = parseMdlDetail(
    {
      mdl: "3081",
      today: "2026-10-23",
      src: { m: { title: "Ports", date_transferred: "2023-08-08" }, products: [{ dataset: "fda_device_event_series", id: "3081", product: "Ports" }] },
      rows: [row("maude_reports", "2024-01", 40, "calendar_year_total"), row("docket_entries", "2024-02", 3), row("jpml_pending", "2024-10", 9)],
    },
    "precomputed",
  )!;

  it("uses the FDA product series when SAFETY's RPC is absent", () => {
    const s = productSignals(detail, null);
    expect(s.agencySource).toBe("fda_product_series");
    expect(s.rows.map((r) => r.series)).toEqual(["maude_reports", "docket_entries"]);
    expect(s.centralized).toBe("2023-08-08");
  });

  it("lets SAFETY's rows replace the agency series and keeps the litigation rows", () => {
    const m = mergeSignalRows(detail.rows, [row("fda_enforcement_reports", "2024-03", 2)]);
    expect(m.agencySource).toBe("product_signals_v1");
    expect(m.rows.map((r) => r.series)).toEqual(["fda_enforcement_reports", "docket_entries"]);
    expect(mergeSignalRows([row("docket_entries", "2024-02", 3)], []).agencySource).toBeNull();
  });
});
