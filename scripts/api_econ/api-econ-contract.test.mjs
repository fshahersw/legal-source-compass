// Offline contract tests (pglite; no credentials, network or live corpus):
//   1. database/contracts/api-econ-v1.sql on top of ingest-v1.sql: the two FRED sources, rows built by the shared FRED
//      builders pass the upsert checks, a re-sent identical row is unchanged, a key in a URL is refused.
//   2. database/contracts/insights-economy-v1.sql on top of insights-v1.sql (its fixture): the economy family refreshes,
//      facts are the published values, "." stays a NULL with a reason, the 12-month CPI change is computed exactly.
//   node --test --experimental-strip-types scripts/api_econ/api-econ-contract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
const fred = await import(pathToFileURL(path.resolve("src/lib/ingest/sources/fred.ts")).href);
const { SPEC_BY_ID } = await import(pathToFileURL(path.resolve("src/lib/ingest/sources/fredSpec.ts")).href);
const { DATASETS, RECORDS } = await import(pathToFileURL(path.resolve("scripts/insights/fixture.mjs")).href);

const CORPUS = `
create role anon; create role authenticated; create role service_role;
create table public.corpus_datasets (id text primary key, label text not null, ready boolean not null default false,
  expected_records bigint not null default 0, imported_records bigint not null default 0, manifest_sha256 text,
  metadata jsonb not null default '{}', updated_at timestamptz not null default now());
create table public.corpus_records (dataset text not null references public.corpus_datasets(id), id text not null,
  category text not null check (category <> all (array['', 'unknown', 'uncategorized'])), state text,
  county_geoids text[] not null default '{}', title text not null default '', source_url text, ordinal bigint not null default 0,
  item jsonb not null, detail jsonb not null default '{}', text text not null default '', filters jsonb not null default '{}',
  search_vector tsvector, primary key (dataset, id));
`;

const META = {
  id: "WGS1YR", title: "Market Yield on U.S. Treasury Securities at 1-Year Constant Maturity, Quoted on an Investment Basis",
  observation_start: "1962-01-05", observation_end: "2026-10-16", frequency: "Weekly, Ending Friday", frequency_short: "W",
  units: "Percent", units_short: "%", seasonal_adjustment: "Not Seasonally Adjusted", seasonal_adjustment_short: "NSA",
  last_updated: "2026-10-19 15:16:41-05", notes: "H.15 Statistical Release notes",
};
const OBS = [
  { date: "2026-10-02", value: "4.52", vintage: "2026-10-05" },
  { date: "2026-10-09", value: "4.45", vintage: "2026-10-13" },
];

