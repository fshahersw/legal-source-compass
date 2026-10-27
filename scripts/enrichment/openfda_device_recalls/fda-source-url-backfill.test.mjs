// Offline PostgreSQL test for database/contracts/fda-source-url-backfill-v1.sql (pglite). No credentials or network.
//   node --test scripts/enrichment/openfda_device_recalls/fda-source-url-backfill.test.mjs
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
const SQL = await fs.readFile("database/contracts/fda-source-url-backfill-v1.sql", "utf8");

const CORPUS = `
create table public.corpus_datasets (id text primary key, label text not null, ready boolean not null default false,
  expected_records bigint not null default 0, imported_records bigint not null default 0, manifest_sha256 text,
  metadata jsonb not null default '{}', updated_at timestamptz not null default now());
create table public.corpus_records (dataset text not null references public.corpus_datasets(id), id text not null,
  category text not null check (category <> all (array['', 'unknown', 'uncategorized'])), state text,
  county_geoids text[] not null default '{}', title text not null default '', source_url text, ordinal bigint not null default 0,
  item jsonb not null, detail jsonb not null default '{}', text text not null default '', filters jsonb not null default '{}',
  search_vector tsvector, primary key (dataset, id));
`;

const bulk = (p) => `https://download.open.fda.gov/${p}`;
const ROWS = [
  // dataset, id, publisher_record, bulk file, stored source_url
  ["agency_safety_openfda_drug_enforcement", "openfda:drug/enforcement:D-0001-2026", { recall_number: "D-0001-2026" }, bulk("drug/enforcement/drug-enforcement-0001-of-0001.json.zip"), ""],
  ["agency_safety_openfda_drug_enforcement", "openfda:drug/enforcement:N/A", { recall_number: "N/A", event_id: "99732" }, bulk("drug/enforcement/drug-enforcement-0001-of-0001.json.zip"), ""],
  ["agency_safety_openfda_drug_enforcement", "openfda:drug/enforcement:D-0002-2026", { recall_number: "D-0002-2026" }, null, "https://example.gov/kept"],
  ["agency_safety_openfda_device_enforcement", "openfda:device/enforcement:Z-1974-2021", { recall_number: "Z-1974-2021" }, null, null],
  ["agency_safety_openfda_device_enforcement", "openfda:device/enforcement:x3e9ce04bc947fe", { recall_number: "" }, "https://api.fda.gov/device/enforcement.json?search=report_date:[1+TO+2]", ""],
  ["agency_safety_openfda_food_enforcement", "openfda:food/enforcement:F-1855.2013", { recall_number: "F-1855.2013" }, null, ""],
  ["agency_safety_openfda_device_pma", "openfda:device/pma:P090006:S016", { pma_number: "P090006", supplement_number: "S016" }, null, ""],
  ["agency_safety_openfda_device_pma", "openfda:device/pma:P060040", { pma_number: "P060040", supplement_number: "" }, null, ""],
  ["agency_safety_openfda_device_pma", "openfda:device/pma:N17752:S035", { pma_number: "N17752", supplement_number: "S035" }, null, ""],
  ["agency_safety_openfda_drugsfda", "openfda:drug/drugsfda:NDA19019", { application_number: "NDA19019" }, null, ""],
  ["agency_safety_openfda_drug_shortages", "openfda:drug/shortages:71288-728-32~2", { package_ndc: "71288-728-32" }, null, ""],
  ["agency_safety_openfda_crl", "openfda:transparency/crl:a", { file_name: "208574Orig1s000,Orig2s000OtherActionLtrs.pdf" }, null, ""],
  ["agency_safety_openfda_crl", "openfda:transparency/crl:b", { file_name: "CRL_NDA 217711_20250827.pdf" }, null, ""],
  ["agency_safety_openfda_crl", "openfda:transparency/crl:c", { file_name: "Under Review for Release" }, bulk("transparency/crl/transparency-crl-0001-of-0001.json.zip"), ""],
  ["agency_safety_openfda_crl", "openfda:transparency/crl:d", { file_name: "x'); drop table x; --.pdf" }, null, ""],
];

