// Offline test of database/contracts/insights-safety2-v1.sql on top of insights-v1.sql and safety-signals-v1.sql (pglite,
// synthetic rows). Run: node --test scripts/safety_v2/insights-safety2.test.mjs
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

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.corpus_datasets (id text primary key, label text, ready boolean default true, metadata jsonb, manifest_sha256 text);
    create table public.corpus_records (dataset text not null, id text not null, category text, state text, title text,
      source_url text, ordinal integer, item jsonb not null default '{}', detail jsonb, text text, filters jsonb not null default '{}',
      primary key (dataset, id));
    create schema caselaw;
    create table caselaw.cases (cluster_id bigint primary key, court_id text not null, date_filed date,
      date_approx boolean not null default false, cited_by integer not null default 0);`);
  await db.exec(await fs.readFile("database/contracts/insights-v1.sql", "utf8"));
  await db.exec(await fs.readFile("database/contracts/safety-signals-v1.sql", "utf8"));
  await db.exec(await fs.readFile("database/contracts/insights-safety2-v1.sql", "utf8"));
  return db;
}

const load = (db, target, rows, opts = {}) =>
  db.query("select public.safety_load_v1($1, $2::jsonb, $3::jsonb, '{}'::jsonb)", [
    target,
    JSON.stringify(rows),
    JSON.stringify(opts),
  ]);
const series = (subject, name, from, to, vals, source = "openfda_faers") => ({
  subject_id: subject,
  series: name,
  unit: "reports",
  source_id: source,
  query_url: "https://api.fda.gov/drug/event.json?count=receivedate",
  method: "count=receivedate by month",
  coverage_from: from,
  coverage_to: to,
  retrieved_at: "2026-10-23T00:00:00Z",
  vals,
});
const months = (n, f) => Array.from({ length: n }, (_, i) => f(i));

test(
  "safety2 family: registry, facts only for spine entities, values, gaps and partial periods",
  { timeout: 300000 },
  async () => {
    const db = await setup();
    const fam = (
      await db.query("select count(*)::int n from insights.metrics where family = 'safety2'")
    ).rows[0].n;
    assert.equal(fam, 11);
    // spine: the nation and MDL 2740 (MDL 1657 is deliberately absent from the spine)
    await db.exec(`insert into insights.entities (entity_type, entity_id, label, source_dataset) values
    ('nation', 'US', 'United States', 'test'), ('mdl', '2740', 'Taxotere', 'mdls')`);
    await db.query(
      `insert into public.corpus_records (dataset, id, item) values ('mdls', '2740', '{"date_transferred": "2016-10-04"}')`,
    );
    const subj = (id, extra = {}) => ({
      id,
      subject_type: "mdl_group",
      kind: "drug",
      label: id,
      search: {},
      source_id: "openfda_faers",
      source_url: "https://open.fda.gov/apis/drug/event/",
      ...extra,
    });
    await load(db, "subjects", [
      subj("mdl:2740"),
      subj("mdl:1657"),
      subj("national:faers", { subject_type: "national", kind: "all" }),
    ]);
    // 2014-01 .. 2016-06: 30 months. reports 10/month in 2014, 20/month 2015, 30/month 2016; serious = half
    const vals = months(30, (i) => (i < 12 ? 10 : i < 24 ? 20 : 30));
    await load(db, "series", [
      series("mdl:2740", "faers_reports", "2014-01", "2016-06", vals),
      series(
        "mdl:2740",
        "faers_serious",
        "2014-01",
        "2016-06",
        vals.map((v) => v / 2),
      ),
      series(
        "mdl:2740",
        "enforcement_reports",
        "2012-06",
        "2016-06",
        months(49, (i) => (i === 30 ? 1 : 0)),
        "openfda_enforcement",
      ),
      series("mdl:1657", "faers_reports", "2004-01", "2004-02", [1, 2]),
      series(
        "national:faers",
        "faers_reports",
        "2004-01",
        "2005-12",
        months(24, () => 100),
      ),
      series(
        "national:faers",
        "faers_serious",
        "2004-01",
        "2005-12",
        months(24, () => 40),
      ),
    ]);
    const run = (await db.query("select insights.refresh_safety2('test') r")).rows[0].r;
    assert.equal(run.status, "succeeded", JSON.stringify(run));
    const fact = async (m, t, id, p) =>
      (
        await db.query(
          `select value::text v, partial, not_recorded_reason r, n::text n from insights.facts
      where metric_id = $1 and entity_type = $2 and entity_id = $3 and period = $4`,
          [m, t, id, p],
        )
      ).rows[0];
    assert.deepEqual(await fact("mdl_product_reports", "mdl", "2740", "2015"), {
      v: "240",
      partial: false,
      r: null,
      n: null,
    });
    const y2016 = await fact("mdl_product_reports", "mdl", "2740", "2016");
    assert.equal(y2016.v, "180");
    assert.equal(y2016.partial, true, "the source ends in June");
    assert.equal((await fact("mdl_faers_serious_share", "mdl", "2740", "2015")).v, "50.0");
    // last 12 months (2015-07..2016-06): 6*20 + 6*30 = 300; previous (2014-07..2015-06): 6*10 + 6*20 = 180 → +66.7%
    assert.equal(
      (await fact("mdl_product_reports_change_pct", "mdl", "2740", "2016-06-30")).v,
      "66.7",
    );
    // first report 2014-01 → transfer 2016-10: 33 months; first enforcement report 2014-12 (index 30 from 2012-06) → 22
    assert.equal(
      (await fact("mdl_months_first_report_to_transfer", "mdl", "2740", "2016-10-04")).v,
      "33",
    );
    assert.equal(
      (await fact("mdl_months_first_recall_to_transfer", "mdl", "2740", "2016-10-04")).v,
      "22",
    );
    assert.equal((await fact("faers_serious_share_national", "nation", "US", "2005")).v, "40.0");
    const missing = (
      await db.query(
        "select count(*)::int n from insights.facts where entity_type = 'mdl' and entity_id = '1657'",
      )
    ).rows[0].n;
    assert.equal(missing, 0, "no fact for an MDL outside the spine");
    // a second refresh over unchanged data changes nothing
    const again = (await db.query("select insights.refresh_safety2('test') r")).rows[0].r;
    assert.equal(again.inserted + again.updated + again.deleted, 0);
  },
);

test(
  "safety2: a group whose reports reach the window start gets a reason, not a number",
  { timeout: 300000 },
  async () => {
    const db = await setup();
    await db.exec(
      `insert into insights.entities (entity_type, entity_id, label, source_dataset) values ('mdl', '2243', 'Fosamax', 'mdls')`,
    );
    await db.query(
      `insert into public.corpus_records (dataset, id, item) values ('mdls', '2243', '{"date_transferred": "2011-05-23"}')`,
    );
    await load(db, "subjects", [
      {
        id: "mdl:2243",
        subject_type: "mdl_group",
        kind: "drug",
        label: "Fosamax",
        search: {},
        source_id: "openfda_faers",
        source_url: "https://open.fda.gov/apis/drug/event/",
      },
    ]);
    await load(db, "series", [
      series(
        "mdl:2243",
        "faers_reports",
        "2004-01",
        "2005-12",
        months(24, () => 0).map((_, i) => (i ? 1 : 5)),
      ),
    ]);
    await db.query("select insights.refresh_safety2('test')");
    const f = (
      await db.query(
        `select value, not_recorded_reason r from insights.facts where metric_id = 'mdl_months_first_report_to_transfer'`,
      )
    ).rows[0];
    assert.equal(f.value, null);
    assert.match(f.r, /start of the source window \(2004-01\)/);
    const change = (
      await db.query(
        `select value::text v from insights.facts where metric_id = 'mdl_product_reports_change_pct'`,
      )
    ).rows[0];
    assert.equal(
      change.v,
      "-25.0",
      "last 12 months 12 reports, previous 12 months 5 + 11 = 16: (12 - 16) / 16",
    );
  },
);
