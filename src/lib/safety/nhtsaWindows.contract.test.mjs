// Offline PostgreSQL contract test for database/contracts/safety-nhtsa-windows-v1.sql (pglite). No credentials, network
// or live corpus: a throwaway in-memory database with the safety/1 tables the contract reads, filled with synthetic rows.
//   node --test src/lib/safety/nhtsaWindows.contract.test.mjs
// Needs the private pglite runtime (PUBLISHER_CODE_PGLITE or private/tools/publisher-code-contract-tests).
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
const SQL = await fs.readFile("database/contracts/safety-nhtsa-windows-v1.sql", "utf8");

const MOCK = `
create role anon; create role authenticated; create role service_role;
create table public.corpus_records (dataset text not null, id text not null, title text, source_url text,
  item jsonb not null default '{}', filters jsonb not null default '{}', primary key (dataset, id));
create schema safety;
create table safety.nhtsa_complaints (odino integer primary key, received date, manufacturer text, makes text[],
  models text[], model_years smallint[], components text[], crash boolean, fire boolean, injured smallint, deaths smallint);
create table safety.osha_inspections (activity_nr bigint primary key, estab_name text, site_city text, site_state text,
  naics_code text, open_date date);
create table safety.osha_violations (activity_nr bigint, citation_id text, standard text, issuance_date date,
  current_penalty numeric, primary key (activity_nr, citation_id));
`;