test("api-econ/1: FRED sources on ingest/1", { timeout: 120000 }, async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  await db.exec(CORPUS);
  await db.exec(await fs.readFile("database/contracts/ingest-v1.sql", "utf8"));
  const sql = await fs.readFile("database/contracts/api-econ-v1.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql); // idempotent

  const src = (await db.query("select * from ingest.sources where id in ('fred_observations','fred_series') order by id")).rows;
  assert.deepEqual(src.map((s) => [s.id, s.dataset, s.function_name, s.mode, s.ordinal_policy, s.enabled]), [
    ["fred_observations", "econ_fred_observations", "ingest-fred", "upsert", "append", false],
    ["fred_series", "econ_fred_series", "ingest-fred", "upsert", "append", false],
  ]);
  for (const s of src) assert.ok(!/\b(0|30) /.test(s.schedule.split(" ")[0] + " "), "jittered minute");
  // the adapters in fred.ts declare the same configuration
  for (const a of fred.FRED_ADAPTERS) {
    const s = src.find((x) => x.id === a.source);
    assert.equal(s.dataset, a.dataset);
    assert.equal(s.function_name, a.functionName);
    assert.equal(s.mode, a.mode);
    assert.equal(s.ordinal_policy, a.ordinalPolicy);
  }

  const spec = SPEC_BY_ID.get("WGS1YR");
  const obsRow = fred.observationRows(fred.obsMetaOf(spec, META), OBS, "2026-10-23")[0];
  const seriesRow = fred.seriesRow(spec, META, { id: 18, name: "H.15 Selected Interest Rates", link: "http://www.federalreserve.gov/releases/h15/" },
    [{ id: 1, name: "Board of Governors of the Federal Reserve System (US)", link: "https://www.federalreserve.gov" }],
    { years: ["2026"], latest: OBS[1] }, "2026-10-23");
  for (const [ds, row] of [["econ_fred_observations", obsRow], ["econ_fred_series", seriesRow]]) {
    await db.query("insert into public.corpus_datasets (id, label, metadata) values ($1, $1, $2)", [ds, { listing: { total: 0 }, summary: { rows: 0 } }]);
    const problem = (await one("select ingest.row_problem($1::jsonb, $2, $2, (select id_pattern from ingest.sources where dataset = $2)) p", [row, ds])).p;
    assert.equal(problem, null, `${ds}: ${problem}`);
  }

  const run = (await one("select public.ingest_open_run_v1('fred_observations', 'manual') r")).r;
  const res = (await one("select public.ingest_upsert_v1($1, $2::jsonb) r", [run.run_id, JSON.stringify([obsRow])])).r;
  assert.equal(res.inserted, 1);
  const again = (await one("select public.ingest_upsert_v1($1, $2::jsonb) r", [run.run_id, JSON.stringify([obsRow])])).r;
  assert.equal(again.unchanged, 1);
  const keyed = { ...obsRow, source_url: "https://api.stlouisfed.org/fred/series?series_id=WGS1YR&api_key=abc" };
  await assert.rejects(db.query("select public.ingest_upsert_v1($1, $2::jsonb)", [run.run_id, JSON.stringify([keyed])]), /credential/);
  const meta = (await one("select metadata from public.corpus_datasets where id = 'econ_fred_observations'")).metadata;
  assert.equal(meta.summary.rows, 1);
  assert.equal(meta.listing.total, 1);
});

function obsRows(id, label, obs) {
  const spec = SPEC_BY_ID.get(id) ?? { id, label, group: "labor", purpose: "", state: undefined };
  const byYear = new Map();
  for (const o of obs) byYear.set(o.date.slice(0, 4), [...(byYear.get(o.date.slice(0, 4)) ?? []), o]);
  return [...byYear].map(([y, list]) =>
    fred.observationRow(fred.obsMetaOf(spec, { units_short: "%", frequency_short: "M", seasonal_adjustment_short: "SA" }), y, list, "2026-10-23"));
}

