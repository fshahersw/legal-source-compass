// Isolated PostgreSQL contract tests for database/contracts/litviz-v1.sql. No credentials, network or live corpus: a
// throwaway in-memory PGlite database with the corpus objects the contract reads, filled with synthetic rows.
// The series and label derivations are also run through their TypeScript twin (src/lib/litviz/derive.ts, transpiled
// here with the repository's TypeScript) and must produce identical rows.
// Run: node --test src/lib/litviz/contract.test.mjs   (from the repository root)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve(
    "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
  );
const { PGlite } = await import(pathToFileURL(runtime).href);
const ts = (await import("typescript")).default;

async function importTs(file) {
  const source = await fs.readFile(file, "utf8");
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(out).toString("base64")}`);
}
const derive = await importTs("src/lib/litviz/derive.ts");

const TODAY = "2026-10-23";

const MOCK = `
create role anon; create role authenticated; create role service_role;
create table public.corpus_records (dataset text, id text, title text, source_url text, item jsonb, detail jsonb,
  filters jsonb, ordinal bigint, primary key (dataset, id));
create table public.corpus_datasets (id text primary key, metadata jsonb, ready boolean default true);
create schema documents;
create table documents.documents (id text primary key, source_system text, native_document_id text, native_case_id text,
  sha256 text, mdl text, court_id text, filed_date date, text_status text);
create table documents.links (document_id text, to_type text, to_id text, relation text, evidence text, mentions integer,
  first_page integer, pages integer[], primary key (document_id, to_type, to_id, relation));
create table documents.extractions (sha256 text, page integer, start_offset integer, kind text, resolution text,
  primary key (sha256, page, start_offset, kind));
create function documents.is_open(p_source text, p_native text) returns boolean language sql immutable as
  $$ select p_native <> 'closed-native' $$;
create schema caselaw;
create table caselaw.cases (cluster_id bigint primary key, tier smallint, court_id text, date_filed date, case_name text,
  citations text[]);
create table caselaw.courts (court_id text primary key, tier smallint, short_name text);
create schema insights;
create table insights.entities (entity_type text, entity_id text, label text, parent_type text, parent_id text, keys jsonb,
  href text, primary key (entity_type, entity_id));
create table insights.facts (metric_id text, entity_type text, entity_id text, period text, period_start date,
  period_end date, value numeric, partial boolean default false, primary key (metric_id, entity_type, entity_id, period));
create table insights.metrics (id text primary key, label text, unit text, format text, period_type text,
  source_links jsonb default '[]', source_datasets text[] default '{}');
