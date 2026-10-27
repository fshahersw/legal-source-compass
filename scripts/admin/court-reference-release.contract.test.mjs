// Isolated PostgreSQL contract test for database/contracts/court-reference-release-20261027.sql and its rollback.
// A throwaway in-memory PGlite database with the 253 manifest artifact rows and synthetic records; the three kept-out
// records (ilsd, mdd, nyappdiv) are rebuilt in the exact live shape so the contract's before-image digests must match.
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
create table public.corpus_datasets (id text primary key, ready boolean, imported_records integer, metadata jsonb, updated_at timestamptz);
create table public.corpus_records (dataset text, id text, category text, title text, item jsonb, detail jsonb, text text, primary key (dataset, id));
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

async function seed({ upload = true } = {}) {
  const db = new PGlite();
  await db.exec(MOCK);
  await db.query(
    `insert into public.corpus_datasets values ('court_reference', false, 253, '{"ready": false, "source": "flp"}', null)`,
  );
  const kept = new Map(KEPT.map((r) => [r.id, r]));
  for (const row of MANIFEST) {
    const r = kept.get(row.id) ?? record(row.id, `Court ${row.id}`, [["Court type", "Trial"]], "1900-01-01");
    await db.query(
      `insert into public.corpus_records values ('court_reference', $1, 'court_reference', $2, $3, $4, $5)`,
      [r.id, r.title, JSON.stringify(r.item), JSON.stringify(r.detail), r.text],
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
    `select id, md5(item::text) || md5(detail::text) || md5(text) as m from public.corpus_records
      where dataset = 'court_reference' order by id`,
  ).then((r) => r.rows);

test("release opens the dataset and 250 seals, keeps the three wrong-court seals, and rolls back exactly", async () => {
  const db = await seed();
  const before = await digest(db);
  await db.exec(CONTRACT);

  const ds = await one(db, `select ready, metadata from public.corpus_datasets where id = 'court_reference'`);
  assert.equal(ds.ready, true);
  assert.equal(ds.metadata.ready, true);
  assert.equal(ds.metadata.source, "flp");
  assert.deepEqual(ds.metadata.release_20261027.kept_held.map((k) => k.route.split("/").pop()), ["ilsd", "mdd", "nyappdiv"]);

  const art = await one(db, `select count(*) filter (where ready)::int as ready,
      string_agg(route, ',' order by route) filter (where not ready) as held from public.corpus_artifacts`);
  assert.equal(art.ready, 250);
  assert.equal(art.held, KEPT.map((k) => `/supplement-files/court_reference/${k.id}`).join(","));
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
  const ledger = await db.query(`select record_id, original_record from corpus_ingest.cleanup_decisions where run_id = '${RUN}' order by record_id`);
  assert.deepEqual(ledger.rows.map((r) => r.record_id), ["ilsd", "mdd", "nyappdiv"]);

  // other records are untouched
  const after = await digest(db);
  const changed = after.filter((r, i) => r.m !== before[i].m).map((r) => r.id);
  assert.deepEqual(changed, ["ilsd", "mdd", "nyappdiv"]);

  await db.exec(ROLLBACK);
  assert.deepEqual(await digest(db), before);
  assert.equal((await one(db, `select ready from public.corpus_datasets`)).ready, false);
  assert.equal((await one(db, `select count(*)::int as n from public.corpus_artifacts where ready`)).n, 0);
  assert.equal((await one(db, `select metadata ? 'release_20261027' as has from public.corpus_datasets`)).has, false);
  assert.equal((await one(db, `select status from corpus_ingest.runs`)).status, "failed");
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