test("insights economy family", { timeout: 300000 }, async () => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.corpus_datasets (id text primary key, label text, ready boolean default true, metadata jsonb, manifest_sha256 text);
    create table public.corpus_records (dataset text not null, id text not null, category text, state text, title text,
      source_url text, ordinal integer, item jsonb, detail jsonb, text text, filters jsonb, primary key (dataset, id));
    create schema caselaw;
    create table caselaw.cases (cluster_id bigint primary key, court_id text not null, date_filed date,
      date_approx boolean not null default false, cited_by integer not null default 0);`);
  const mine = [
    ...obsRows("UNRATE", "Unemployment rate", [
      { date: "2025-09-01", value: "4.4", vintage: "2025-11-20" },
      { date: "2025-10-01", value: null, vintage: "2025-12-16" },
      { date: "2025-11-01", value: "4.6", vintage: "2025-12-16" },
    ]),
    ...obsRows("CAUR", "Unemployment rate, California", [{ date: "2026-08-01", value: "5.5", vintage: "2026-09-19" }]),
    ...obsRows("CPIAUCNS", "CPI-U", [
      { date: "2023-01-01", value: "299.170", vintage: "2023-02-14" },
      { date: "2024-01-01", value: "308.417", vintage: "2024-02-13" },
    ]),
    ...obsRows("WGS1YR", "1-year", [{ date: "2026-10-09", value: "4.45", vintage: "2026-10-13" }]),
  ];
  const datasets = [...DATASETS.map((d) => d.id), "econ_fred_observations", "econ_bls_oews", "econ_ssa_awi", "census_acs_cvap_counties"];
  for (const d of new Set(datasets)) await db.query("insert into public.corpus_datasets (id, label, metadata) values ($1, $1, '{}')", [d]);
  const extra = [
    ...mine.map((r) => ({ ...r })),
    { dataset: "econ_bls_oews", id: "oews:N0000000", item: { oews: { areatype: "N", usps: null, year: "2025", occupations: { "000000": ["155495730", "33.54", "69770", "24.51", "31200", "37590", "50980", "80520", "128560", ""] } } } },
    { dataset: "econ_bls_oews", id: "oews:S0600000", item: { oews: { areatype: "S", usps: "CA", year: "2025", occupations: { "000000": ["18213700", "38.79", "80690", "28.00", "35950", "41600", "-", "97880", "159080", ""] } } } },
    { dataset: "econ_ssa_awi", id: "awi:2024", item: { awi: { year: 2024, value: "69,846.57" } } },
    { dataset: "census_acs_cvap_counties", id: "US", item: { census: { level: "us", usps: null, years: { 2024: { estimate: { cvap: 240833681, population: 334922499 }, moe: { cvap: 120000 } } } } } },
  ];
  let ordinal = 0;
  for (const r of [...RECORDS, ...extra])
    await db.query(
      `insert into public.corpus_records (dataset, id, category, state, title, source_url, ordinal, item, detail, filters)
       values ($1, $2, $1, $3, $4, $5, $6, $7, $8, $9)`,
      [r.dataset, r.id, r.state ?? "", r.title ?? r.id, r.source_url ?? "", ordinal++, r.item, r.detail ?? {}, r.filters ?? {}],
    );
  await db.exec(await fs.readFile("database/contracts/insights-v1.sql", "utf8"));
  const econ = await fs.readFile("database/contracts/insights-economy-v1.sql", "utf8");
  await db.exec(econ);
  await db.exec(econ); // idempotent
  const ent = (await one("select insights.refresh_entities('test') r")).r;
  assert.equal(ent.status, "succeeded", JSON.stringify(ent));
  const res = (await one("select insights.refresh_economy('test') r")).r;
  assert.equal(res.status, "succeeded", JSON.stringify(res));
  const fact = async (m, t, id, p) =>
    one("select value::text v, not_recorded_reason r, period_start::text s, period_end::text e, moe::text moe, n::text n from insights.facts where metric_id=$1 and entity_type=$2 and entity_id=$3 and period=$4", [m, t, id, p]);
  assert.equal((await fact("econ_unemployment_rate", "nation", "US", "2025-09")).v, "4.4");
  const oct = await fact("econ_unemployment_rate", "nation", "US", "2025-10");
  assert.equal(oct.v, null);
  assert.match(oct.r, /No value was published/);
  assert.equal((await fact("econ_unemployment_rate", "state", "CA", "2026-08")).v, "5.5");
  // (308.417 / 299.170 − 1) × 100 = 3.0909… → 3.1 (BLS reports 3.1 for January 2024)
  assert.equal((await fact("econ_cpi_u_change_12m", "nation", "US", "2024-01")).v, "3.1");
  const w = await fact("econ_postjudgment_rate", "nation", "US", "2026-10-09");
  assert.deepEqual([w.v, w.s, w.e], ["4.45", "2026-10-03", "2026-10-09"]);
  assert.equal((await fact("econ_oews_annual_median_wage", "nation", "US", "2025")).v, "50980");
  const ca = await fact("econ_oews_annual_median_wage", "state", "CA", "2025");
  assert.equal(ca.v, null);
  assert.match(ca.r, /did not release/);
  assert.equal((await fact("econ_ssa_awi", "nation", "US", "2024")).v, "69846.57");
  const cv = await fact("econ_cvap", "nation", "US", "2024");
  assert.deepEqual([cv.v, cv.moe, cv.s], ["240833681", "120000", "2020-01-01"]);
  assert.equal((await fact("econ_cvap_share", "nation", "US", "2024")).v, "71.9");
  // a second refresh over unchanged sources changes nothing
  const again = (await one("select insights.refresh_economy('test') r")).r;
  assert.equal(again.inserted + again.updated + again.deleted, 0);
  // the scheduled ingestion's hook finds the family by dataset
  const by = (await one("select insights.refresh_for_datasets(array['econ_fred_observations']) r")).r;
  assert.deepEqual(by.families, ["economy"]);
  const priv = (await one("select has_function_privilege('anon', 'insights.refresh_economy(text)', 'execute') a")).a;
  assert.equal(priv, false);
});
