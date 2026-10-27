// Offline PostgreSQL contract test for database/contracts/cl-docket-metadata-fields-v2.sql and its rollback (pglite).
// No credentials, network or live corpus: a throwaway in-memory database with the tables the contract reads and writes,
// filled with synthetic dockets.
//   node --test scripts/admin/cl-docket-metadata-fields.contract.test.mjs
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
const CONTRACT = await fs.readFile("database/contracts/cl-docket-metadata-fields-v2.sql", "utf8");
const ROLLBACK = await fs.readFile("database/contracts/cl-docket-metadata-fields-v2.rollback.sql", "utf8");

// Split the contract at its "-- ===== step N" markers.
const STEPS = Object.fromEntries(
  CONTRACT.split(/^-- =+ step (\d+)[^\n]*\n/m)
    .slice(1)
    .reduce((acc, part, i, arr) => (i % 2 === 0 ? [...acc, [part, arr[i + 1]]] : acc), []),
);
const withWindow = (lo, hi) =>
  STEPS["2"].replace(
    "select 0::bigint as lower_ordinal_exclusive, 25000::bigint as upper_ordinal_inclusive",
    `select ${lo}::bigint as lower_ordinal_exclusive, ${hi}::bigint as upper_ordinal_inclusive`,
  );

const MOCK = `
create role anon; create role authenticated; create role service_role;
create schema corpus_ingest;
create table public.corpus_datasets (id text primary key, ready boolean, metadata jsonb not null default '{}');
create table public.corpus_records (dataset text not null, id text not null, category text, state text, county_geoids text[],
  title text, source_url text, ordinal bigint, item jsonb, detail jsonb, text text, filters jsonb, search_vector tsvector,
  primary key (dataset, id));
create function public.corpus_set_search_vector() returns trigger language plpgsql as $$
begin new.search_vector := to_tsvector('english', coalesce(new.title,'') || ' ' || coalesce(new.text,'')); return new; end $$;
create trigger corpus_records_search_vector_trg before insert or update of title, text, search_vector on public.corpus_records
  for each row execute function public.corpus_set_search_vector();
create table corpus_ingest.entities (source_system text, entity_type text, native_id text, payload_sha256 text,
  schema_version text, data jsonb, provenance jsonb, source_as_of date, retrieved_at timestamptz, last_run uuid, review_status text,
  primary key (source_system, entity_type, native_id));
`;

const bulkRow = (ordinal, nativeId, extra = {}) => ({
  id: `cl:dockets:${nativeId}`,
  ordinal,
  title: `Docket 1:20-cv-0${ordinal}`,
  item: {
    id: `cl:dockets:${nativeId}`,
    title: `Docket 1:20-cv-0${ordinal}`,
    cells: { name: `Docket 1:20-cv-0${ordinal}`, native_id: nativeId, docket_number: `1:20-cv-0${ordinal}`, court_id: "laed",
      mdl_number: "2592", mdl_number_raw: "2592", date_filed: "2020-01-01" },
    links: [{ url: `https://www.courtlistener.com/docket/${nativeId}/`, label: "CourtListener native docket" }],
    badges: ["Metadata only", "FJC source association"],
  },
  detail: {
    id: `cl:dockets:${nativeId}`,
    title: `Docket 1:20-cv-0${ordinal}`,
    facts: [["Native docket ID", nativeId], ["Docket number", `1:20-cv-0${ordinal}`], ["Court ID", "laed"],
      ["Filed (source)", "2020-01-01"], ["FJC MDL number (as recorded)", "2592"]],
    provenance: { projection_schema: "courtlistener-docket-metadata-view/1" },
    qualification: "Captions, names, party contacts, causes and document contents remain private.",
  },
  text: "{}",
  filters: { _listing: "true", court_id: "laed", native_id: nativeId, mdl_number: "2592", selection_basis: "native_fjc_mdl_number" },
  ...extra,
});

const bulkData = (nativeId, over = {}) => ({
  id: nativeId, blocked: "f", date_blocked: null, case_name: "Woodard v. Janssen Research & Development LLC",
  case_name_full: "", case_name_short: "Woodard", cause: "", nature_of_suit: "365 Personal injury - Product liability",
  jury_demand: "", jurisdiction_type: "Federal question", assigned_to_id: "1029", assigned_to_str: "Eldon E. Fallon",
  referred_to_id: "9270", referred_to_str: "Michael North", panel_str: "", appeal_from_str: "", mdl_status: "", ...over,
});

