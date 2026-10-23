// Offline PostgreSQL contract test for database/contracts/safety-signals-v1.sql (pglite). No credentials, network or
// live corpus: a throwaway in-memory database with the corpus objects the contract reads, filled with synthetic rows.
//   node --test scripts/safety_v2/safety-signals-contract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
const SQL = await fs.readFile("database/contracts/safety-signals-v1.sql", "utf8");

const MOCK = `
create role anon; create role authenticated; create role service_role;
create table public.corpus_records (dataset text not null, id text not null, title text, source_url text,
  item jsonb not null default '{}', filters jsonb not null default '{}', primary key (dataset, id));
create schema ingest;
create table ingest.sources (id text primary key, dataset text unique, label text, publisher text, source_url text,
  function_name text, schedule text, enabled boolean not null default false, stale_after interval, mode text,
  ordinal_policy text, category text, id_pattern text, catalog jsonb, terms_note text, rate_note text, updated_at timestamptz);
create table ingest.runs (id uuid primary key, source text, status text, inserted integer not null default 0,
  updated integer not null default 0, unchanged integer not null default 0);
`;

async function fresh() {
  const db = new PGlite();
  await db.exec(MOCK);
  await db.exec(SQL);
  return db;
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const load = (db, target, rows, opts = {}, meta = {}) =>
  one(db, "select public.safety_load_v1($1, $2::jsonb, $3::jsonb, $4::jsonb) as r", [
    target,
    JSON.stringify(rows),
    JSON.stringify(opts),
    JSON.stringify(meta),
  ]).then((x) => x.r);

const TITLE = "IN RE: Taxotere (Docetaxel) Products Liability Litigation";
const subject = (id, extra = {}) => ({
  id,
  subject_type: "mdl_group",
  kind: "drug",
  label: "Docetaxel (Taxotere)",
  keys: { generic_names: ["DOCETAXEL"] },
  search: { faers: 'patient.drug.openfda.generic_name.exact:"DOCETAXEL"' },
  source_id: "openfda_faers",
  source_url: "https://open.fda.gov/apis/drug/event/",
  ...extra,
});

test("applies twice, owns no bare DROP and no ';' directly before delete/drop/truncate", async () => {
  assert.doesNotMatch(SQL, /;\s*(truncate|delete|drop)\b/i);
  assert.doesNotMatch(SQL, /^\s*drop\s/im);
  const db = await fresh();
  await db.exec(SQL); // idempotent
  const n = await one(db, "select count(*)::int n from safety.sources");
  assert.equal(n.n, 12);
  const reg = await one(db, "select count(*)::int n from ingest.sources where id like 'safety_%'");
  assert.equal(reg.n, 3, "ingest sources registered when ingest/1 exists");
  const enabled = await one(db, "select bool_or(enabled) e from ingest.sources");
  assert.equal(enabled.e, false, "never enables a source");
});

test("functions are SECURITY DEFINER with an empty search_path and not executable by anon/authenticated", async () => {
  const db = await fresh();
  const rows = (
    await db.query(`select p.oid::regprocedure::text f, p.prosecdef, p.proconfig,
        has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth,
        has_function_privilege('service_role', p.oid, 'execute') svc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname = 'public' and p.proname like any (array['safety\\_%', 'product\\_signals\\_v1'])) or n.nspname = 'safety'`)
  ).rows;
  assert.ok(rows.length > 30);
  for (const r of rows) {
    assert.equal(r.anon, false, r.f);
    assert.equal(r.auth, false, r.f);
    assert.equal(r.svc, true, r.f);
    assert.ok((r.proconfig ?? []).includes('search_path=""'), `${r.f} search_path`);
    if (r.f.startsWith("public.")) assert.equal(r.prosecdef, true, `${r.f} security definer`);
  }
});

test("MDL links need every title token inside the stored official title", async () => {
  const db = await fresh();
  await load(db, "subjects", [subject("mdl:2740")]);
  const link = {
    mdl: 2740,
    subject_id: "mdl:2740",
    relation: "mdl_group",
    title: TITLE,
    title_tokens: ["Taxotere", "Docetaxel"],
    title_source_dataset: "mdls",
    title_source_url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
    basis: "title_names_product",
    basis_note: "The JPML title names Taxotere (Docetaxel).",
  };
  const r = await load(db, "mdl_subjects", [link]);
  assert.equal(r.inserted, 1);
  await assert.rejects(load(db, "mdl_subjects", [{ ...link, title_tokens: ["Taxotere", "Paclitaxel"] }]), /title token/);
  const again = await load(db, "mdl_subjects", [link]);
  assert.equal(again.unchanged, 1);
});

const seriesRow = (subject, series, from, to, vals, extra = {}) => ({
  subject_id: subject,
  series,
  unit: "reports",
  source_id: "openfda_faers",
  query_url: "https://api.fda.gov/drug/event.json?search=x&count=receivedate",
  method: "count=receivedate, summed by month",
  coverage_from: from,
  coverage_to: to,
  retrieved_at: "2026-10-23T00:00:00Z",
  vals,
  ...extra,
});

test("series load: one array row per series, exact window length, patches move the window", async () => {
  const db = await fresh();
  await load(db, "subjects", [subject("mdl:2740")]);
  let r = await load(db, "series", [seriesRow("mdl:2740", "faers_reports", "2024-01", "2024-03", [5, 0, 2])]);
  assert.deepEqual([r.inserted, r.updated, r.unchanged], [1, 0, 0]);
  r = await load(db, "series", [seriesRow("mdl:2740", "faers_reports", "2024-01", "2024-03", [5, 0, 2])]);
  assert.equal(r.unchanged, 1, "identical row left alone");
  await assert.rejects(load(db, "series", [seriesRow("mdl:2740", "faers_death", "2024-01", "2024-03", [1, 2])]), /one non-negative integer per month/);
  await assert.rejects(load(db, "series", [seriesRow("mdl:2740", "faers_death", "2024-01", "2024-02", [1, -2])]), /invalid series/);
  await assert.rejects(load(db, "series", [seriesRow("mdl:2740", "faers_death", "2024-01", "2024-02", [1, 1.5])]), /invalid series/);
  await assert.rejects(
    load(db, "series", [seriesRow("mdl:2740", "faers_death", "2024-01", "2024-01", [1], { query_url: "https://api.fda.gov/x?api_key=K" })]),
    /credentials|invalid/,
  );
  // a scheduled refresh of the last two months moves the window end and zero-fills omitted months
  r = await load(db, "series_patch", [
    {
      subject_id: "mdl:2740",
      series: "faers_reports",
      window_from: "2024-03",
      window_to: "2024-05",
      months: { "2024-03": 3, "2024-05": 1 },
      query_url: "https://api.fda.gov/drug/event.json?search=y&count=receivedate",
      retrieved_at: "2026-10-30T00:00:00Z",
    },
  ]);
  assert.equal(r.updated, 1);
  const row = await one(db, "select vals, total, to_char(coverage_to, 'YYYY-MM') t from safety.series where subject_id = 'mdl:2740'");
  assert.deepEqual(row, { vals: [5, 0, 3, 0, 1], total: 9, t: "2024-05" });
  await assert.rejects(
    load(db, "series_patch", [{ subject_id: "mdl:2740", series: "faers_reports", window_from: "2023-12", window_to: "2024-01",
      months: {}, query_url: "https://api.fda.gov/q", retrieved_at: "2026-10-30T00:00:00Z" }]),
    /invalid patch/,
  );
  const ledger = await one(db, "select count(*)::int n from safety.loads");
  assert.equal(ledger.n, 4, "one ledger row per successful call (subjects, 2 series, 1 patch)");
});

test("product_signals_v1: zero-filled coverage window, JPML filings difference and docket entries", async () => {
  const db = await fresh();
  await load(db, "subjects", [subject("mdl:2740")]);
  await load(db, "mdl_subjects", [
    {
      mdl: 2740,
      subject_id: "mdl:2740",
      relation: "mdl_group",
      title: TITLE,
      title_tokens: ["Taxotere"],
      title_source_dataset: "mdls",
      title_source_url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
      basis: "title_names_product",
      basis_note: "The JPML title names Taxotere (Docetaxel).",
    },
  ]);
  await load(db, "series", [
    seriesRow("mdl:2740", "faers_reports", "2024-01", "2024-03", [5, 0, 2]),
    seriesRow("mdl:2740", "faers_hospitalization", "2024-01", "2024-03", [1, 0, 0]),
  ]);
  await db.query(
    `insert into public.corpus_records (dataset, id, item) values ('jpml_pending_history_mdls', '2740', $1::jsonb)`,
    [
      JSON.stringify({
        history: {
          series: [
            { month: "2024-10", total: 100, source_url: "https://www.jpml.uscourts.gov/a.pdf" },
            { month: "2024-11", total: 130, source_url: "https://www.jpml.uscourts.gov/b.pdf" },
            { month: "2025-01", total: 150, source_url: "https://www.jpml.uscourts.gov/c.pdf" },
          ],
        },
      }),
    ],
  );
  await db.query(`insert into public.corpus_records (dataset, id, source_url, item, filters) values
    ('mdl_docket_activity', 'e1', 'https://www.courtlistener.com/docket/1/', '{"cells":{"published_at":"2024-02-03"}}', '{"mdl":["2740"]}'),
    ('mdl_docket_activity', 'e2', 'https://www.courtlistener.com/docket/1/', '{"cells":{"published_at":"2024-02-20"}}', '{"mdl":["2740"]}'),
    ('mdl_docket_activity', 'e3', 'https://www.courtlistener.com/docket/2/', '{"cells":{"published_at":"2024-02-20"}}', '{"mdl":["9999"]}')`);
  const rows = (await db.query("select * from public.product_signals_v1('2740')")).rows;
  const ae = rows.filter((r) => r.series === "adverse_events").map((r) => [r.month, Number(r.value)]);
  assert.deepEqual(ae, [
    ["2024-01", 5],
    ["2024-02", 0],
    ["2024-03", 2],
  ]);
  assert.ok(!rows.some((r) => r.series === null), "series outside the timeline set are not returned");
  const filings = rows.filter((r) => r.series === "filings");
  assert.deepEqual(
    filings.map((r) => [r.month, Number(r.value), r.source_url]),
    [["2024-11", 30, "https://www.jpml.uscourts.gov/b.pdf"]],
    "only consecutive monthly reports give a difference",
  );
  const docket = rows.filter((r) => r.series === "docket_entries");
  assert.deepEqual(docket.map((r) => [r.month, Number(r.value)]), [["2024-02", 2]]);
  for (const r of rows) {
    assert.ok(r.unit && r.source_dataset && r.basis, JSON.stringify(r));
    assert.match(r.source_url, /^https:\/\//);
  }
  await assert.rejects(db.query("select * from public.product_signals_v1('27x')"), /Invalid MDL/);
  const none = (await db.query("select * from public.product_signals_v1('3999')")).rows;
  assert.equal(none.length, 0);
});

test("breakdowns: one row per (subject, dim, period), terms by label, serious never above the count", async () => {
  const db = await fresh();
  await load(db, "subjects", [subject("faers:docetaxel", { subject_type: "product" })]);
  const b = (period, terms, vals, serious, extra = {}) => ({
    subject_id: "faers:docetaxel",
    dim: "meddra_pt",
    period,
    limit_n: 25,
    returned: terms.length,
    query_url: "https://api.fda.gov/drug/event.json?search=y&count=patient.reaction.reactionmeddrapt.exact",
    retrieved_at: "2026-10-23T00:00:00Z",
    terms,
    vals,
    serious,
    ...extra,
  });
  let r = await load(db, "breakdowns", [b("2024-Q1", ["Alopecia", "Neutropenia"], [10, 6], [4, null]), b("all", ["Alopecia"], [90], [30])]);
  assert.equal(r.inserted, 2);
  r = await load(db, "breakdowns", [b("2024-Q1", ["Alopecia"], [11], [4])]);
  assert.deepEqual([r.inserted, r.updated], [0, 1]);
  await assert.rejects(load(db, "breakdowns", [b("2024-Q2", ["Alopecia"], [2], [3])]), /invalid breakdown/);
  await assert.rejects(load(db, "breakdowns", [b("2024-Q2", ["Alopecia", "Alopecia"], [2, 1], null)]), /invalid breakdown/);
  await assert.rejects(load(db, "breakdowns", [b("2024-Q2", ["Alopecia"], [2, 1], null)]), /invalid breakdown/);
  const q = await one(db, "select public.safety_term_quarters_v1('faers:docetaxel', 'meddra_pt', array['Alopecia']) r");
  assert.deepEqual(q.r.cells, [["2024-Q1", "Alopecia", 11, 4]]);
  assert.equal(q.r.periods[0].truncated, false);
  // default rows: the terms most reported inside the requested periods, not the all-time leaders
  await load(db, "breakdowns", [b("2025-Q1", ["Neutropenia", "Alopecia"], [9, 1], null), b("2025-Q2", ["Fatigue", "Neutropenia"], [8, 7], null)]);
  const win = await one(db, "select public.safety_term_quarters_v1('faers:docetaxel', 'meddra_pt', null, '2025-Q1', '2025-Q2', 2) r");
  assert.deepEqual(win.r.terms, ["Neutropenia", "Fatigue"]);
  assert.deepEqual(win.r.periods.map((x) => x.period), ["2025-Q1", "2025-Q2"]);
  const none = await one(db, "select public.safety_term_quarters_v1('faers:docetaxel', 'meddra_pt', null, '2030', null, 3) r");
  assert.deepEqual([none.r.terms, none.r.periods, none.r.cells], [["Alopecia"], [], []]);
  const top = await one(db, "select public.safety_breakdown_v1('faers:docetaxel', 'meddra_pt', 'all', 10) r");
  assert.deepEqual(top.r.rows, [{ term: "Alopecia", value: 90, serious: 30 }]);
  const prof = await one(db, "select public.safety_subject_v1('faers:docetaxel') r");
  assert.equal(prof.r.breakdowns.meddra_pt.rows[0].term, "Alopecia");
  assert.deepEqual(prof.r.periods, ["2024-Q1", "2025-Q1", "2025-Q2"].map((period) => ({ dim: "meddra_pt", period })));
});

test("record tables: withheld fields are refused, NEISS stays held without the lead's confirmation", async () => {
  const db = await fresh();
  const complaint = {
    odino: 11500001,
    received: "2025-03-04",
    manufacturer: "Example Motors",
    items: [{ make: "EXAMPLE", model: "ONE", model_year: "2021", component: "AIR BAGS" }],
    crash: true,
    fire: false,
    injured: 1,
    deaths: 0,
    description: "THE AIR BAG DID NOT DEPLOY.",
  };
  await assert.rejects(load(db, "nhtsa_complaints", [{ ...complaint, vin: "1ABC" }]), /withheld/);
  await assert.rejects(load(db, "nhtsa_complaints", [{ ...complaint, vehicle_operator: "Name" }]), /withheld/);
  const r = await load(db, "nhtsa_complaints", [complaint]);
  assert.equal(r.inserted, 1);
  const row = await one(db, "select makes, model_years, components from safety.nhtsa_complaints where odino = 11500001");
  assert.deepEqual(row, { makes: ["EXAMPLE"], model_years: [2021], components: ["AIR BAGS"] });
  const neiss = {
    case_number: 250102066,
    treatment_date: "2025-01-01",
    age: 47,
    sex: 2,
    product_1: 4076,
    narrative: "47YOF C/O RIGHT LEG LACERATION.",
    stratum: "M",
    psu: 200,
    weight: 46.4246,
    file_year: 2025,
  };
  await assert.rejects(load(db, "neiss_cases", [neiss]), /held/);
  const ok = await load(db, "neiss_cases", [neiss], { confirmed_by_lead: "2026-10-25 lead confirmed" });
  assert.equal(ok.inserted, 1);
  await assert.rejects(load(db, "cfpb_complaints", [{ complaint_id: 1, date_received: "2025-01-01", narrative: "x" }]), /invalid/);
  await assert.rejects(
    load(db, "osha_inspections", [{ activity_nr: 1, site_address: "1 Main St" }]),
    /withheld/,
  );
});

test("CFPB aggregates and complaints share term ids; records RPC filters by the exact published company", async () => {
  const db = await fresh();
  const agg = (company, n, month = "2025-01") => ({
    company,
    product: "Debt collection",
    issue: "Attempts to collect debt not owed",
    state: "NY",
    month,
    complaints: n,
  });
  let r = await load(db, "cfpb_monthly", [agg("ACME LLC", 3), agg("ACME LLC", 2, "2025-02"), agg("Other Co", 1)]);
  assert.equal(r.inserted, 3);
  r = await load(db, "cfpb_complaints", [
    {
      complaint_id: 101,
      date_received: "2025-02-03",
      company: "ACME LLC",
      product: "Debt collection",
      sub_product: "",
      issue: "Attempts to collect debt not owed",
      sub_issue: "Debt is not yours",
      state: "NY",
      timely: true,
    },
  ]);
  assert.equal(r.inserted, 1);
  const terms = await one(db, "select count(*)::int n from safety.terms where kind = 'cfpb_company'");
  assert.equal(terms.n, 2);
  const rec = await one(db, `select public.safety_records_v1('cfpb', null, null, null, null, '{"company":"ACME LLC"}', 10, 0) r`);
  assert.equal(rec.r.total, 1);
  assert.equal(rec.r.rows[0].company, "ACME LLC");
  assert.equal(rec.r.rows[0].sub_product, "");
  assert.match(rec.r.rows[0].source_url, /consumerfinance\.gov\/.*\/detail\/101$/);
  const prof = await one(db, "select public.safety_company_profile_v1('ACME LLC') p");
  assert.deepEqual(prof.p.cfpb.by_year, { 2025: 5 });
  assert.equal(prof.p.merged_across_sources, false);
  assert.equal(prof.p.osha, null);
  const nobody = await one(db, "select public.safety_company_profile_v1('ACME') p");
  assert.equal(nobody.p.cfpb, null, "no partial-name match");
});

test("ingest bridge counts writes into the open run and refuses other targets", async () => {
  const db = await fresh();
  await load(db, "subjects", [subject("mdl:2740")]);
  await db.exec(`insert into ingest.runs (id, source, status) values
    ('00000000-0000-4000-8000-000000000001', 'safety_faers_series', 'running'),
    ('00000000-0000-4000-8000-000000000002', 'safety_faers_series', 'ok')`);
  await load(db, "series", [seriesRow("mdl:2740", "faers_reports", "2025-11", "2025-12", [2, 3])]);
  const rows = [{ subject_id: "mdl:2740", series: "faers_reports", window_from: "2025-12", window_to: "2026-01",
    months: { "2026-01": 4 }, query_url: "https://api.fda.gov/drug/event.json?search=x&count=receivedate", retrieved_at: "2026-02-03T00:00:00Z" }];
  const r = await one(db, "select public.safety_ingest_apply_v1($1::uuid, 'series_patch', $2::jsonb, '{}'::jsonb) r", [
    "00000000-0000-4000-8000-000000000001",
    JSON.stringify(rows),
  ]);
  assert.equal(r.r.updated, 1);
  const run = await one(db, "select updated from ingest.runs where id = '00000000-0000-4000-8000-000000000001'");
  assert.equal(run.updated, 1);
  const vals = await one(db, "select vals from safety.series where subject_id = 'mdl:2740'");
  assert.deepEqual(vals.vals, [2, 0, 4], "December dropped to 0 inside the refreshed window");
  await assert.rejects(
    db.query("select public.safety_ingest_apply_v1($1::uuid, 'cfpb_complaints', '[{}]'::jsonb, '{}'::jsonb)", [
      "00000000-0000-4000-8000-000000000001",
    ]),
    /not written by source/,
  );
  await assert.rejects(
    db.query("select public.safety_ingest_apply_v1($1::uuid, 'series_patch', $2::jsonb, '{}'::jsonb)", [
      "00000000-0000-4000-8000-000000000002",
      JSON.stringify(rows),
    ]),
    /not open/,
  );
  const plan = await one(db, "select public.safety_ingest_plan_v1('safety_faers_series') p");
  assert.deepEqual(plan.p.subjects.map((x) => x.id), ["mdl:2740"], "subjects with stored FAERS series are planned");
});

test("subject profile and listing", async () => {
  const db = await fresh();
  await load(db, "subjects", [
    subject("mdl:2740"),
    subject("faers:docetaxel", { subject_type: "product", label: "DOCETAXEL", rank: 120, reports_total: 30000 }),
  ]);
  const list = await one(db, "select public.safety_subjects_v1('product', null, 'doce', 10, 0) r");
  assert.equal(list.r.total, 1);
  assert.equal(list.r.rows[0].id, "faers:docetaxel");
  // an MDL group has no ranked count: its listing total is its main stored series total, else null (never invented)
  let groups = await one(db, "select public.safety_subjects_v1('mdl_group', null, null, 10, 0) r");
  assert.equal(groups.r.rows[0].reports_total, null);
  await load(db, "series", [seriesRow("mdl:2740", "faers_reports", "2024-01", "2024-03", [5, 0, 2])]);
  groups = await one(db, "select public.safety_subjects_v1('mdl_group', null, null, 10, 0) r");
  assert.equal(Number(groups.r.rows[0].reports_total), 7);
  const prof = await one(db, "select public.safety_subject_v1('faers:docetaxel') r");
  assert.equal(prof.r.subject.label, "DOCETAXEL");
  assert.match(prof.r.subject.caveat, /does not establish/);
  const missing = await one(db, "select public.safety_subject_v1('faers:none') r");
  assert.equal(missing.r, null);
  await assert.rejects(db.query("select public.safety_subject_v1('bad id')"), /Invalid subject/);
});
