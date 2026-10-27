// Isolated PostgreSQL contract test for database/contracts/court-reference-release-20261027.sql and its rollback.
// A throwaway in-memory PGlite database with the 253 manifest artifact rows, synthetic records and a court_spine row for
// every id but aoc, cbca and compliance; the six kept-out records (ilsd, mdd, nyappdiv: wrong-court seal; aoc, cbca,
// compliance: seal-only, no court_spine court) are rebuilt in the exact live shape so the contract's before-image digests
// must match.
// No credentials, network or live corpus.
// Run: node --test scripts/admin/court-reference-release.contract.test.mjs   (from the repository root; needs the private
// PGlite runtime, or PUBLISHER_CODE_PGLITE pointing at @electric-sql/pglite/dist/index.js)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);

const CONTRACT = await fs.readFile("database/contracts/court-reference-release-20261027.sql", "utf8");
const ROLLBACK = await fs.readFile("database/contracts/court-reference-release-20261027.rollback.sql", "utf8");
const MANIFEST = (await fs.readFile("database/contracts/court-reference-seals-20261027.sha256", "utf8"))
  .replace(/\r/g, "")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [id, sha256, bytes] = line.split(" ");
    return { id, sha256, bytes: Number(bytes) };
  });
const RUN = "c36e2186-fb92-42bb-8632-4bd599772cff";

const MOCK = `
create schema storage;
create table storage.objects (bucket_id text, name text, metadata jsonb, primary key (bucket_id, name));
create schema corpus_ingest;
create table corpus_ingest.runs (id uuid primary key, contract_version text, status text not null check (status in ('running','partial','completed','failed')),
  scope jsonb not null check (jsonb_typeof(scope) = 'object'), started_at timestamptz default now(), finished_at timestamptz, counts jsonb);
create table corpus_ingest.cleanup_decisions (dataset text, record_id text, issue text,
  disposition text check (disposition in ('review','canonical_alias','quarantine','label_override')), reason text, evidence jsonb,
  original_record jsonb, replacement jsonb, reviewed_at timestamptz default now(), run_id uuid references corpus_ingest.runs(id),
  primary key (dataset, record_id, issue));
create table public.corpus_datasets (id text primary key, ready boolean, expected_records bigint, imported_records bigint, metadata jsonb, updated_at timestamptz);
create table public.corpus_records (dataset text, id text, category text, state text, county_geoids text[] default '{}', title text default '',
  source_url text, ordinal bigint default 0, item jsonb, detail jsonb default '{}', text text default '', filters jsonb default '{}',
  search_vector tsvector, primary key (dataset, id));
create table public.corpus_artifacts (route text primary key, object_key text, sha256 text, bytes bigint, ready boolean);
`;

const QUAL =
  "Court facts and seals from the Free Law Project court and seal databases, attached to the registry only where the court id is identical. Dates, levels and name forms are the publisher's; they are not a statement that a court sits today. A seal identifies a court; it is not an endorsement and must not be reused to suggest one.";
const SUB = "Hash-verified original, reduced to 256 px. A seal identifies the court; it is not an endorsement.";

/** A court_reference record in the live build's shape. */
function record(id, court, facts, from, names) {
  const seal = { url: `/supplement-files/court_reference/${id}`, label: "Court seal image" };
  const sections = [
    { items: [{ links: [seal], title: court, subtitle: SUB }], heading: "Court seal" },
    { rows: [[from, "present", ""]], header: ["From", "To", "Note"], heading: "When the court existed (publisher record)" },
  ];
  if (names) sections.push({ text: names, heading: "Names this court appears under in case captions" });
  const text = [
    `${id} Free Law Project court and seal databases, matched by court id`,
    facts.map(([k, v]) => `${k} ${v}`).join(" "),
    `Court seal ${court} ${SUB} Court seal image When the court existed (publisher record) From To Note ${from} present `,
    names ? `Names this court appears under in case captions ${names}` : null,
    `Open in the court registry ${QUAL}`,
  ]
    .filter((p) => p !== null)
    .join(" ");
  return {
    id,
    title: court,
    item: { id, cells: { id, court, origin: "Hash-verified original" }, links: [seal], title: court, badges: [], subtitle: "" },
    detail: {
      facts,
      links: [{ url: `#courts?q=${id}`, label: "Open in the court registry" }],
      title: id,
      sections,
      subtitle: "Free Law Project court and seal databases, matched by court id",
      qualification: QUAL,
    },
    text,
  };
}