`;

const rec = (dataset, id, item, extra = {}) => ({ dataset, id, item, ...extra });
const RECORDS = [
  // A. monthly reports: a gap month, a point without a number, a bad month key
  rec("jpml_pending_history_mdls", "2001", {
    history: {
      title: "IN RE: Widget Products Liability Litigation",
      type: "Products Liability",
      judge: "Ada Lovelace",
      district: "NYS",
      date_filed: "2023-01-05",
      date_transferred: "2023-04-02",
      exit_status: "pending",
      last_report: "2025-01-02",
      closed_evidence: null,
      series: [
        { month: "2024-10", pending: 100, source_url: "https://example.gov/oct.pdf" },
        { month: "2024-11", pending: 120, source_url: "https://example.gov/nov.pdf" },
        { month: "2024-12", pending: null },
        { month: "2025-1", pending: 3 },
        { month: "2025-01", pending: 150, source_url: 7 },
      ],
    },
  }),
  rec("jpml_pending_history_mdls", "2002", {
    history: {
      title: "IN RE: Gadget Antitrust Litigation",
      exit_status: "terminated",
      date_closed: "2025-07-08",
      closed_evidence: { url: "https://example.gov/terminated.pdf" },
      series: [{ month: "2024-10", pending: 4, source_url: "https://example.gov/oct.pdf" }],
    },
  }),
  rec("jpml_pending_history_mdls", "bad", { history: { series: [{ month: "2024-10", pending: 1 }] } }),
  rec("mdls", "2001", {
    title: "IN RE: Widget Products Liability Litigation",
    status: "pending",
    litigation_type: "Products Liability",
    cl_court_id: "nysd",
    court_name: "S.D. New York",
    judge_name_as_printed: "Ada Lovelace",
    judge_profile_id: "0123456789abcdef0123456789abcdef",
    judge_match_kind: "exact",
    date_transferred: "2023-04-02",
    actions_pending: 150,
    total_actions: 160,
    as_of: "2026-10-01",
  }),
  rec("mdls", "2003", {
    title: "IN RE: Sprocket Litigation",
    status: "pending",
    judge_name_as_printed: "Grace Hopper",
    judge_profile_id: "fedcba9876543210fedcba9876543210",
    judge_match_kind: "middle_initial",
    actions_pending: 9,
  }),
  rec("mdl_analytics", "2001", { title: "Widget", analytics: { mass_tort: true, type: "Products Liability" } }),
  rec("mdl_analytics", "summary:overview", { overview: {} }),
  // B. fiscal-year editions and per-MDL history (verified, unverified, the 15-month FY1992)
  rec("jpml_statistics_extra", "fy:1992", { fy_stats: { pending: 37253 } }, { source_url: "https://example.gov/fy1992.pdf" }),
  rec("jpml_statistics_extra", "fy:2017", { fy_stats: { pending: 120000 } }, { source_url: "https://example.gov/fy2017.pdf" }),
  rec("jpml_statistics_extra", "fy:2018", { fy_stats: {} }, { source_url: "https://example.gov/fy2018.pdf" }),
  rec("jpml_statistics_extra", "mdl:2001", {
    title: "Widget PL",
    fy_history: {
      judge: "Lovelace, A.",
      series: [
        { fy: 2017, pending: 10, closed: 1, remanded: 0, attribution: "verified", district: "New York Southern" },
        { fy: 2018, pending: 20, closed: 2, attribution: "unverified", district: "New York Southern" },
        { fy: 2018, pending: 21, attribution: "verified", district: "Second Part" },
        { fy: "x", pending: 5 },
      ],
    },
  }),
  rec("jpml_statistics_extra", "mdl:1500", {
    title: "Old Asbestos PL",
    fy_history: {
      series: [{ fy: 1992, pending: 33000, closed: 400, remanded: 3, attribution: "verified", district: "Pennsylvania Eastern" }],
    },
  }),
  // C. FJC, partial FY after the snapshot
  rec(
    "fjc_civil_mdls",
    "mdl:2001",
    { profile: { by_fy: [{ fy: 2025, cases: 30 }, { fy: 2026, cases: 12 }, { fy: 2027, cases: "n/a" }] } },
    { source_url: "https://www.fjc.gov/research/idb" },
  ),
  rec("fjc_civil_mdls", "mdl:0", { profile: { by_fy: [{ fy: 2025, cases: 1 }] } }),
  // terminated-litigation tables (historical scope)
  rec("mdl_terminated_history", "1500:a", { history: { mdl: 1500, termination_year: 1999, district_name: "Pennsylvania Eastern" } }),
  rec("mdl_terminated_history", "1500:b", { history: { mdl: 1500, termination_year: 2004, district_name: "Ohio Northern" } }),
  rec("mdl_terminated_history", "1501:a", { history: { mdl: 1501, termination_year: 2010, district_name: "Texas Western" } }),
  rec("mdl_terminated_history", "1501:b", { history: { mdl: 1501, termination_year: 2010, district_name: "Alabama Middle" } }),
  // D. docket entries (sw covers 2001; activity used only for 2003)
  ...[
    ["e1", "2026-07-03"],
    ["e2", "2026-07-30"],
    ["e3", "2026-09-01"],
    ["e4", null],
    ["e5", "2027-01-01"],
    ["e6", "2026-10-02"],
  ].map(([id, date]) =>
    rec("sw_docket_entries_v1", id, {
      cells: { mdl: "2001", date_filed: date, source_url: "https://www.courtlistener.com/docket/9/" },
    }),
  ),
  rec("mdl_docket_activity", "a1", { cells: { mdl: "2001", published_at: "2026-01-02" } }, { source_url: "https://cl/a" }),
  rec("mdl_docket_activity", "a2", { cells: { mdl: "2003", published_at: "2025-11-20" } }, { source_url: "https://cl/b" }),
  rec("mdl_docket_activity", "a3", { cells: { mdl: "2003", published_at: "" } }, { source_url: "https://cl/b" }),
  rec("mdl_docket_activity", "a4", { cells: { mdl: "2003", published_at: "2026-01-15" } }, { source_url: "https://cl/a" }),
  // F/G. FDA product series naming the MDL; the national row names none
  rec(
    "fda_faers_product_series",
    "2001",
    {
      mdl: 2001,
      product: "Widgetol",
      data_through: "2026-06-30",
      series: [
        { year: 2025, reports: 40, partial: false },
        { year: 2026, reports: 9, partial: true },
      ],
    },
    { source_url: "https://api.fda.gov/drug/event.json?search=x" },
  ),
  rec("fda_device_event_series", "national", { mdl: null, series: [{ year: 2025, reports: 1 }] }),
  rec("mdl_intel_jpml_stats", "year:2025", { kind: "year", stats: { year: 2025, motions_granted: 18 } }, { source_url: "https://example.gov/cy2025.pdf" }),
  rec("mdl_intel_jpml_stats", "summary", { kind: "summary" }),
  rec("us_code_sections", "28:1407", {}, { title: "28 U.S.C. § 1407 Multidistrict litigation" }),
  rec("federal_regulations_parts", "cfr:21:314", {}, { title: "Applications for FDA Approval to Market a New Drug" }),
];

const DOCS = [
  ["d_000000000000000000000001", "a", "2001", "2026-08-03", "text_layer"],
  ["d_000000000000000000000002", "b", "2001", "2026-10-01", "partial_text"],
  ["d_000000000000000000000003", "c", "2001", null, "no_text_layer"],
  ["d_000000000000000000000004", "closed-native", "2001", "2026-08-09", "text_layer"],
  ["d_000000000000000000000005", "e", "2003", "2026-05-05", "text_layer"],
];
const LINKS = [
  ["d_000000000000000000000001", "record", "caselaw/111", 3],
  ["d_000000000000000000000001", "law_unit", "usc:28:1407", 2],
  ["d_000000000000000000000002", "record", "caselaw/111", 1],
  ["d_000000000000000000000002", "law_unit", "usc:28:1407", 1],
  ["d_000000000000000000000002", "law_unit", "cfr:21:314", 4],
  ["d_000000000000000000000004", "record", "caselaw/222", 9],
  ["d_000000000000000000000005", "record", "caselaw/222", 1],
];

async function setup() {
  const db = new PGlite();
  await db.exec(MOCK);
  for (const r of RECORDS)
    await db.query(
      "insert into public.corpus_records (dataset, id, title, source_url, item) values ($1, $2, $3, $4, $5)",
      [r.dataset, r.id, r.title ?? null, r.source_url ?? null, JSON.stringify(r.item)],
    );
  await db.query("insert into public.corpus_datasets (id, metadata) values ($1, $2)", [
    "fjc_civil_mdls",
    JSON.stringify({ summary: { snapshot: "cv88on.zip, last modified 2026-08-26; filing dates through 2026-06-30" } }),
  ]);
  for (const [id, nat, mdl, date, status] of DOCS)
    await db.query(
      "insert into documents.documents values ($1, 'courtlistener', $2, 'c', $3, $4, 'nysd', $5, $6)",
      [id, nat, `sha-${id}`, mdl, date, status],
    );
  for (const [doc, type, to, mentions] of LINKS)
    await db.query(
      "insert into documents.links values ($1, $2, $3, 'cites', 'exact_id', $4, 1, '{1}')",
      [doc, type, to, mentions],
    );
  await db.exec(`
    insert into documents.links values ('d_000000000000000000000001', 'mdl', '2001', 'mentions', 'exact_id', 1, 1, '{1}');
    insert into documents.extractions values ('sha-d_000000000000000000000001', 1, 10, 'case_citation', 'unresolved'),
      ('sha-d_000000000000000000000001', 2, 10, 'case_citation', 'ambiguous'), ('sha-d_000000000000000000000001', 2, 50, 'case_citation', 'resolved');
    insert into caselaw.cases values (111, 1, 'scotus', '1993-06-28', 'Daubert v. Merrell Dow Pharmaceuticals, Inc.',
      array['1993 U.S. LEXIS 4408', '509 U.S. 579']),
      (222, 2, 'ca6', '2019-08-05', 'Frye v. Rail Co.', array['933 F.3d 591']);
    insert into caselaw.courts values ('scotus', 1, 'Supreme Court'), ('ca6', 2, 'Sixth Circuit');
    insert into insights.entities values
      ('nation', 'US', 'United States', null, null, '{}', '/places'),
      ('court', 'scotus', 'Supreme Court of the United States', 'nation', 'US', '{"court_type":"F"}', '/courts/scotus'),
      ('circuit', 'ca2', 'Court of Appeals for the Second Circuit', 'nation', 'US', '{}', '/courts/ca2'),
      ('circuit', 'cadc', 'Court of Appeals for the D.C. Circuit', 'nation', 'US', '{}', '/courts/cadc'),
      ('court', 'ca2', 'Court of Appeals for the Second Circuit', 'nation', 'US', '{"court_type":"F"}', '/courts/ca2'),
      ('court', 'nysd', 'District Court, S.D. New York', 'circuit', 'ca2', '{"court_type":"FD"}', '/courts/nysd'),
      ('court', 'nyed', 'District Court, E.D. New York', 'circuit', 'ca2', '{"court_type":"FD"}', '/courts/nyed'),
      ('judge', 'j1', 'Ada Lovelace', 'court', 'nysd', '{"judge_profile":"0123456789abcdef0123456789abcdef"}', '/judges/0123456789abcdef0123456789abcdef'),
      ('judge', 'j2', 'Grace Hopper', 'court', 'nysd', '{"judge_profile":"fedcba9876543210fedcba9876543210"}', '/judges/fedcba9876543210fedcba9876543210'),
      ('judge', 'j3', 'Appellate Judge', 'court', 'ca2', '{}', '/judges/x'),
      ('judge', 'j4', 'A Justice', 'court', 'scotus', '{}', '/judges/y'),
      ('state', 'NY', 'New York', 'nation', 'US', '{}', '/places/NY'),
      ('state', 'WY', 'Wyoming', 'nation', 'US', '{}', '/places/WY'),
      ('court', 'ny', 'New York Court of Appeals', 'state', 'NY', '{"court_type":"S"}', '/courts/ny'),
      ('court', 'nyappdiv', 'Appellate Division', 'state', 'NY', '{"court_type":"SA"}', '/courts/nyappdiv'),
      ('court', 'nytrial', 'Albany City Court', 'state', 'NY', '{"court_type":"ST"}', '/courts/nytrial'),
      ('court', 'wytrial', 'Laramie Court', 'state', 'WY', '{"court_type":"ST"}', '/courts/wytrial');
    insert into insights.metrics (id, label, unit, format, period_type) values
      ('usc_civil_pending', 'Civil cases pending', 'cases', 'count', 'twelve_months_ending'),
      ('caselaw_opinion_clusters', 'Court opinions filed', 'opinion clusters', 'count', 'year');
    insert into insights.facts values
      ('usc_civil_pending', 'court', 'nysd', '2025-06-30', '2024-07-01', '2025-06-30', 1000, false),
      ('usc_civil_pending', 'court', 'nysd', '2026-06-30', '2025-07-01', '2026-06-30', 1200, false),
      ('usc_civil_pending', 'court', 'nysd', '2026-09-30', '2025-10-01', '2026-09-30', 9999, true),
      ('usc_civil_pending', 'circuit', 'ca2', '2026-06-30', '2025-07-01', '2026-06-30', 3000, false),
      ('usc_civil_pending', 'court', 'ca2', '2026-06-30', '2025-07-01', '2026-06-30', 1, false),
      ('caselaw_opinion_clusters', 'court', 'ca2', '2025', '2025-01-01', '2025-12-31', 800, false),
      ('caselaw_opinion_clusters', 'court', 'ny', '2025', '2025-01-01', '2025-12-31', 300, false);
  `);
  const sql = await fs.readFile("database/contracts/litviz-v1.sql", "utf8");
  await db.exec(sql);
  return db;
}

const db = await setup();
const json = async (q, params = []) => (await db.query(q, params)).rows[0]?.v ?? null;

const norm = (rows) =>
  rows
    .map((r) => ({ ...r, value: r.value === null ? null : Number(r.value) }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

const of = (dataset) => RECORDS.filter((r) => r.dataset === dataset).map((r) => ({ id: r.id, source_url: r.source_url ?? null, item: r.item, dataset }));

function tsSeriesRows() {
  const editions = of("jpml_statistics_extra");
  const filingCounts = new Map();
  for (const [, , mdl, date] of DOCS) {
    if (!date) continue;
    const k = `${mdl}|${date.slice(0, 7)}`;
    filingCounts.set(k, (filingCounts.get(k) ?? 0) + 1);
  }
  const project = (dataset, dateField, urlOf) =>
    RECORDS.filter((r) => r.dataset === dataset).map((r) => ({
      mdl: r.item.cells?.mdl,
      date: r.item.cells?.[dateField],
      url: urlOf(r),
    }));
  return [
    ...derive.jpmlMonthlyRows(of("jpml_pending_history_mdls")),
    ...derive.fyRows(editions, derive.fyEditionUrls(editions)),
    ...derive.fjcRows(of("fjc_civil_mdls"), derive.fjcThrough("… filing dates through 2026-06-30")),
    ...derive.docketRows(
      project("sw_docket_entries_v1", "date_filed", (r) => r.item.cells?.source_url ?? null),
      project("mdl_docket_activity", "published_at", (r) => r.source_url ?? null),
      TODAY,
    ),
    ...derive.filingRowsMonthly(
      [...filingCounts].map(([k, n]) => ({ mdl: k.split("|")[0], month: k.split("|")[1], n })),
      TODAY,
    ),
    ...derive.productRows([...of("fda_faers_product_series"), ...of("fda_device_event_series")]),
    ...derive.nationalRows(editions, of("mdl_intel_jpml_stats")),
  ];
}

test("series rows: the SQL and the TypeScript twin agree row for row", async () => {
  const sqlRows = (await db.query("select * from litviz.series_rows($1::date)", [TODAY])).rows;
  const tsRows = tsSeriesRows();
  assert.deepEqual(norm(sqlRows), norm(tsRows));
  assert.ok(sqlRows.length > 20);
});

test("label fields: the SQL and the TypeScript twin agree", async () => {
  const sqlRows = (await db.query("select mdl, scope, src from litviz.source_rows() order by mdl::integer")).rows;
  const tsRows = derive.sourceRows({
    mdls: of("mdls"),
    history: of("jpml_pending_history_mdls"),
    analytics: of("mdl_analytics"),
    fy: of("jpml_statistics_extra"),
    terminated: of("mdl_terminated_history"),
    products: [...of("fda_faers_product_series"), ...of("fda_device_event_series")],
  });
  assert.deepEqual(sqlRows, tsRows);
  const byMdl = Object.fromEntries(sqlRows.map((r) => [r.mdl, r]));
  assert.equal(byMdl["1500"].scope, "historical");
  assert.deepEqual(byMdl["1500"].src.t, { termination_year: 2004, district: "Ohio Northern" });
  assert.deepEqual(byMdl["1501"].src.t, { termination_year: 2010, district: "Alabama Middle" });
  assert.equal(byMdl["2001"].src.x.district, "New York Southern", "first line of the latest FY");
  assert.equal(byMdl["2002"].src.h.closed_url, "https://example.gov/terminated.pdf");
  assert.equal(byMdl["2001"].src.products[0].product, "Widgetol");
});

test("series rules on the fixture: gaps stay gaps, partial and unverified are marked, zero-fill stays in span", async () => {
  const rows = (await db.query("select * from litviz.series_rows($1::date) where mdl = '2001'", [TODAY])).rows;
  const get = (series) => rows.filter((r) => r.series === series).map((r) => [r.month, Number(r.value), r.basis]);
  assert.deepEqual(
    get("jpml_pending").map((r) => r[0]),
    ["2024-10", "2024-11", "2025-01"],
  );
  assert.deepEqual(get("docket_entries"), [
    ["2026-07", 2, "master_docket:collected_entries"],
    ["2026-08", 0, "master_docket:collected_entries"],
    ["2026-09", 1, "master_docket:collected_entries"],
    ["2026-10", 1, "master_docket:collected_entries:partial_month"],
  ]);
  assert.ok(rows.every((r) => r.source_dataset !== "mdl_docket_activity"), "sw covers 2001: activity is not added");
  assert.deepEqual(
    get("jpml_fy_pending").map((r) => [r[0], r[1], r[2]]),
    [
      ["2017-09", 10, "jpml_fy_statistical_analysis"],
      ["2018-09", 21, "jpml_fy_statistical_analysis"],
    ],
    "one line per fiscal year, the verified one preferred",
  );
  assert.deepEqual(get("fjc_idb_cases").map((r) => r[2]), [
    "fjc_idb:historical_association",
    "fjc_idb:historical_association:partial",
  ]);
  assert.deepEqual(get("filings").map((r) => [r[0], r[1]]), [
    ["2026-08", 2],
    ["2026-09", 0],
    ["2026-10", 1],
  ]);
});

test("refresh builds every table and the read RPCs return bounded, typed payloads", async () => {
  const before = await json("select public.litviz_mdl_lanes_v1('reported') as v");
  assert.equal(before, null, "null until the first refresh");
  const counts = await json("select public.litviz_refresh_v1($1::date) as v", [TODAY]);
  assert.ok(counts.series_rows > 20 && counts.mdls >= 4, JSON.stringify(counts));

  const lanes = await json("select public.litviz_mdl_lanes_v1('reported') as v");
  assert.deepEqual(lanes.mdls.map((m) => m.mdl), ["2001", "2002", "2003"]);
  const rows2001 = lanes.rows.filter((r) => r[0] === "2001");
  assert.ok(rows2001.some((r) => r[1] === "docket_entries" && r[2] === "2026" && Number(r[3]) === 4 && r[4] === "partial"));
  assert.ok(rows2001.some((r) => r[1] === "docket_entries_12m" && r[2] === "2025-10/2026-10" && Number(r[3]) === 3));
  assert.ok(lanes.national.some((r) => r.series === "jpml_motions_granted" && Number(r.value) === 18));
  const hist = await json("select public.litviz_mdl_lanes_v1('historical') as v");
  assert.deepEqual(hist.mdls.map((m) => m.mdl), ["1500", "1501"]);

  const one = await json("select public.litviz_mdl_series_v1('2001') as v");
  assert.equal(one.scope, "reported");
  assert.equal(one.meta.docket_total, 6);
  assert.equal(one.meta.docket_undated, 2, "a missing date and a future date");
  assert.equal(one.meta.filings, 4);
  assert.equal(one.meta.filings_undated, 1);
  assert.equal(one.meta.citing, 2, "the closed document's citations are not counted");
  assert.equal(one.meta.cites_unresolved, 1);
  assert.equal(one.meta.cites_ambiguous, 1);
  assert.equal((await json("select public.litviz_mdl_series_v1('9999') as v")).src, null);

  const cit = await json("select public.litviz_citations_v1('2001', 30) as v");
  assert.deepEqual(
    cit.authorities.map((a) => [a.key, a.filings, a.class, a.label]),
    [
      ["record|caselaw/111", 2, "scotus", "Daubert v. Merrell Dow Pharmaceuticals, Inc."],
      ["law_unit|usc:28:1407", 2, "usc", "28 U.S.C. § 1407"],
      ["law_unit|cfr:21:314", 1, "cfr", "21 C.F.R. part 314"],
    ],
    "by filings citing, then mentions",
  );
  assert.equal(cit.authorities[0].cite, "509 U.S. 579", "LEXIS cites are skipped");
  assert.equal(cit.authorities[0].mentions, 4);
  assert.equal(cit.authorities[1].heading, "Multidistrict litigation");
  assert.deepEqual(cit.edges, [["law_unit|usc:28:1407", "record|caselaw/111", 2]]);
  assert.ok(!JSON.stringify(cit).includes("caselaw/222"), "the closed document's citation is excluded");

  const grid = await json("select public.litviz_citation_grid_v1(null, 30) as v");
  assert.deepEqual(grid.mdls.map((m) => m.mdl), ["2001", "2003"]);
  assert.ok(grid.cells.some((c) => c[0] === "record|caselaw/222" && c[1] === "2003" && c[2] === 1));
  const pair = await json("select public.litviz_citation_grid_v1(array['2003'], 5) as v");
  assert.deepEqual(pair.authorities.map((a) => a.key), ["record|caselaw/222"]);

  const filing = await json("select public.litviz_filing_citations_v1('d_000000000000000000000002') as v");
  assert.deepEqual(
    filing.authorities.map((a) => [a.key, a.mentions, a.mdl_filings, a.all_filings]),
    [
      ["law_unit|cfr:21:314", 4, 1, 1],
      ["law_unit|usc:28:1407", 1, 2, 2],
      ["record|caselaw/111", 1, 2, 2],
    ],
  );
  assert.equal(await json("select public.litviz_filing_citations_v1('d_000000000000000000000004') as v"), null);
});

test("court hierarchy: levels, latest complete facts, exact-profile judge MDLs, state systems", async () => {
  const root = await json("select public.litviz_court_children_v1('root') as v");
  assert.deepEqual(root.nodes.map((n) => [n.type, n.id, n.children]), [
    ["court", "scotus", 2],
    ["states", "US", 1],
  ]);
  const circuits = await json("select public.litviz_court_children_v1('court', 'scotus') as v");
  assert.deepEqual(circuits.nodes.map((n) => [n.type, n.id]), [
    ["circuit", "ca2"],
    ["circuit", "cadc"],
    ["judges", "scotus"],
  ]);
  const ca2 = circuits.nodes[0];
  assert.deepEqual(ca2.metrics.usc_civil_pending, [3000, "2026-06-30", "circuit"], "circuit-level fact preferred");
  assert.deepEqual(ca2.metrics.caselaw_opinion_clusters, [800, "2025", "court"]);
  assert.equal(ca2.children, 3, "two district courts and the appellate judges group");
  const districts = await json("select public.litviz_court_children_v1('circuit', 'ca2') as v");
  assert.deepEqual(districts.nodes.map((n) => n.id), ["nyed", "nysd", "ca2"]);
  const nysd = districts.nodes.find((n) => n.id === "nysd");
  assert.deepEqual(nysd.metrics.usc_civil_pending, [1200, "2026-06-30", "court"], "partial period skipped");
  assert.equal(districts.catalog.usc_civil_pending.label, "Civil cases pending");
  const judges = await json("select public.litviz_court_children_v1('court', 'nysd') as v");
  assert.deepEqual(judges.nodes.map((n) => [n.id, n.judge ?? null]), [
    ["j1", { pending_mdls: 1, actions_pending: 150, as_of: "2026-10-01" }],
    ["j2", null],
  ]);
  const states = await json("select public.litviz_court_children_v1('states') as v");
  assert.deepEqual(states.nodes.map((n) => [n.id, n.children]), [["NY", 2]]);
  const ny = await json("select public.litviz_court_children_v1('state', 'NY') as v");
  assert.deepEqual(ny.nodes.map((n) => [n.type, n.id, n.children]), [
    ["court", "ny", 0],
    ["court", "nyappdiv", 0],
    ["other_courts", "NY", 1],
  ]);
  assert.deepEqual(ny.nodes[0].metrics.caselaw_opinion_clusters, [300, "2025", "court"]);
});

test("inputs are validated with 22023 and nothing is executable by public roles", async () => {
  for (const q of [
    "select public.litviz_mdl_lanes_v1('everything')",
    "select public.litviz_mdl_series_v1('2001; drop')",
    "select public.litviz_citations_v1('2001', 500)",
    "select public.litviz_citation_grid_v1(array['x'], 5)",
    "select public.litviz_filing_citations_v1('nope')",
    "select public.litviz_court_children_v1('planet')",
    "select public.litviz_court_children_v1('state', 'new york')",
  ])
    await assert.rejects(db.query(q), (e) => e.code === "22023", q);
  const grants = (
    await db.query(`
      select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as auth,
             has_function_privilege('service_role', p.oid, 'execute') as svc, p.prosecdef, p.proconfig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname = 'public' and p.proname like 'litviz%') or n.nspname = 'litviz'`)
  ).rows;
  assert.ok(grants.length >= 12);
  for (const g of grants) {
    assert.equal(g.anon, false, g.proname);
    assert.equal(g.auth, false, g.proname);
    assert.equal(g.svc, true, g.proname);
    assert.ok((g.proconfig ?? []).some((c) => c === "search_path=\"\"" || c === "search_path="), g.proname);
    if (g.proname.startsWith("litviz_")) assert.equal(g.prosecdef, true, g.proname);
  }
});

test("the contract is idempotent: applying it twice and refreshing again keeps the same rows", async () => {
  const before = await json("select public.litviz_status_v1() as v");
  await db.exec(await fs.readFile("database/contracts/litviz-v1.sql", "utf8"));
  await json("select public.litviz_refresh_v1($1::date) as v", [TODAY]);
  const after = await json("select public.litviz_status_v1() as v");
  assert.equal(after.series_rows, before.series_rows);
  assert.deepEqual(after.by_series, before.by_series);
});
