// Isolated PostgreSQL contract test for database/contracts/large-text-assets-release-20261027.sql and its rollback.
// A throwaway in-memory PGlite database rebuilt in the live shape surveyed on 2026-10-27: the large_text_assets catalog row
// (exact metadata), 78 rows (the Grady County row in its exact live form, 44 olls.info rows, 33 rows from official hosts),
// two /api/text routes per row, and a stored object for the Grady County text only. No credentials, network or live corpus.
// Run: node --test scripts/admin/large-text-assets-release.contract.test.mjs   (from the repository root; needs the private
// PGlite runtime, or PUBLISHER_CODE_PGLITE pointing at @electric-sql/pglite/dist/index.js)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);

const CONTRACT = await fs.readFile("database/contracts/large-text-assets-release-20261027.sql", "utf8");
const ROLLBACK = await fs.readFile("database/contracts/large-text-assets-release-20261027.rollback.sql", "utf8");

const GRADY = "large-text:f6f572ee6ca009b460712aac316397d6";
const GRADY_SHA = "2ee81cc5208a0b5f8116dc14711c7d513d4c8e914951d5268cb7a5c854c12660";
const GRADY_ROUTES = [
  "/api/text?id=f6f572ee6ca009b460712aac316397d6",
  "/api/text?id=doc%3A82bcbc88fd1263e613f5f6c7ba832166",
];

/** The exact before-images the rollback restores, so the test row is the live row by construction. */
function literal(name) {
  const m = new RegExp(`\\b${name} = \\$j\\$(.*?)\\$j\\$::jsonb`, "s").exec(ROLLBACK);
  assert.ok(m, `rollback carries the ${name} before-image`);
  return m[1];
}
const META = literal("metadata");

const MOCK = `
create schema storage;
create table storage.objects (bucket_id text, name text, metadata jsonb, primary key (bucket_id, name));
create table public.corpus_datasets (id text primary key, label text not null, ready boolean not null default false,
  expected_records bigint not null default 0, imported_records bigint not null default 0, manifest_sha256 text,
  metadata jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
create table public.corpus_records (dataset text references public.corpus_datasets(id), id text, category text, state text,
  county_geoids text[], title text, source_url text, ordinal bigint, item jsonb, detail jsonb, text text, filters jsonb,
  search_vector tsvector, primary key (dataset, id));
create table public.corpus_artifacts (route text primary key, sha256 text, object_key text, bytes bigint, mime text,
  filename text, ready boolean);
`;

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** Non-Grady rows: [host, category, state, count]. */
const OTHERS = [
  ["olls.info", "statutes", "Colorado", 41],
  ["olls.info", "constitutions", "Colorado", 3],
  ["www.legis.iowa.gov", "statutes", "Iowa", 9],
  ["legislature.maine.gov", "statutes", "Maine", 6],
  ["www.doa.la.gov", "regulations", "Louisiana", 5],
  ["uscode.house.gov", "guidance", "", 4],
  ["law.lis.virginia.gov", "statutes", "Virginia", 3],
  ["nebraskalegislature.gov", "statutes", "Nebraska", 2],
  ["www.oregonlegislature.gov", "statutes", "Oregon", 1],
  ["pub.njleg.state.nj.us", "guidance", "New Jersey", 1],
  ["www.govinfo.gov", "guidance", "", 1],
  ["www.ncleg.gov", "statutes", "North Carolina", 1],
];

async function seed({ extraObjectFor = null } = {}) {
  const db = new PGlite();
  await db.exec(MOCK);
  await db.query(
    `insert into public.corpus_datasets values ('large_text_assets','Complete large reader-text downloads',false,155,78,
       'f6b06b77d11fcf4588199895102b09cd4b326e4435b601084d51259966509db4',$1::jsonb,'2026-09-28 01:13:43.16307+00')`,
    [META],
  );
  await db.query(
    `insert into public.corpus_records values ('large_text_assets',$1,'statutes','Georgia',array['13131'],'Grady County Ordinances',
       'https://gradycountyga.gov/wp-content/uploads/2025/04/Updated-Grady-County.pdf',72,$2::jsonb,$3::jsonb,'',$4::jsonb,
       to_tsvector('simple','Grady County Ordinances'))`,
    [GRADY, literal("item"), literal("detail"), literal("filters")],
  );
  for (const route of GRADY_ROUTES)
    await db.query(`insert into public.corpus_artifacts values ($1,$2,$3,3153723,'text/plain; charset=utf-8',$4,false)`, [
      route,
      GRADY_SHA,
      `2e/${GRADY_SHA}`,
      `${GRADY_SHA}.txt`,
    ]);
  await db.query(
    `insert into storage.objects values ('corpus-originals',$1,'{"size": 3153723, "mimetype": "text/plain; charset=utf-8"}')`,
    [`2e/${GRADY_SHA}`],
  );
  let n = 0;
  for (const [host, category, state, count] of OTHERS)
    for (let i = 0; i < count; i++) {
      n += 1;
      const rid = md5(`${host}:${category}:${i}`);
      const alias = md5(`doc:${host}:${category}:${i}`);
      const textSha = sha(`${host}:${category}:${i}`);
      const bytes = 3_000_000 + n;
      const url = `https://${host}/${category}-${i}.pdf`;
      const detail = {
        id: `large-text:${rid}`,
        dataset: "large_text_assets",
        metadata: { utf8_bytes: bytes, reader_aliases: [rid, `doc:${alias}`], source_dataset: "focused", display_text_sha256: textSha },
      };
      await db.query(
        `insert into public.corpus_records values ('large_text_assets',$1,$2,$3,'{}',$4,$5,$6,$7::jsonb,$8::jsonb,'',
           '{"_listing": "no"}'::jsonb,null)`,
        [`large-text:${rid}`, category, state, url, url, n, JSON.stringify({ id: `large-text:${rid}` }), JSON.stringify(detail)],
      );
      for (const route of [`/api/text?id=${rid}`, `/api/text?id=doc%3A${alias}`])
        await db.query(`insert into public.corpus_artifacts values ($1,$2,$3,$4,'text/plain; charset=utf-8',$5,false)`, [
          route,
          textSha,
          `${textSha.slice(0, 2)}/${textSha}`,
          bytes,
          `${textSha}.txt`,
        ]);
      if (extraObjectFor === host && i === 0)
        await db.query(`insert into storage.objects values ('corpus-originals',$1,$2::jsonb)`, [
          `${textSha.slice(0, 2)}/${textSha}`,
          JSON.stringify({ size: bytes }),
        ]);
    }
  return db;
}

