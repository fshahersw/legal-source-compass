// Isolated PostgreSQL contract test for database/contracts/release-held-artifacts-20261027.sql (+ rollback) and
// database/contracts/withdraw-trellis-ready-files-20261027.sql (+ rollback).
// A throwaway in-memory PGlite database in the live shape surveyed on 2026-10-27, with one synthetic route per case the
// selection rule distinguishes. The contract's pinned live counts are rewritten to the synthetic counts; nothing else changes.
// No credentials, network or live corpus.
// Run: node --test scripts/admin/held-artifact-release.contract.test.mjs   (from the repository root; needs the private
// PGlite runtime, or PUBLISHER_CODE_PGLITE pointing at @electric-sql/pglite/dist/index.js)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { dryRunSql, evaluationQuery } from "./held-artifact-release-dryrun.mjs";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);

const CONTRACT = await fs.readFile("database/contracts/release-held-artifacts-20261027.sql", "utf8");
const ROLLBACK = await fs.readFile("database/contracts/release-held-artifacts-20261027.rollback.sql", "utf8");
const WITHDRAW = await fs.readFile("database/contracts/withdraw-trellis-ready-files-20261027.sql", "utf8");
const WITHDRAW_ROLLBACK = await fs.readFile("database/contracts/withdraw-trellis-ready-files-20261027.rollback.sql", "utf8");

const MOCK = `
create schema storage;
create schema corpus_ingest;
create table storage.objects (bucket_id text, name text, metadata jsonb, primary key (bucket_id, name));
create table public.corpus_records (dataset text, id text, category text, state text, county_geoids text[], title text,
  source_url text, ordinal bigint, item jsonb, detail jsonb, text text, filters jsonb, search_vector tsvector,
  primary key (dataset, id));
create table public.corpus_artifacts (route text primary key, sha256 text not null, object_key text not null, bytes bigint not null,
  mime text not null, filename text, ready boolean not null);
`;

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** One artifact: route, ready, bytes, stored object present?, optional shared content key (same sha256). */
function art(route, { ready = false, bytes = 1000, stored = true, content = route } = {}) {
  const digest = sha(content);
  return { route, ready, bytes, stored, sha256: digest, object_key: `${digest.slice(0, 2)}/${digest}` };
}

const CD = (id) => `/supplement-files/court_documents/court-expansion-artifact:${id}`;
const ARTS = [
  art(CD("gov1"), { bytes: 101 }), // linked from a uscourts.gov record -> released
  art(CD("cellhost"), { bytes: 102 }), // record without source_url, cells.host pacourts.us -> released
  art(CD("lasc"), { bytes: 103 }), // vetted non-.gov court host -> released
  art(CD("orphan"), { bytes: 101, content: CD("gov1") }), // no record; same bytes as gov1 -> released (inherited)
  art(CD("nobytes"), { bytes: 104, stored: false }), // linked, official, but bytes never uploaded -> untouched
  art("/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1", { bytes: 201 }), // focused, county .gov -> released
  art("/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2", { bytes: 202 }), // focused, olls.info -> held
  art("/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3", { bytes: 203 }), // focused, trellis.law -> held (commercial)
  art("/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4", { bytes: 204 }), // seeger, gov and olls.info both link it -> held (deny wins)
  art("/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5", { bytes: 205, ready: true }), // already ready, gov -> untouched
  art("/files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1", { bytes: 301, ready: true }), // ready trellis judge directory -> withdrawal
  art("/supplement-files/source_documents/1", { bytes: 401 }), // naic.org -> held (copyright)
  art("/supplement-files/source_documents/2", { bytes: 402 }), // ca1.uscourts.gov -> released
  art("/mdl-files/jpmldoc-1113fa70c31288db", { bytes: 501 }), // explicit JPML -> released
  art("/library-assets/mdl-pdf-4f687a5a09a3ea65a3c12d21", { bytes: 502 }), // explicit D.N.J. docket -> released
  art("/api/text?id=x", { bytes: 601 }), // out of scope (other workstream) -> untouched
  art("/api/trellis-coverage/receipt?id=tc-1", { bytes: 602 }), // out of scope (commercial) -> untouched
  art("/supplement-files/court_reference/ca1", { bytes: 603 }), // out of scope (other workstream) -> untouched
];