async function fresh() {
  const db = new PGlite();
  await db.exec(MOCK);
  await db.exec(SQL);
  return db;
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

let odino = 0;
const complaint = (db, received, extra = {}) => {
  const c = {
    manufacturer: "Nissan North America, Inc.",
    makes: ["NISSAN"],
    models: ["ROGUE"],
    model_years: [2022],
    components: ["ENGINE AND ENGINE COOLING"],
    crash: false,
    fire: false,
    injured: 0,
    deaths: 0,
    ...extra,
  };
  odino += 1;
  return db.query(
    `insert into safety.nhtsa_complaints values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      odino,
      received,
      c.manufacturer,
      c.makes,
      c.models,
      c.model_years,
      c.components,
      c.crash,
      c.fire,
      c.injured,
      c.deaths,
    ],
  );
};

test("applies twice, holds no DROP/DELETE/TRUNCATE and grants only service_role", async () => {
  assert.doesNotMatch(SQL, /\b(drop|delete|truncate|insert|update)\b\s/i);
  const db = await fresh();
  await db.exec(SQL);
  const rows = (
    await db.query(`select p.proname, p.prosecdef, p.proconfig,
        has_function_privilege('anon', p.oid, 'execute') anon,
        has_function_privilege('authenticated', p.oid, 'execute') auth,
        has_function_privilege('service_role', p.oid, 'execute') svc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'safety\\_%'`)
  ).rows;
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.equal(r.prosecdef, true, r.proname);
    assert.deepEqual(r.proconfig, ['search_path=""'], r.proname);
    assert.equal(r.anon, false, r.proname);
    assert.equal(r.auth, false, r.proname);
    assert.equal(r.svc, true, r.proname);
  }
});

test("complaint windows compare two 365-day windows and never add components up", async () => {
  const db = await fresh();
  // current window (to 2026-10-21): 3 complaints, one naming two components; prior window: 1 complaint.
  await complaint(db, "2026-10-21", {
    components: ["SEATS", "AIR BAGS"],
    injured: 2,
    deaths: 1,
    crash: true,
  });
  await complaint(db, "2026-05-01", { components: ["SEATS"] });
  await complaint(db, "2025-11-01", { components: ["SEATS:FRAME"], fire: true });
  await complaint(db, "2025-06-01", { components: ["SEATS"] });
  await complaint(db, "2023-01-01", { components: ["SEATS"] }); // outside both windows
  const r = (await one(db, "select public.safety_nhtsa_complaint_windows_v1(null, 1, 40) r")).r;
  assert.equal(r.as_of, "2026-10-21");
  assert.equal(r.current_from, "2025-10-22");
  assert.equal(r.prior_to, "2025-10-21");
  assert.equal(r.totals.current, 3, "complaints counted once each");
  assert.equal(r.totals.prior, 1);
  assert.equal(r.totals.injured, 2);
  assert.equal(r.totals.deaths, 1);
  assert.equal(r.totals.fires, 1);
  const seats = r.pairs.find((p) => p.component === "SEATS");
  assert.equal(seats.current, 3, "SEATS:FRAME counts under its top-level component");
  assert.equal(seats.prior, 1);
  const bags = r.pairs.find((p) => p.component === "AIR BAGS");
  assert.equal(bags.current, 1);
  assert.equal(r.manufacturers[0].current, 3);
  await assert.rejects(db.query("select public.safety_nhtsa_complaint_windows_v1(null, 0, 40)"));
});

test("recall complaints match exact make, model, year range and top-level component", async () => {
  const db = await fresh();
  await db.query(
    `insert into public.corpus_records (dataset, id, item) values ('agency_safety_nhtsa_recalls', '25V437000', $1::jsonb)`,
    [
      JSON.stringify({
        cells: { date: "2025-06-27" },
        recall: {
          makes: ["NISSAN", "INFINITI"],
          vehicles: ["NISSAN ROGUE 2021–2024", "INFINITI QX55 2022", "MYSTERY"],
          components: ["ENGINE AND ENGINE COOLING:ENGINE:HARD PARTS"],
        },
      }),
    ],
  );
  await complaint(db, "2020-01-02", { model_years: [2015] }); // year outside the range: no match
  await complaint(db, "2025-03-01"); // before, matched
  await complaint(db, "2025-08-01", { injured: 1 }); // after, matched
  await complaint(db, "2025-08-02", { components: ["ENGINE"] }); // vehicle only: other vocabulary
  await complaint(db, "2025-08-03", { models: ["ROGUE SPORT"] }); // different model: no match
  const r = (await one(db, "select public.safety_nhtsa_recall_complaints_v1('25V437000') r")).r;
  assert.deepEqual(
    r.vehicles.map((v) => `${v.make}|${v.model}|${v.from}|${v.to}`),
    ["INFINITI|QX55|2022|2022", "NISSAN|ROGUE|2021|2024"],
  );
  assert.deepEqual(r.unparsed, ["MYSTERY"]);
  assert.deepEqual(r.components, ["ENGINE AND ENGINE COOLING"]);
  assert.equal(r.before.complaints, 1);
  assert.equal(r.after.complaints, 1);
  assert.equal(r.after.injured, 1);
  const q3 = r.quarters.find((q) => q.quarter === "2025-Q3");
  assert.equal(q3.complaints, 1);
  assert.equal(q3.vehicle_complaints, 2);
  assert.equal(
    (await one(db, "select public.safety_nhtsa_recall_complaints_v1('99V999000') r")).r,
    null,
  );
  await assert.rejects(db.query("select public.safety_nhtsa_recall_complaints_v1('x; select 1')"));
});

test("silica citations split fabricators, other industries and construction", async () => {
  const db = await fresh();
  await db.query(`insert into safety.osha_inspections values (1, 'Stone Works LLC', 'Austin', 'TX', '327991', '2026-01-01'),
    (2, 'Foundry Inc', 'Erie', 'PA', '331511', '2026-01-01'), (3, 'Builder Co', 'Reno', 'NV', '236220', '2026-01-01')`);
  await db.query(`insert into safety.osha_violations values (1, '01001', '19101053 D01', '2026-02-01', 1000),
    (1, '01002', '19101053 E01', '2026-02-01', 500), (2, '01001', '19101053 D01', '2025-01-01', 200),
    (3, '01001', '19261153 C01', '2026-03-01', 300), (3, '01002', '19100134 A01', '2026-03-01', 999)`);
  const r = (await one(db, "select public.safety_osha_silica_v1() r")).r;
  assert.equal(r.to, "2026-03-01");
  const y2026 = r.years.find((y) => y.year === 2026);
  assert.equal(y2026.fabricator_general, 2);
  assert.equal(y2026.construction, 1);
  assert.equal(r.last12.violations, 3, "the respirator citation is not a silica citation");
  assert.equal(r.last12.fabricator_inspections, 1);
  assert.equal(r.establishments[0].name, "Stone Works LLC");
  assert.equal(r.establishments.length, 1);
});
