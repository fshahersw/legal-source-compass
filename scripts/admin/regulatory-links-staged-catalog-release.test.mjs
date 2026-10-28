// Offline PostgreSQL test for database/contracts/regulatory-links-staged-catalog-release-20261027.sql and its rollback (pglite).
// No credentials, network or live corpus: a throwaway in-memory database with the tables the contract touches, filled with
// synthetic rows. The surveyed row md5 is swapped for the synthetic row's md5 (the live md5 was checked read-only on 2026-10-27).
//   node --test scripts/admin/regulatory-links-staged-catalog-release.test.mjs
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
const LIVE_MD5 = "4f60eb85ba4b4d5e6bac80ffd05b46cc";
const STAGED = "sw_matter_regulatory_links_v1_staged";
const PUBLISHED = "sw_matter_regulatory_links_v1";
const contract = await fs.readFile(
  "database/contracts/regulatory-links-staged-catalog-release-20261027.sql",
  "utf8",
);
const rollback = await fs.readFile(
  "database/contracts/regulatory-links-staged-catalog-release-20261027.rollback.sql",
  "utf8",
);
const verify = await fs.readFile(
  "database/contracts/verify-regulatory-links-staged-catalog-release-20261027.sql",
  "utf8",
);

const MOCK = `
set timezone = 'UTC';
create table public.corpus_datasets (id text primary key, label text not null, ready boolean not null default false,
  expected_records bigint, imported_records bigint, manifest_sha256 text, metadata jsonb not null default '{}',
  updated_at timestamptz not null default now());
create table public.corpus_records (dataset text not null references public.corpus_datasets(id), id text not null, title text,
  item jsonb not null default '{}', filters jsonb not null default '{}', primary key (dataset, id));
create schema corpus_ingest;
create table corpus_ingest.runs (id uuid primary key, contract_version text not null default 'corpus-ingest/1',
  status text not null check (status in ('running','partial','completed','failed')), scope jsonb not null check (jsonb_typeof(scope) = 'object'),
  started_at timestamptz not null default now(), finished_at timestamptz, counts jsonb not null default '{}');
create table corpus_ingest.cleanup_decisions (dataset text not null, record_id text not null, issue text not null,
  disposition text not null check (disposition in ('review','canonical_alias','quarantine','label_override')),
  reason text not null, evidence jsonb not null, original_record jsonb not null, replacement jsonb,
  reviewed_at timestamptz not null default now(), run_id uuid not null references corpus_ingest.runs(id),
  primary key (dataset, record_id, issue));
`;

async function fresh({ stagedRecords = 0, publishedRows = 165 } = {}) {
  const db = new PGlite();
  await db.exec(MOCK);
  await db.exec(`
    insert into public.corpus_datasets values
      ('${PUBLISHED}', 'published links', true, ${publishedRows}, ${publishedRows}, null, '{"status":"published"}', '2026-10-03T19:59:42.529201Z'),
      ('${STAGED}', 'staged extension (not published)', false, 0, 0, null,
       '{"listing":{"total":38},"results":{"links":38},"review":{"precision":1.0}}', '2026-10-03T19:59:42.529201Z');
    insert into corpus_ingest.runs (id, status, scope) values ('2ebec9bb-4d02-4da4-9d66-637a2b9f35ef', 'completed', '{}');
    insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, run_id)
      select '${STAGED}', r, 'dq20261003r6_regulatory_links_staged', 'review', 'staged', '{}', '{}', '2ebec9bb-4d02-4da4-9d66-637a2b9f35ef'
        from unnest(array['dataset','mdl:2846','mdl:2921','mdl:3125']) r;
  `);
  // 38 rows for the three moved MDLs, the rest spread over the original three.
  const mdls = [
    ...Array(19).fill("2846"),
    ...Array(15).fill("2921"),
    ...Array(4).fill("3125"),
  ];
  for (let i = 0; i < publishedRows; i += 1) {
    const mdl = mdls[i] ?? ["2924", "3081", "3014"][i % 3];
    await db.query(
      `insert into public.corpus_records (dataset, id, title, filters) values ($1, $2, $3, $4)`,
      [PUBLISHED, `l${i}`, "Topical association — not MDL membership", JSON.stringify({ mdl })],
    );
  }
  for (let i = 0; i < stagedRecords; i += 1) {
    await db.query(`insert into public.corpus_records (dataset, id) values ($1, $2)`, [STAGED, `s${i}`]);
  }
  const { md5 } = (
    await db.query(`select md5(to_jsonb(d)::text) md5 from public.corpus_datasets d where id = $1`, [STAGED])
  ).rows[0];
  return { db, md5 };
}
const withMd5 = (sql, md5) => sql.replaceAll(LIVE_MD5, md5);
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