const RECORDS = [
  ["court_documents", "court-expansion-artifact:gov1", "https://www.uscourts.gov/forms/ao435.pdf", { links: [{ url: CD("gov1") }] }],
  ["court_documents", "state-court-artifact:cellhost", "", { cells: { host: "pacourts.us" }, links: [{ url: "http://www.pacourts.us/x.pdf" }, { url: CD("cellhost") }] }],
  ["court_documents", "court-expansion-artifact:lasc", "https://www.lasc.org/rules.pdf", { links: [{ url: CD("lasc") }] }],
  ["court_documents", "court-expansion-artifact:nobytes", "https://www.uscourts.gov/y.pdf", { links: [{ url: CD("nobytes") }] }],
  ["focused", "f1", "https://adaircounty.iowa.gov/", { original_url: "/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1" }],
  ["focused", "f2", "https://olls.info/crs.pdf", { original_url: "/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2" }],
  ["focused", "f3", "https://trellis.law/judges/ak", { original_url: "/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3" }],
  ["focused", "f4", "https://olls.info/other.pdf", { extracted_url: "/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4" }],
  ["seeger", "s4", "https://www.uscourts.gov/z.pdf", { original_url: "/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4" }],
  ["focused", "f5", "https://www.uscourts.gov/r.pdf", { original_url: "/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5" }],
  ["focused", "f6", "https://trellis.law/judges/al", { kind: "judge_directory", original_url: "/files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1" }],
  ["source_documents", "1", "https://content.naic.org/vm.pdf", { links: [{ url: "/supplement-files/source_documents/1" }] }],
  ["source_documents", "2", "https://www.ca1.uscourts.gov/rules.pdf", { links: [{ url: "/supplement-files/source_documents/2" }] }],
];

const RELEASED = [CD("gov1"), CD("cellhost"), CD("lasc"), CD("orphan"), "/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
  "/supplement-files/source_documents/2", "/mdl-files/jpmldoc-1113fa70c31288db", "/library-assets/mdl-pdf-4f687a5a09a3ea65a3c12d21"];
const RELEASED_BYTES = 101 + 102 + 103 + 101 + 201 + 402 + 501 + 502;

/** Rewrite the live pins to the synthetic counts. */
function pinned(sql, { total, released, bytes, olls, naic }) {
  return sql
    .replace("v_total <> 27722", `v_total <> ${total}`)
    .replace("v_rel <> 27652", `v_rel <> ${released}`)
    .replace("v_rel_bytes <> 11935908095", `v_rel_bytes <> ${bytes}`)
    .replace("v_olls <> 48", `v_olls <> ${olls}`)
    .replace("v_naic <> 22", `v_naic <> ${naic}`)
    .replace("if v_flipped <> 27652 then raise exception 'Released % routes, expected 27652'",
      `if v_flipped <> ${released} then raise exception 'Released % routes, expected ${released}'`);
}

async function seed(extra = []) {
  const db = new PGlite();
  await db.exec(MOCK);
  for (const a of [...ARTS, ...extra.filter((e) => e.route)]) {
    await db.query(`insert into public.corpus_artifacts values ($1,$2,$3,$4,'application/pdf',null,$5)`,
      [a.route, a.sha256, a.object_key, a.bytes, a.ready]);
    if (a.stored)
      await db.query(`insert into storage.objects values ('corpus-originals',$1,$2::jsonb) on conflict do nothing`,
        [a.object_key, JSON.stringify({ size: a.bytes })]);
  }
  for (const [dataset, id, url, item] of [...RECORDS, ...extra.filter((e) => Array.isArray(e))]) {
    await db.query(`insert into public.corpus_records (dataset, id, source_url, item, detail) values ($1,$2,$3,$4::jsonb,'{}'::jsonb)`,
      [dataset, id, url, JSON.stringify(item)]);
  }
  return db;
}

const dump = async (db) =>
  md5(JSON.stringify((await db.query(`select route, ready from public.corpus_artifacts order by route`)).rows));
const readyRoutes = async (db) =>
  (await db.query(`select route from public.corpus_artifacts where ready order by route`)).rows.map((r) => r.route);

// 8 released + 2 olls (…2, …4) + 1 trellis (…3) + 1 naic = 12 evaluated; the trellis one is a deny, so "other" must allow it.
const PINS = { total: 12, released: RELEASED.length, bytes: RELEASED_BYTES, olls: 2, naic: 1 };

test("dry-run helper reuses the contract's own evaluation", () => {
  const q = evaluationQuery(CONTRACT);
  assert.ok(q.startsWith("with held as ("));
  assert.ok(q.trim().endsWith("group by h.route, h.family, h.sha256, h.bytes"));
  assert.ok(dryRunSql("summary", CONTRACT).includes(q));
  assert.equal(evaluationQuery(CONTRACT.replace(/\n/g, "\r\n")), q, "CRLF checkouts give the same query");
});