async function snapshot(db) {
  const q = async (sql) => (await db.query(sql)).rows.map((r) => JSON.stringify(r)).join("\n");
  return {
    datasets: await q(`select id, label, ready, expected_records, imported_records, manifest_sha256, metadata::text m, updated_at::text u
                       from public.corpus_datasets order by id`),
    records: await q(`select dataset, id, md5((to_jsonb(r) - 'search_vector')::text) h from public.corpus_records r order by id`),
    artifacts: await q(`select route, ready from public.corpus_artifacts order by route`),
  };
}

test("the survey pins match the live before-images rebuilt from the rollback", async () => {
  const db = await seed();
  const [{ m }] = (await db.query(`select md5(metadata::text) m from public.corpus_datasets where id='large_text_assets'`)).rows;
  assert.equal(m, "6a920e34bc334ea6fedfee88e35ea31d");
  const [{ h }] = (
    await db.query(`select md5((to_jsonb(r) - 'search_vector')::text) h from public.corpus_records r where id=$1`, [GRADY])
  ).rows;
  assert.equal(h, "32eeb8bdf92a1b10d2ccf7f9c627efda");
});

test("releases the one stored official text and records why the other 77 stay held", async () => {
  const db = await seed();
  await db.exec(CONTRACT);
  const ds = (await db.query(`select id, ready, expected_records, imported_records, metadata from public.corpus_datasets order by id`)).rows;
  const held = ds.find((d) => d.id === "large_text_assets");
  const off = ds.find((d) => d.id === "large_text_official");
  assert.equal(off.ready, true);
  assert.equal(Number(off.imported_records), 1);
  assert.equal(held.ready, false);
  assert.equal(Number(held.expected_records), 77);
  assert.equal(Number(held.imported_records), 77);
  assert.deepEqual(held.metadata.categories, { statutes: 63, guidance: 6, regulations: 5, constitutions: 3 });
  assert.deepEqual(
    held.metadata.hold.reasons.map((r) => [r.rule, r.rows]),
    [
      ["statute_source_official_publisher_only", 44],
      ["stored_text_missing", 33],
    ],
  );
  assert.equal(held.metadata.reader_only, true, "the rest of the bundle metadata is kept");

  const [rec] = (await db.query(`select * from public.corpus_records where dataset='large_text_official'`)).rows;
  assert.equal(rec.id, GRADY);
  assert.equal(rec.item.dataset, "large_text_official");
  assert.equal(rec.detail.dataset, "large_text_official");
  assert.equal(rec.filters._listing, "yes");
  assert.deepEqual(
    rec.detail.links.map((l) => l.url),
    [
      "/api/text?id=f6f572ee6ca009b460712aac316397d6",
      "/files/0ee5263f40c92141ced0dbfcd86505ba",
      "https://gradycountyga.gov/wp-content/uploads/2025/04/Updated-Grady-County.pdf",
      "#record/county_litigation/county-litigation%3A0cc4bbcfb4cd6c81e6e2d0d7d44963f1",
    ],
  );
  assert.equal(rec.detail.metadata.display_text_sha256, GRADY_SHA, "provenance fields are kept");
  assert.equal(rec.detail.metadata.source_dataset, undefined, "staging label dropped");
  assert.equal(rec.filters.source_dataset, undefined, "staging label dropped from filters");
  assert.equal(rec.title, "Grady County Ordinances");

  const ready = (await db.query(`select route from public.corpus_artifacts where ready order by route`)).rows.map((r) => r.route);
  assert.deepEqual(ready, [...GRADY_ROUTES].sort());
  const notReady = (await db.query(`select count(*)::int n from public.corpus_artifacts where not ready`)).rows[0].n;
  assert.equal(notReady, 154);
});

test("refuses to run twice", async () => {
  const db = await seed();
  await db.exec(CONTRACT);
  await assert.rejects(db.exec(CONTRACT), /already exists/);
});

test("refuses when the stored-object split drifts from the survey", async () => {
  const db = await seed({ extraObjectFor: "www.ncleg.gov" });
  await assert.rejects(db.exec(CONTRACT), /Selection rule no longer gives the surveyed split/);
  await db.exec("rollback");
  const after = (await db.query(`select count(*)::int n from public.corpus_datasets`)).rows[0].n;
  assert.equal(after, 1, "nothing was written");
});

test("rollback restores the exact before-images", async () => {
  const db = await seed();
  const before = await snapshot(db);
  await db.exec(CONTRACT);
  await db.exec(ROLLBACK);
  assert.deepEqual(await snapshot(db), before);
});

test("rollback refuses when large_text_official holds anything else", async () => {
  const db = await seed();
  await db.exec(CONTRACT);
  await db.exec(`insert into public.corpus_records (dataset, id, category, title) values ('large_text_official','x','statutes','x')`);
  await assert.rejects(db.exec(ROLLBACK), /does not hold exactly/);
});