const KEPT = [
  record("ilsd", "District Court, S.D. Illinois",
    [["Cited as", "S.D. Ill."], ["Court type", "Trial"], ["Place", "Illinois"], ["Parent court", "United States District Court"]], "1855-02-13"),
  record("mdd", "District Court, D. Maryland", [["Cited as", "D. Md."], ["Court type", "Trial"], ["Place", "Maryland"]], "1789-09-24",
    "Untied States District Court District of Maryland; United States District District of Maryland"),
  record("nyappdiv", "Appellate Division of the Supreme Court of the State of New York",
    [["Cited as", "N.Y. App. Div."], ["Court type", "Appellate"], ["Place", "New York"]], "1896-01-01",
    "2nd 11th And 13th Judicial Districts; State of New York Supreme Court County of New York Appellate Division First Department Court of Appeals; State of New York Appellate Division; New York Appellate Division; Supreme Court of New York Appellate Divsion; Supreme Court Appellate Division; Supreme Ourt Appellate Division Fourth Department; Supreme Court First Department; Court Appellate Term 2Nd 11Th And 13Th Judicial Districts; 2Nd 11Th And 13Th Judicial Districts; Supreme Court, Appellate Division"),
];

/** A seal-only court_reference record (no courts-db facts) in the live build's shape: aoc, cbca, compliance. */
function sealOnly(id, court, subtitle, origin, ordinal) {
  const seal = { url: `/supplement-files/court_reference/${id}`, label: "Court seal image" };
  return {
    id,
    title: court,
    ordinal,
    item: { id, cells: { id, court, origin }, links: [seal], title: court, badges: [], subtitle: "" },
    detail: {
      facts: [],
      links: [{ url: `#courts?q=${id}`, label: "Open in the court registry" }],
      title: id,
      sections: [{ items: [{ links: [seal], title: court, subtitle }], heading: "Court seal" }],
      subtitle: "Free Law Project court and seal databases, matched by court id",
      qualification: QUAL,
    },
    text: `${id} Free Law Project court and seal databases, matched by court id  Court seal ${court} ${subtitle} Court seal image Open in the court registry ${QUAL}`,
  };
}

const UNBOUND = [
  sealOnly("aoc", "Administrative Office of the United States Courts",
    "Project rendition of an SVG original; not hash-verified. A seal identifies the court; it is not an endorsement.", "Project rendition", 4),
  sealOnly("cbca", "Civilian Board of Contract Appeals", SUB, "Hash-verified original", 10),
  sealOnly("compliance", "Office of Compliance, United States Congress", SUB, "Hash-verified original", 145),
];
// md5(item) || md5(detail) || md5(text) of the live rows, read 2026-10-27 (the contract's before-images)
const LIVE_UNBOUND_MD5 = {
  aoc: "f6f4d6bf8604b30ea192a725d11a085154761f62e8f2ee2a839fa78fd171aab0b9c30fe78895b5056b352ba41e1648cf",
  cbca: "6b7f11755106d3da21ff246c639cc59f648982d736a159887f4230e1b6c14f9d1a14756eaaf43a9e547500c325d4908b",
  compliance: "e015f25af49bc5315bb604ac9b12ad484b60564735d0d0590c2d389051c57b7e6c5cf781381c954d2373d339846f03dc",
};