async function fresh() {
  const db = new PGlite();
  await db.exec(MOCK);
  const rows = [
    bulkRow(1, "101"),
    bulkRow(2, "102"),
    bulkRow(3, "103"), // blocked in the bulk header: held
    bulkRow(4, "104"), // blocked in a newer REST version: held
    bulkRow(5, "105", {
      filters: { _listing: "true", court_id: "laed", native_id: "105", mdl_number: "", selection_basis: "header_and_upload_agree" },
    }),
    bulkRow(6, "106"), // quarantined entity: skipped
    bulkRow(7, "107"), // no staged entity: skipped
  ];
  rows[4].detail.provenance = { withheld_fields: ["case_name", "date_last_filing"], caption_agreed_and_withheld: true };
  for (const r of rows) {
    await db.query(
      `insert into public.corpus_records(dataset,id,category,title,ordinal,item,detail,text,filters)
       values ('cl_docket_metadata',$1,'docket_metadata',$2,$3,$4,$5,$6,$7)`,
      [r.id, r.title, r.ordinal, r.item, r.detail, r.text, r.filters],
    );
  }
  const ent = async (nativeId, schema, data, review = "source_metadata") =>
    db.query(
      `insert into corpus_ingest.entities values ('courtlistener','dockets',$1,$2,$3,$4,$5,'2026-09-30','2026-10-02T08:38:15Z',null,$6)`,
      [nativeId, `sha-${nativeId}`, schema, data, { source_url: `https://example.test/${nativeId}`, source_sha256: `src-${nativeId}` }, review],
    );
  await ent("101", "courtlistener-bulk/1", bulkData("101", { jury_demand: "Plaintiff" }));
  await ent("102", "courtlistener-rest-v4.7/1", {
    id: 102, blocked: false, date_blocked: null, case_name: "IN RE: ZANTAC (RANITIDINE) PRODUCTS LIABILITY LITIGATION",
    case_name_short: "", cause: "28:1407 Multidistrict Litigation", nature_of_suit: "367 Personal Injury",
    jury_demand: "Defendant", jurisdiction_type: "Diversity",
    assigned_to: "https://www.courtlistener.com/api/rest/v4/people/2778/", assigned_to_str: "Robin L. Rosenberg",
    referred_to: null, referred_to_str: "", panel_str: "", appeal_from_str: "", mdl_status: "Transferred",
  });
  await ent("103", "courtlistener-bulk/1", bulkData("103", { blocked: "t", date_blocked: "2016-11-15", case_name: "Private Debtor" }));
  await ent("104", "courtlistener-rest-v4.7/1", { blocked: true, date_blocked: "2020-02-03", case_name: "Blocked MDL" });
  await ent("105", "courtlistener-bulk/1", bulkData("105", { case_name: "In Re: Example Litigation" }));
  await ent("106", "courtlistener-bulk/1", bulkData("106"), "quarantined");
  await db.exec(`insert into public.corpus_datasets values ('cl_docket_metadata', true,
    '{"schema_version":"courtlistener-docket-metadata-view/1","qualification":"old","listing":{"columns":[],"filters":[{"name":"mdl_number","type":"select","options":[]}]}}')`);
  return db;
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const rec = (db, id) => one(db, `select * from public.corpus_records where dataset='cl_docket_metadata' and id=$1`, [id]);
const snapshot = async (db) =>
  (await db.query(`select id, md5(jsonb_build_array(title,item,detail,text,filters)::text) h from public.corpus_records order by id`)).rows;

test("contract has the four marked steps", () => {
  assert.deepEqual(Object.keys(STEPS), ["1", "2", "3", "4"]);
});

test("releases CourtListener header fields verbatim and keeps blocked dockets held", async () => {
  const db = await fresh();
  const before = await snapshot(db);
  await db.exec(STEPS["1"]);
  assert.equal((await one(db, `select count(*)::int n from corpus_ingest.cl_docket_metadata_fields_backup_20261027`)).n, 7);

  const receipt = (await one(db, withWindow(0, 25000))).receipt;
  assert.equal(receipt.expected, 3);
  assert.equal(receipt.written, 3);

  const a = await rec(db, "cl:dockets:101");
  assert.equal(a.title, "Woodard v. Janssen Research & Development LLC, No. 1:20-cv-01 (laed)");
  assert.equal(a.item.title, a.title);
  assert.equal(a.detail.title, a.title);
  assert.equal(a.item.cells.name, a.title);
  assert.equal(a.item.cells.case_name, "Woodard v. Janssen Research & Development LLC");
  assert.equal(a.item.cells.cause, null, "empty source string becomes null (Not recorded)");
  assert.equal(a.item.cells.jurisdiction_type, "Federal question", "recorded spelling kept");
  assert.equal(a.item.cells.assigned_to_str, "Eldon E. Fallon");
  assert.equal(a.item.cells.assigned_to_id, "1029");
  assert.equal(a.item.cells.mdl_number, "2592", "FJC label untouched");
  assert.deepEqual(a.item.badges, ["Metadata only", "FJC source association"]);
  assert.deepEqual(
    a.detail.facts.map((f) => f[0]),
    ["Native docket ID", "Docket number", "Court ID", "Case name", "Nature of suit (as recorded)", "Jury demand",
      "Jurisdiction type (as recorded)", "Assigned judge (as recorded)", "Referred judge (as recorded)",
      "Filed (source)", "FJC MDL number (as recorded)"],
  );
  assert.equal(a.detail.provenance.header_source.payload_sha256, "sha-101");
  assert.equal(a.detail.provenance.projection_schema, "courtlistener-docket-metadata-view/1");
  assert.match(a.detail.qualification, /exactly as CourtListener records them/);
  assert.doesNotMatch(a.detail.qualification, /Captions, names/);
  assert.equal(a.filters.nature_of_suit, "365 Personal injury - Product liability");
  assert.equal(a.filters.mdl_number, "2592");
  assert.ok(!JSON.parse(a.text).name, "text omits the display name");
  assert.ok(a.search_vector.includes("janssen"), "search vector regenerated from the new title/text");

  const b = await rec(db, "cl:dockets:102");
  assert.equal(b.item.cells.assigned_to_id, "2778", "REST person URL reduced to its exact id");
  assert.equal(b.item.cells.referred_to_id, null);
  assert.equal(b.item.cells.mdl_status, "Transferred");
  assert.equal(b.detail.facts.find((f) => f[0] === "MDL status (as recorded by CourtListener)")[1], "Transferred");

  const e = await rec(db, "cl:dockets:105");
  assert.equal(e.item.cells.case_name, "In Re: Example Litigation");
  assert.deepEqual(e.detail.provenance.withheld_fields, ["date_last_filing"]);
  assert.equal(e.detail.provenance.caption_agreed_and_withheld, undefined);
  assert.match(e.detail.qualification, /owner upload and the stored CourtListener header agree/);

  const after = new Map((await snapshot(db)).map((r) => [r.id, r.h]));
  for (const held of ["cl:dockets:103", "cl:dockets:104", "cl:dockets:106", "cl:dockets:107"]) {
    assert.equal(after.get(held), before.find((r) => r.id === held).h, `${held} unchanged`);
    assert.ok(!(await rec(db, held)).item.cells.case_name);
  }

  // Idempotent: a second run of the same window writes nothing.
  assert.equal((await one(db, withWindow(0, 25000))).receipt.written, 0);
  // Window guard: wider than 25,000 ordinals writes nothing.
  assert.equal((await one(db, withWindow(0, 25001))).receipt.expected, 0);

  await db.exec(STEPS["3"]);
  const meta = (await one(db, `select metadata from public.corpus_datasets where id='cl_docket_metadata'`)).metadata;
  assert.equal(meta.fields_release_2026_10_27.rows_with_caption, 3);
  // Only the CourtListener-blocked rows count as source-blocked; quarantined / missing-entity rows are counted apart.
  assert.equal(meta.fields_release_2026_10_27.rows_held_source_blocked, 2);
  assert.equal(meta.fields_release_2026_10_27.rows_unreleased_other, 2);
  // 3a: the agreed row with a caption gets its withheld header date from the same entity, labelled (source).
  const agreed = await rec(db, "cl:dockets:105");
  assert.deepEqual(agreed.detail.provenance.withheld_fields, []);
  assert.ok(agreed.detail.facts.some((f) => f[0] === "Last filing (source)"));
  assert.ok("date_last_filing" in agreed.item.cells);
  assert.equal(meta.schema_version, "courtlistener-docket-metadata-view/1");
  const nos = meta.listing.filters.find((f) => f.name === "nature_of_suit");
  assert.deepEqual(nos.options.map((o) => [o.value, o.count]), [
    ["365 Personal injury - Product liability", 2],
    ["367 Personal Injury", 1],
  ]);
  assert.ok(meta.listing.filters.some((f) => f.name === "mdl_number"), "existing filters kept");
  assert.equal(meta.listing.columns[0].key, "name");

  // Rollback restores every row and the dataset metadata exactly.
  await db.exec(ROLLBACK);
  assert.deepEqual(await snapshot(db), before);
  const restored = (await one(db, `select metadata from public.corpus_datasets where id='cl_docket_metadata'`)).metadata;
  assert.equal(restored.qualification, "old");
});

test("a row changed after the backup is not overwritten", async () => {
  const db = await fresh();
  await db.exec(STEPS["1"]);
  await db.exec(`update public.corpus_records set title='Docket changed elsewhere' where id='cl:dockets:101'`);
  const receipt = (await one(db, withWindow(0, 25000))).receipt;
  assert.equal(receipt.written, 2);
  assert.equal((await rec(db, "cl:dockets:101")).title, "Docket changed elsewhere");
});