test("removes only the empty staged catalog row, ledgers it, and leaves the published links alone", async () => {
  const { db, md5 } = await fresh();
  await db.exec(withMd5(contract, md5));
  assert.equal((await one(db, `select count(*)::int n from public.corpus_datasets where id = $1`, [STAGED])).n, 0);
  const led = await one(
    db,
    `select disposition, md5(original_record::text) m, run_id::text run from corpus_ingest.cleanup_decisions
      where dataset = 'public.corpus_datasets' and record_id = $1 and issue = 'release_20261027_drop_empty_staged_catalog'`,
    [STAGED],
  );
  assert.equal(led.disposition, "review");
  assert.equal(led.m, md5);
  assert.equal(led.run, "19a391c2-f6b8-4c10-8567-50e2ec054bea");
  assert.equal((await one(db, `select count(*)::int n from public.corpus_records where dataset = $1`, [PUBLISHED])).n, 165);
  assert.equal(
    (await one(db, `select count(*)::int n from corpus_ingest.cleanup_decisions where dataset = $1`, [STAGED])).n,
    4,
  );
  assert.equal((await one(db, `select status from corpus_ingest.runs where id = '19a391c2-f6b8-4c10-8567-50e2ec054bea'`)).status, "completed");
  const v = await one(db, withMd5(verify.replace(/^set local[^\n]*\n/m, ""), md5));
  assert.equal(v.staged_row_md5, null);
  assert.equal(v.ledger_roundtrip_ok, true);
  assert.equal(Number(v.held_catalog_rows), 0);
});

test("rollback restores the row byte-for-byte and the contract can be applied again", async () => {
  const { db, md5 } = await fresh();
  await db.exec(withMd5(contract, md5));
  await db.exec(withMd5(rollback, md5));
  assert.equal((await one(db, `select md5(to_jsonb(d)::text) m from public.corpus_datasets d where id = $1`, [STAGED])).m, md5);
  assert.equal(
    (await one(db, `select count(*)::int n from corpus_ingest.cleanup_decisions where dataset = 'public.corpus_datasets'`)).n,
    0,
  );
  assert.equal((await one(db, `select status from corpus_ingest.runs where id = '19a391c2-f6b8-4c10-8567-50e2ec054bea'`)).status, "failed");
  // a re-apply needs a fresh run id; the run row of the rolled-back attempt stays as the record
  await db.exec(`delete from corpus_ingest.runs where id = '19a391c2-f6b8-4c10-8567-50e2ec054bea'`);
  await db.exec(withMd5(contract, md5));
  assert.equal((await one(db, `select count(*)::int n from public.corpus_datasets where id = $1`, [STAGED])).n, 0);
});

test("refuses when the staged dataset holds records", async () => {
  const { db, md5 } = await fresh({ stagedRecords: 1 });
  await assert.rejects(db.exec(withMd5(contract, md5)), /holds 1 records/);
  await db.exec("rollback"); // the aborted transaction of the refused run
  assert.equal((await one(db, `select count(*)::int n from public.corpus_datasets where id = $1`, [STAGED])).n, 1);
});

test("refuses when the row changed since the survey", async () => {
  const { db } = await fresh();
  await assert.rejects(db.exec(contract), /changed since the survey/);
});

test("refuses when the published dataset is not as surveyed", async () => {
  const { db, md5 } = await fresh({ publishedRows: 164 });
  await assert.rejects(db.exec(withMd5(contract, md5)), /not as surveyed/);
});

test("rollback refuses without the ledger row", async () => {
  const { db, md5 } = await fresh();
  await assert.rejects(db.exec(withMd5(rollback, md5)), /nothing to roll back/);
});