async function seed({ upload = true, spine = true } = {}) {
  const db = new PGlite();
  await db.exec(MOCK);
  await db.query(
    `insert into public.corpus_datasets values ('court_reference', false, 253, 253,
      '{"ready": false, "source": "flp", "listing": {"total": 253, "limit": 400}, "listing_modes": {"default": {"total": 253}}, "summary": {"records": 253}}', null)`,
  );
  const kept = new Map([...KEPT, ...UNBOUND].map((r) => [r.id, r]));
  const unbound = new Set(UNBOUND.map((r) => r.id));
  for (const row of MANIFEST) {
    const r = kept.get(row.id) ?? record(row.id, `Court ${row.id}`, [["Court type", "Trial"]], "1900-01-01");
    await db.query(
      `insert into public.corpus_records (dataset, id, category, state, county_geoids, title, source_url, ordinal, item, detail, text, filters, search_vector)
       values ('court_reference', $1, 'court_reference', '', '{}', $2, '', $3, $4, $5, $6, '{"_listing": ["yes"]}', to_tsvector('simple', $6))`,
      [r.id, r.title, r.ordinal ?? 0, JSON.stringify(r.item), JSON.stringify(r.detail), r.text],
    );
    if (spine && !unbound.has(row.id))
      await db.query(
        `insert into public.corpus_records (dataset, id, category, title, item) values ('court_spine', $1, 'courts', $1, '{}')`,
        [row.id],
      );
    const key = `${row.sha256.slice(0, 2)}/${row.sha256}`;
    await db.query(`insert into public.corpus_artifacts values ($1, $2, $3, $4, false)`, [
      `/supplement-files/court_reference/${row.id}`, key, row.sha256, row.bytes,
    ]);
    if (upload)
      await db.query(
        `insert into storage.objects values ('corpus-originals', $1, $2) on conflict do nothing`,
        [key, JSON.stringify({ size: row.bytes })],
      );
  }
  return db;
}

const one = async (db, sql) => (await db.query(sql)).rows[0];
const digest = (db) =>
  db.query(
    `select id, md5(item::text) || md5(detail::text) || md5(text) as m,
            md5(row(category, state, county_geoids, title, source_url, ordinal, filters)::text) as cols
       from public.corpus_records where dataset = 'court_reference' order by id`,
  ).then((r) => r.rows);
const HELD = ["aoc", "cbca", "compliance", "ilsd", "mdd", "nyappdiv"];

test("fixtures rebuild the live seal-only rows byte-for-byte", async () => {
  const db = await seed();
  const rows = await digest(db);
  for (const [id, m] of Object.entries(LIVE_UNBOUND_MD5)) assert.equal(rows.find((r) => r.id === id).m, m, id);
  await db.close();
});

test("release opens the dataset and 247 seals, keeps six seals and three seal-only records out, and rolls back exactly", async () => {
  const db = await seed();
  const before = await digest(db);
  await db.exec(CONTRACT);

  const ds = await one(db, `select ready, expected_records::int, imported_records::int, metadata from public.corpus_datasets where id = 'court_reference'`);
  assert.equal(ds.ready, true);
  assert.equal(ds.metadata.ready, true);
  assert.equal(ds.metadata.source, "flp");
  assert.equal(ds.expected_records, 250);
  assert.equal(ds.imported_records, 250);
  assert.equal(ds.metadata.listing.total, 250);
  assert.equal(ds.metadata.listing.limit, 400);
  assert.equal(ds.metadata.listing_modes.default.total, 250);
  assert.equal(ds.metadata.summary.records, 253, "the export receipt is unchanged");
  assert.deepEqual(ds.metadata.release_20261027.kept_held.map((k) => k.route.split("/").pop()), ["ilsd", "mdd", "nyappdiv"]);
  assert.deepEqual(ds.metadata.release_20261027.records_kept_held.map((k) => k.court_id), ["aoc", "cbca", "compliance"]);

  const art = await one(db, `select count(*) filter (where ready)::int as ready,
      string_agg(route, ',' order by route) filter (where not ready) as held from public.corpus_artifacts`);
  assert.equal(art.ready, 247);
  assert.equal(art.held, HELD.map((id) => `/supplement-files/court_reference/${id}`).join(","));

  // aoc, cbca, compliance left corpus_records; their complete rows are in the ledger
  const live = await one(db, `select count(*)::int as n, count(*) filter (where id in ('aoc','cbca','compliance'))::int as unbound
      from public.corpus_records where dataset = 'court_reference'`);
  assert.deepEqual(live, { n: 250, unbound: 0 });
  const archived = await db.query(`select record_id, original_record from corpus_ingest.cleanup_decisions
      where issue = 'court_reference_no_court_spine_id' order by record_id`);
  assert.deepEqual(archived.rows.map((r) => r.record_id), ["aoc", "cbca", "compliance"]);
  for (const r of archived.rows) {
    assert.equal(r.original_record.dataset, "court_reference");
    assert.ok(!("search_vector" in r.original_record) && !("body" in r.original_record) && !("sha256" in r.original_record));
  }
  // insd shares the ilsd file and is released
  assert.equal((await one(db, `select ready from public.corpus_artifacts where route like '%/insd'`)).ready, true);

  for (const k of KEPT) {
    const r = await one(db, `select item, detail, text from public.corpus_records where dataset = 'court_reference' and id = '${k.id}'`);
    assert.deepEqual(r.item.links, []);
    assert.deepEqual(r.detail.facts, k.detail.facts, `${k.id} keeps its facts`);
    assert.equal(r.detail.sections[0].items[0].title, "Seal not shown");
    assert.deepEqual(r.detail.sections.slice(1), k.detail.sections.slice(1), `${k.id} keeps the other sections in order`);
    assert.ok(!JSON.stringify(r).includes("/supplement-files/"), `${k.id} links no seal`);
    assert.ok(r.text.includes("Seal not shown") && !r.text.includes("Court seal image"));
  }
  const ledger = await db.query(`select record_id from corpus_ingest.cleanup_decisions where run_id = '${RUN}' order by record_id`);
  assert.deepEqual(ledger.rows.map((r) => r.record_id), HELD);

  // other records are untouched
  const after = new Map((await digest(db)).map((r) => [r.id, r]));
  const changed = before.filter((r) => after.get(r.id)?.m !== r.m || after.get(r.id)?.cols !== r.cols).map((r) => r.id);
  assert.deepEqual(changed, HELD);

  await db.exec(ROLLBACK);
  assert.deepEqual(await digest(db), before);
  const ds2 = await one(db, `select ready, expected_records::int, imported_records::int, metadata from public.corpus_datasets`);
  assert.equal(ds2.ready, false);
  assert.equal(ds2.metadata.ready, false);
  assert.equal(ds2.expected_records, 253);
  assert.equal(ds2.imported_records, 253);
  assert.equal(ds2.metadata.listing.total, 253);
  assert.equal(ds2.metadata.listing_modes.default.total, 253);
  assert.equal("release_20261027" in ds2.metadata, false);
  assert.equal((await one(db, `select count(*)::int as n from public.corpus_artifacts where ready`)).n, 0);
  assert.equal((await one(db, `select count(*)::int as n from corpus_ingest.cleanup_decisions`)).n, 0);
  assert.equal((await one(db, `select status from corpus_ingest.runs`)).status, "failed");
  await db.close();
});