const EXPECTED = {
  "openfda:drug/enforcement:D-0001-2026": "https://api.fda.gov/drug/enforcement.json?search=recall_number:%22D-0001-2026%22",
  "openfda:drug/enforcement:N/A": bulk("drug/enforcement/drug-enforcement-0001-of-0001.json.zip"),
  "openfda:drug/enforcement:D-0002-2026": "https://example.gov/kept",
  "openfda:device/enforcement:Z-1974-2021": "https://api.fda.gov/device/enforcement.json?search=recall_number:%22Z-1974-2021%22",
  // an API-captured row without a recall number has no record URL and no bulk file: it stays empty
  "openfda:device/enforcement:x3e9ce04bc947fe": "",
  "openfda:food/enforcement:F-1855.2013": "https://api.fda.gov/food/enforcement.json?search=recall_number:%22F-1855.2013%22",
  "openfda:device/pma:P090006:S016": "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=P090006S016",
  "openfda:device/pma:P060040": "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=P060040",
  "openfda:device/pma:N17752:S035": "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=N17752S035",
  "openfda:drug/drugsfda:NDA19019": "https://api.fda.gov/drug/drugsfda.json?search=application_number:%22NDA19019%22",
  "openfda:drug/shortages:71288-728-32~2": "https://api.fda.gov/drug/shortages.json?search=package_ndc:%2271288-728-32%22",
  "openfda:transparency/crl:a": "https://api.fda.gov/transparency/crl.json?search=file_name:%22208574Orig1s000%2COrig2s000OtherActionLtrs.pdf%22",
  "openfda:transparency/crl:b": "https://api.fda.gov/transparency/crl.json?search=file_name:%22CRL_NDA%20217711_20250827.pdf%22",
  "openfda:transparency/crl:c": bulk("transparency/crl/transparency-crl-0001-of-0001.json.zip"),
  "openfda:transparency/crl:d": "",
};

async function seed() {
  const db = new PGlite();
  await db.exec(CORPUS);
  for (const dataset of new Set(ROWS.map((r) => r[0])))
    await db.query("insert into public.corpus_datasets (id, label, metadata) values ($1, $1, $2)", [dataset, { id: dataset }]);
  for (const [i, [dataset, id, publisher_record, final_url, source_url]] of ROWS.entries()) {
    const detail = { id, publisher_record, ...(final_url ? { original_file: { final_url } } : {}) };
    await db.query(
      "insert into public.corpus_records (dataset, id, category, title, source_url, ordinal, item, detail, text) values ($1,$2,'agency_safety',$2,$3,$4,$5,$6,$2)",
      [dataset, id, source_url, i, { id }, detail],
    );
  }
  return db;
}

const urls = async (db) =>
  Object.fromEntries(
    (await db.query("select id, coalesce(source_url, '') as u from public.corpus_records order by ordinal")).rows.map((r) => [r.id, r.u]),
  );

test("sets each record's own official URL, keeps stored URLs, falls back to the bulk file", async () => {
  const db = await seed();
  const before = (await db.query("select id, item, detail, text, filters, title from public.corpus_records order by id")).rows;
  await db.exec(SQL);
  assert.deepEqual(await urls(db), EXPECTED);
  const after = (await db.query("select id, item, detail, text, filters, title from public.corpus_records order by id")).rows;
  assert.deepEqual(after, before, "only source_url changes");
  const rules = (await db.query("select id, metadata->>'source_url_rule' as rule from public.corpus_datasets order by id")).rows;
  assert.equal(rules.length, 7);
  for (const r of rules) assert.match(r.rule, /record|recall|application|NDC|file/);
});

test("is idempotent: a second run changes nothing", async () => {
  const db = await seed();
  await db.exec(SQL);
  const first = await urls(db);
  const stamp = (await db.query("select id, xmin::text as x from public.corpus_records order by id")).rows;
  await db.exec(SQL);
  assert.deepEqual(await urls(db), first);
  assert.deepEqual((await db.query("select id, xmin::text as x from public.corpus_records order by id")).rows, stamp);
});