test("release flips exactly the official, stored routes; rollback restores the exact state", async () => {
  const db = await seed();
  const before = await dump(db);
  // The trellis-host route is a deny, so it is counted outside released/olls/naic: relax "other" for this fixture only.
  const sql = pinned(CONTRACT, PINS).replace("or v_other <> 0", "or v_other <> 1");
  await db.exec(sql);
  const ready = await readyRoutes(db);
  for (const r of RELEASED) assert.ok(ready.includes(r), `${r} released`);
  for (const r of ["/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2", "/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3",
    "/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4", "/supplement-files/source_documents/1", CD("nobytes"),
    "/api/text?id=x", "/api/trellis-coverage/receipt?id=tc-1", "/supplement-files/court_reference/ca1"])
    assert.ok(!ready.includes(r), `${r} stays held`);
  const ledger = (await db.query(
    `select route, decision, inherited, provenance_hosts from corpus_ingest.held_artifact_release_20261027 order by route`)).rows;
  assert.equal(ledger.length, 12);
  const by = Object.fromEntries(ledger.map((r) => [r.route, r]));
  assert.equal(by["/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2"].decision, "held:statute_publisher_unconfirmed");
  assert.equal(by["/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3"].decision, "held:commercial_legal_publisher");
  assert.equal(by["/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4"].decision, "held:statute_publisher_unconfirmed");
  assert.equal(by["/supplement-files/source_documents/1"].decision, "held:private_publisher_copyright");
  assert.equal(by[CD("orphan")].inherited, true);
  assert.deepEqual(by[CD("orphan")].provenance_hosts, ["www.uscourts.gov"]);
  assert.deepEqual(by[CD("cellhost")].provenance_hosts, ["pacourts.us"]);
  assert.equal(by[CD("nobytes")], undefined, "routes without stored bytes are not evaluated");

  // Applying twice is refused.
  await assert.rejects(db.exec(sql), /ledger exists/);
  await db.exec("rollback").catch(() => {});

  await db.exec(ROLLBACK.replace("v_ledger <> 27722 or v_released <> 27652", `v_ledger <> 12 or v_released <> ${RELEASED.length}`));
  assert.equal(await dump(db), before);
  assert.equal((await db.query(`select to_regclass('corpus_ingest.held_artifact_release_20261027') as t`)).rows[0].t, null);
});

test("an unvetted host aborts the release before anything changes", async () => {
  const unvetted = art("/files/ccccccccccccccccccccccccccccccc1", { bytes: 701 });
  const db = await seed([unvetted, ["focused", "u1", "https://some-unknown-site.example.com/a.pdf",
    { original_url: unvetted.route }]]);
  const before = await dump(db);
  await assert.rejects(db.exec(pinned(CONTRACT, PINS).replace("or v_other <> 0", "or v_other <> 1")),
    /Evaluation differs from the survey/);
  await db.exec("rollback").catch(() => {});
  assert.equal(await dump(db), before);
  assert.equal((await db.query(`select to_regclass('corpus_ingest.held_artifact_release_20261027') as t`)).rows[0].t, null);
});

test("a changed live state aborts at the preflight", async () => {
  const db = await seed();
  const before = await dump(db);
  await assert.rejects(db.exec(CONTRACT), /Evaluation differs from the survey/);
  await db.exec("rollback").catch(() => {});
  assert.equal(await dump(db), before);
});

test("trellis withdrawal turns off only ready trellis-only routes; rollback restores them", async () => {
  const db = await seed();
  const before = await dump(db);
  const route = "/files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1";
  const sql = WITHDRAW.replace("v_n <> 45 or v_bytes <> 11575411 or v_md5 is distinct from '6d515a3f5e34dfbe34721265f713ffcd'",
    `v_n <> 1 or v_bytes <> 301 or v_md5 is distinct from '${md5(route)}'`);
  await db.exec(sql);
  const ready = await readyRoutes(db);
  assert.ok(!ready.includes(route));
  assert.ok(ready.includes("/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5"), "official ready route untouched");
  await db.exec(WITHDRAW_ROLLBACK.replace("if v_n <> 45 then raise exception 'Ledger has % ready_before routes, expected 45'",
    "if v_n <> 1 then raise exception 'Ledger has % ready_before routes, expected 1'"));
  assert.equal(await dump(db), before);
});