test("preflight refuses when an unbound id gained a court_spine row", async () => {
  const db = await seed();
  await db.query(`insert into public.corpus_records (dataset, id, category, title, item) values ('court_spine', 'cbca', 'courts', 'cbca', '{}')`);
  await assert.rejects(db.exec(CONTRACT), /PREFLIGHT: 1 unbound records changed or gained a court_spine row/);
  await db.exec("rollback");
  assert.equal((await one(db, `select count(*)::int as n from public.corpus_records where dataset = 'court_reference'`)).n, 253);
  await db.close();
});

test("preflight refuses when another court_reference id lacks a court_spine row", async () => {
  const db = await seed();
  await db.query(`delete from public.corpus_records where dataset = 'court_spine' and id = 'akd'`);
  await assert.rejects(db.exec(CONTRACT), /no longer exactly aoc, cbca, compliance/);
  await db.exec("rollback");
  assert.equal((await one(db, `select ready from public.corpus_datasets`)).ready, false);
  await db.close();
});

test("preflight refuses before the seal objects are uploaded and changes nothing", async () => {
  const db = await seed({ upload: false });
  await assert.rejects(db.exec(CONTRACT), /PREFLIGHT: 253 seal artifacts have no stored object/);
  await db.exec("rollback");
  assert.equal((await one(db, `select ready from public.corpus_datasets`)).ready, false);
  assert.equal((await one(db, `select count(*)::int as n from corpus_ingest.runs`)).n, 0);
  await db.close();
});

test("preflight refuses when a kept-out record changed since the review", async () => {
  const db = await seed();
  await db.query(`update public.corpus_records set text = text || ' ' where id = 'mdd'`);
  await assert.rejects(db.exec(CONTRACT), /PREFLIGHT: 1 kept-out records or seal files changed/);
  await db.exec("rollback");
  assert.equal((await one(db, `select count(*)::int as n from public.corpus_artifacts where ready`)).n, 0);
  await db.close();
});
