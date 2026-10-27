// Offline PostgreSQL test for database/contracts/fda-warning-letters-sample-source-url-v1.sql (pglite).
//   node --test scripts/enrichment/fda_warning_letters/fda-warning-letters-sample-source-url.test.mjs
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
const SQL = await fs.readFile("database/contracts/fda-warning-letters-sample-source-url-v1.sql", "utf8");

const CORPUS = `
create table public.corpus_datasets (id text primary key, label text not null, ready boolean not null default false,
  expected_records bigint not null default 0, imported_records bigint not null default 0, manifest_sha256 text,
  metadata jsonb not null default '{}', updated_at timestamptz not null default now());
create table public.corpus_records (dataset text not null references public.corpus_datasets(id), id text not null,
  category text not null, state text, county_geoids text[] not null default '{}', title text not null default '',
  source_url text, ordinal bigint not null default 0, item jsonb not null, detail jsonb not null default '{}',
  text text not null default '', filters jsonb not null default '{}', search_vector tsvector, primary key (dataset, id));
`;
const LETTER = "https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/";
const SAMPLE = "agency_safety_fda_warning_letters";
const INDEX = "agency_safety_fda_warning_letters_index";

// [id, posted, issued, company]
const sample = [
  ["fda-wl:a", "2022-01-06", "2022-01-06", "South Coast Vapor Company"],
  ["fda-wl:b", "2025-02-18", "2025-01-29", "AmWiner & Raphe Holdings, LLC  dba rapheGenerics Corp"], // double space as exported
  ["fda-wl:c", "2024-09-03", "2024-08-16", "Twin Store"], // key twice in the sample: left empty
  ["fda-wl:d", "2024-09-03", "2024-08-16", "Twin Store"],
  ["fda-wl:e", "2023-05-01", "2023-04-01", "Shared Index Key Inc."], // key twice in the index: left empty
  ["fda-wl:f", "2023-06-01", "2023-05-01", "Not In Index LLC"],
  ["fda-wl:g", "2021-03-30", "2021-03-29", "South Coast Vapor Company"], // same firm, other dates: its own letter
];
// [slug, posted, issued, company]
const index = [
  ["south-coast-vapor-company-1-01062022", "2022-01-06", "2022-01-06", "South Coast Vapor Company"],
  ["amwiner-raphe-holdings-2-01292025", "2025-02-18", "2025-01-29", "AmWiner & Raphe Holdings, LLC dba rapheGenerics Corp"],
  ["twin-store-3-08162024", "2024-09-03", "2024-08-16", "Twin Store"],
  ["shared-4-04012023", "2023-05-01", "2023-04-01", "Shared Index Key Inc."],
  ["shared-5-04012023", "2023-05-01", "2023-04-01", "Shared Index Key Inc."],
  ["south-coast-vapor-company-6-03292021", "2021-03-30", "2021-03-29", "South Coast Vapor Company"],
];

async function seed({ ready = true } = {}) {
  const db = new PGlite();
  await db.exec(CORPUS);
  await db.query("insert into public.corpus_datasets (id, label, ready) values ($1, $1, true), ($2, $2, $3)", [SAMPLE, INDEX, ready]);
  for (const [i, [id, posted_date, letter_issue_date, company_name]] of sample.entries())
    await db.query(
      "insert into public.corpus_records (dataset, id, category, source_url, ordinal, item, detail) values ($1,$2,'agency_safety','',$3,$4,$5)",
      [SAMPLE, id, i, { id }, { id, fields: { posted_date, letter_issue_date, company_name } }],
    );
  for (const [i, [slug, posted_date, letter_issue_date, company_name]] of index.entries())
    await db.query(
      "insert into public.corpus_records (dataset, id, category, source_url, ordinal, item) values ($1,$2,'agency_safety',$3,$4,$5)",
      [INDEX, `fda-wl:${slug}`, LETTER + slug, i, { letter: { posted_date, letter_issue_date, company_name } }],
    );
  return db;
}

const urls = async (db) =>
  Object.fromEntries(
    (await db.query("select id, source_url from public.corpus_records where dataset = $1 order by id", [SAMPLE])).rows.map((r) => [r.id, r.source_url]),
  );

test("sets the letter page only on a key that is unique on both sides", async () => {
  const db = await seed();
  await db.exec(SQL);
  assert.deepEqual(await urls(db), {
    "fda-wl:a": LETTER + "south-coast-vapor-company-1-01062022",
    "fda-wl:b": LETTER + "amwiner-raphe-holdings-2-01292025",
    "fda-wl:c": "",
    "fda-wl:d": "",
    "fda-wl:e": "",
    "fda-wl:f": "",
    "fda-wl:g": LETTER + "south-coast-vapor-company-6-03292021",
  });
  const rule = (await db.query("select metadata->>'source_url_rule' as r from public.corpus_datasets where id = $1", [SAMPLE])).rows[0].r;
  assert.match(rule, /unique on both sides/);
  await db.exec(SQL);
  assert.equal(Object.values(await urls(db)).filter(Boolean).length, 3, "idempotent");
});

test("does nothing while the index is not ready", async () => {
  const db = await seed({ ready: false });
  await db.exec(SQL);
  assert.ok(Object.values(await urls(db)).every((u) => u === ""));
  const rule = (await db.query("select metadata->>'source_url_rule' as r from public.corpus_datasets where id = $1", [SAMPLE])).rows[0].r;
  assert.equal(rule, null);
});
