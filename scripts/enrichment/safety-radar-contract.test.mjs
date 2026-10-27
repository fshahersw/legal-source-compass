// Offline PostgreSQL contract test for database/contracts/safety-radar-v1.sql (pglite). No credentials, network or
// live corpus: a throwaway in-memory database with the two safety tables the contract reads, filled with synthetic rows.
//   node --test scripts/enrichment/safety-radar-contract.test.mjs
// Needs the private PGlite runtime, like every test in `npm run test:sql` (PUBLISHER_CODE_PGLITE or
// private/tools/publisher-code-contract-tests).
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
const SQL = await fs.readFile("database/contracts/safety-radar-v1.sql", "utf8");

const MOCK = `
create role anon; create role authenticated; create role service_role;
create schema safety;
create table safety.series (subject_id text not null, series text not null, coverage_from date not null,
  coverage_to date not null, vals integer[] not null, primary key (subject_id, series));
create table safety.nhtsa_complaints (odino integer primary key, received date, items jsonb not null default '[]',
  crash boolean, fire boolean, injured smallint, deaths smallint);
`;

async function fresh() {
  const db = new PGlite();
  await db.exec(MOCK);
  await db.exec(SQL);
  return db;
}

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

test("applies twice, owns no DROP/DELETE/TRUNCATE and is service_role only", async () => {
  assert.doesNotMatch(SQL, /\b(drop|delete|truncate|insert|update)\b\s/i);
  const db = await fresh();
  await db.exec(SQL);
  const rows = (
    await db.query(`select p.proname, p.prosecdef, p.proconfig,
        has_function_privilege('anon', p.oid, 'execute') anon,
        has_function_privilege('authenticated', p.oid, 'execute') auth,
        has_function_privilege('service_role', p.oid, 'execute') svc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('safety_series_window_v1', 'safety_radar_nhtsa_windows_v1')`)
  ).rows;
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.prosecdef, true, r.proname);
    assert.deepEqual(r.proconfig, ['search_path=""'], r.proname);
    assert.equal(r.anon, false);
    assert.equal(r.auth, false);
    assert.equal(r.svc, true);
  }
});

test("series windows: recent and baseline sums, covered months, equal hashes for equal values, tail", async () => {
  const db = await fresh();
  const vals = range(60, (i) => i + 1); // 2021-07 .. 2026-06
  await db.query(
    `insert into safety.series values
      ('faers:a', 'faers_reports', '2021-07-01', '2026-06-01', $1),
      ('faers:b', 'faers_reports', '2021-07-01', '2026-06-01', $1),
      ('faers:c', 'faers_reports', '2024-01-01', '2026-06-01', $2),
      ('faers:d', 'faers_reports', '2021-07-01', '2026-05-01', $3),
      ('mdl:1', 'faers_reports', '2021-07-01', '2026-06-01', $1)`,
    [vals, vals.slice(-30), vals.slice(0, 59)],
  );
  const out = (
    await db.query(
      `select * from public.safety_series_window_v1('faers:', array['faers_reports'], date '2026-06-01', 12, 36, 24)`,
    )
  ).rows;
  assert.deepEqual(
    out.map((r) => r.subject_id),
    ["faers:a", "faers:b", "faers:c"],
    "prefix filter; a series ending before p_end is left out",
  );
  const a = out[0];
  assert.equal(Number(a.recent), range(12, (i) => 49 + i).reduce((s, v) => s + v, 0));
  assert.equal(Number(a.baseline), range(36, (i) => 13 + i).reduce((s, v) => s + v, 0));
  assert.equal(a.recent_months, 12);
  assert.equal(a.baseline_months, 36);
  assert.equal(a.tail.length, 24);
  assert.equal(a.tail[23], 60);
  assert.equal(a.values_hash, out[1].values_hash);
  assert.equal(out[2].baseline_months, 18, "a baseline before coverage_from is summed over covered months only");
  await assert.rejects(db.query(`select * from public.safety_series_window_v1('faers', array['x'], date '2026-06-01')`));
  await assert.rejects(db.query(`select * from public.safety_series_window_v1('faers:', array['x'], date '2026-06-15')`));
});

test("NHTSA windows: one count per complaint and make/model/component, national totals, minimum, months", async () => {
  const db = await fresh();
  const item = (model, component, year) => ({ make: "JEEP", model, component, model_year: year });
  const rows = [];
  let id = 1;
  // 3 recent complaints (2026-09) listing the same make/model/component under two model years: counted once each.
  for (let i = 0; i < 3; i++)
    rows.push([id++, "2026-09-10", [item("WRANGLER", "ELECTRICAL SYSTEM", "2020"), item("WRANGLER", "ELECTRICAL SYSTEM", "2021")], i === 0, false, 0, 0]);
  // 1 prior complaint (2025-01) with an injury; 1 complaint in a partial month after p_end is outside the window.
  rows.push([id++, "2025-01-05", [item("WRANGLER", "ELECTRICAL SYSTEM", "2020")], false, false, 1, 0]);
  rows.push([id++, "2026-10-02", [item("WRANGLER", "ELECTRICAL SYSTEM", "2020")], false, false, 0, 0]);
  rows.push([id++, "2026-08-01", [item("GLADIATOR", "ENGINE", "2022")], false, true, 0, 1]);
  for (const r of rows)
    await db.query(`insert into safety.nhtsa_complaints values ($1, $2, $3::jsonb, $4, $5, $6, $7)`, [
      r[0], r[1], JSON.stringify(r[2]), r[3], r[4], r[5], r[6],
    ]);
  const out = (await db.query(`select * from public.safety_radar_nhtsa_windows_v1(date '2026-09-01', 12, 2)`)).rows;
  const nat = out.find((r) => r.scope === "national");
  assert.equal(Number(nat.recent), 4);
  assert.equal(Number(nat.prior), 1);
  assert.equal(Number(nat.recent_deaths), 1);
  assert.equal(nat.months.length, 24);
  const units = out.filter((r) => r.scope === "unit");
  assert.equal(units.length, 1, "GLADIATOR ENGINE (1 recent) is below the minimum");
  const u = units[0];
  assert.deepEqual([u.make, u.model, u.component], ["JEEP", "WRANGLER", "ELECTRICAL SYSTEM"]);
  assert.equal(Number(u.recent), 3);
  assert.equal(Number(u.prior), 1);
  assert.equal(Number(u.recent_severe), 1);
  assert.equal(Number(u.prior_severe), 1);
  assert.equal(u.months[23], 3);
  assert.equal(u.months[3], 1);
});
