// Isolated PostgreSQL contract test for database/contracts/judge-portraits-release-20261027.sql and its rollback.
// No credentials, network or live corpus: a throwaway in-memory PGlite database with the three tables the contract touches,
// filled with judge rows shaped like the 22 production rows (item photo_url "", detail photo_url "" and photo_provenance null,
// as read 2026-10-27). Checks: the apply binds 22 pages and inserts 14 artifacts (one per index path), never overwrites a
// recorded photo, retires the empty catalog row; the rollback restores every row byte for byte and re-creates the catalog
// row exactly as production holds it (md5 of to_jsonb(row) read 2026-10-27).
// Run: node --test scripts/visuals/judge-portraits-release.contract.test.mjs   (from the repository root; needs the PGlite
// runtime at private/tools/publisher-code-contract-tests or PUBLISHER_CODE_PGLITE, like the other test:sql suites)
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

const APPLY = await fs.readFile("database/contracts/judge-portraits-release-20261027.sql", "utf8");
const ROLLBACK = await fs.readFile("database/contracts/judge-portraits-release-20261027-rollback.sql", "utf8");
const LEGACY_MD5 = "e4d1b373ba209e944546816727bef052"; // md5(to_jsonb(corpus_datasets row 'judge_portraits')::text), 2026-10-27

const MOCK = `
set timezone = 'UTC';
create table public.corpus_records (dataset text, id text, title text, source_url text, item jsonb, detail jsonb,
  filters jsonb, ordinal bigint, primary key (dataset, id));
create table public.corpus_artifacts (route text primary key, sha256 text not null, object_key text not null,
  bytes bigint not null, mime text not null default 'application/octet-stream', filename text, ready boolean not null default false);
create table public.corpus_datasets (id text primary key, label text not null, ready boolean not null default false,
  expected_records bigint not null default 0, imported_records bigint not null default 0, manifest_sha256 text,
  metadata jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
`;

const judgeIds = [...APPLY.matchAll(/where dataset = 'judges' and id = '([0-9a-f]{32})'/g)].map((m) => m[1]);
const legacyJson = ROLLBACK.match(/\$legacy\$(.*)\$legacy\$/s)[1];

async function fresh({ withPhoto } = {}) {
  const db = new PGlite();
  await db.exec(MOCK);
  for (const [i, id] of judgeIds.entries()) {
    const photo = withPhoto === id ? "/judge-images/existing.jpg" : "";
    await db.query(
      "insert into public.corpus_records (dataset, id, item, detail) values ('judges', $1, $2::jsonb, $3::jsonb)",
      [
        id,
        JSON.stringify({ id, name: `Judge ${i}`, photo_url: photo, has_details: false }),
        JSON.stringify({ id, name: `Judge ${i}`, photo_url: photo, photo_provenance: null, sources: [{ url: "x" }] }),
      ],
    );
  }
  // The two portraits that are already stored artifacts (read 2026-10-27).
  await db.exec(`insert into public.corpus_artifacts values
    ('/supplement-files/judge_portraits/portrait-d2f6061cef6c3ca62921', '0b987c96f6e3079d627151ba248dcc478b65044af2613595b0a087d485907801', '0b/0b987c96f6e3079d627151ba248dcc478b65044af2613595b0a087d485907801', 9041, 'image/jpeg', 'kearney-mark-1963.jpeg', true),
    ('/supplement-files/judge_portraits/portrait-e76b9821f954a1f31d4f', '7630604f81946e19066b892fee76d46d6e3556c672660634b5462c47f7081a6e', '76/7630604f81946e19066b892fee76d46d6e3556c672660634b5462c47f7081a6e', 4771, 'image/jpeg', 'owen-priscilla-1954-10-04.jpeg', true);`);
  await db.query(
    `insert into public.corpus_datasets select * from jsonb_populate_record(null::public.corpus_datasets, $1::jsonb)`,
    [legacyJson],
  );
  return db;
}

const snapshot = async (db) =>
  (
    await db.query(
      "select id, md5(item::text) im, md5(detail::text) dm from public.corpus_records where dataset = 'judges' order by id",
    )
  ).rows;
const lastRow = (results) => results.filter((r) => r.rows && r.rows.length).at(-1).rows[0];

test("the contract names 22 distinct judge pages", () => {
  assert.equal(judgeIds.length, 22);
  assert.equal(new Set(judgeIds).size, 22);
});

test("the embedded legacy catalog row is the production row exactly", async () => {
  const db = await fresh();
  const { rows } = await db.query(
    "select md5(to_jsonb(d)::text) m from public.corpus_datasets d where id = 'judge_portraits'",
  );
  assert.equal(rows[0].m, LEGACY_MD5);
});

test("apply binds every page, adds one artifact per index path and retires the empty catalog row", async () => {
  const db = await fresh();
  const verify = lastRow(await db.exec(APPLY));
  assert.deepEqual(
    { bound: Number(verify.bound), artifacts: Number(verify.artifacts), legacy_row: Number(verify.legacy_row) },
    { bound: 22, artifacts: 14, legacy_row: 0 },
  );
  const { rows } = await db.query(
    `select count(*)::int n, count(distinct item->>'photo_url')::int urls,
            count(*) filter (where item->>'photo_url' = detail->>'photo_url')::int same,
            count(*) filter (where detail->'photo_provenance'->>'released_under' = 'owner decision 2026-10-27')::int prov,
            count(*) filter (where item->>'photo_credit' like '%licence not recorded.')::int unrecorded
       from public.corpus_records where dataset = 'judges'`,
  );
  assert.deepEqual(rows[0], { n: 22, urls: 16, same: 22, prov: 22, unrecorded: 20 });
  const art = await db.query("select count(*)::int n from public.corpus_artifacts where ready");
  assert.equal(art.rows[0].n, 16);
  // every bound photo_url resolves to a ready artifact
  const orphan = await db.query(
    `select count(*)::int n from public.corpus_records r left join public.corpus_artifacts a on a.route = r.item->>'photo_url'
      where r.dataset = 'judges' and (a.route is null or not a.ready)`,
  );
  assert.equal(orphan.rows[0].n, 0);
});

test("apply never overwrites a photo that is already recorded", async () => {
  const keep = judgeIds[5];
  const db = await fresh({ withPhoto: keep });
  const verify = lastRow(await db.exec(APPLY));
  assert.equal(Number(verify.bound), 21);
  const { rows } = await db.query("select item->>'photo_url' u from public.corpus_records where id = $1", [keep]);
  assert.equal(rows[0].u, "/judge-images/existing.jpg");
});

test("rollback restores every row byte for byte and the catalog row", async () => {
  const db = await fresh();
  const before = await snapshot(db);
  await db.exec(APPLY);
  assert.notDeepEqual(await snapshot(db), before);
  await db.exec(ROLLBACK);
  assert.deepEqual(await snapshot(db), before);
  const art = await db.query("select count(*)::int n from public.corpus_artifacts");
  assert.equal(art.rows[0].n, 2);
  const { rows } = await db.query(
    "select md5(to_jsonb(d)::text) m from public.corpus_datasets d where id = 'judge_portraits'",
  );
  assert.equal(rows[0].m, LEGACY_MD5);
});
