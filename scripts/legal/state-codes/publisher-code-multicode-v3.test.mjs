// Isolated PostgreSQL tests for the multi-code extension (corpus-publisher-code-multicode-v3.sql). Fixtures never reach Supabase.
// The primary code lands, is reviewed and is public under the v2 contract BEFORE v3 is applied, to prove the migration
// leaves an existing state's row, review and projection exactly as they were.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalIntegerJson, hashBytes } from "../../admin/local-catalog-evidence-contract.mjs";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve("private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(runtime).href);
const sha = (value) => hashBytes(value);
const points = (text) => [...text].length;
const stamp = "2026-10-06T03:40:00Z";

const PRIMARY = {
  system: "zz-code",
  parser: "zz-fixture",
  url: "https://example.test/code/",
  regex: "^[0-9]+\\.[0-9]+$",
  example: "1.01",
  path: "1.01",
  unit: "t1",
  heading: "FIXTURE",
  title: "Fixture Code",
  levels: ["title", "section"],
  run: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  original: "synthetic original",
  unitText: "Title 1\nSec. 1.01. FIXTURE TEXT.\n",
  sectionText: "FIXTURE TEXT.\n",
};
const SECOND = {
  system: "zz-civil",
  parser: "zz-civil-fixture",
  url: "https://example.test/civil/",
  regex: "^art-[0-9]+$",
  example: "art-1",
  path: "art-1",
  unit: "c1",
  heading: "CIVIL FIXTURE",
  title: "Fixture Civil Code",
  levels: ["book", "section"],
  run: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  original: "synthetic civil original",
  unitText: "Book 1\nArt. 1. CIVIL TEXT.\n",
  sectionText: "CIVIL TEXT.\n",
};

const manifest = (c) => ({
  schema_version: "publisher-code-manifest/2",
  jurisdiction: "ZZ",
  publisher: "Fixture Publisher",
  publisher_url: "https://example.test/",
  source_system: c.system,
  code_title: c.title,
  parser: { name: c.parser, version: "1" },
  retrieval: {
    methods: ["publisher_page", "proxied_fetch"],
    source_url_patterns: [`^${c.url.replaceAll(".", "\\.")}`],
    terms_gate: false,
    official_source: true,
    rate_limit_ms: 1000,
  },
  structure: { levels: c.levels, unit: "one publisher page" },
  section_id: { scheme: "official_citation_path", regex: c.regex, example: c.example, citation_format: `${c.title} § <path>` },
  currency: { basis: "publisher_statement", location: "page footer" },
  review: { reviewed_by: "contract test", reviewed_at: "2026-10-06" },
});
const currency = () => ({ basis: "publisher_statement", statement: "Current through October 1, 2026", through_date: "2026-10-01", edition: "2026" });
const gates = { jurisdiction: "ZZ", publisher_native_entity: false, public_projection_allowed: false, current_law_verified: false, calculation_activation_allowed: false };

function rows(c, manifestSha) {
  const originalSha = sha(Buffer.from(c.original));
  const unitSha = sha(c.unitText);
  const prov = (data) => ({
    source_url: `${c.url}p1`,
    source_sha256: originalSha,
    retrieved_at: stamp,
    retrieval_method: "publisher_page",
    proxy: null,
    source_as_of: "2026-10-01",
    record_hash_codec: "canonical-integer-jsonb/1",
    record_sha256: sha(canonicalIntegerJson(data)),
    parser: `${c.parser}/1`,
    manifest_sha256: manifestSha,
  });
  const unitData = {
    ...gates,
    identity_kind: "publisher_source_unit",
    unit_key: c.unit,
    unit_kind: "page",
    heading: "Unit",
    original_sha256: originalSha,
    publisher_member: null,
    raw_member_sha256: null,
    text_sha256: unitSha,
    text_code_points: points(c.unitText),
    sections_expected: 1,
    currency: currency(),
  };
  const start = c.unitText.indexOf(c.sectionText);
  const sectionData = {
    ...gates,
    identity_kind: "official_citation_path",
    citation_path: c.path,
    citation: `${c.title} § ${c.path}`,
    heading: c.heading,
    text: c.sectionText,
    text_sha256: sha(c.sectionText),
    text_code_points: points(c.sectionText),
    hierarchy: [
      { level: c.levels[0], number: "1", heading: "Group 1" },
      { level: "section", number: c.path, heading: c.heading },
    ],
    history: null,
    status_note: null,
    unit_id: `ZZ:unit:${c.unit}`,
    unit_text_sha256: unitSha,
    span: { unit: "unicode_code_points", start, end: start + points(c.sectionText) },
    currency: currency(),
  };
  const row = (type, nativeId, data) => ({
    schema_version: "publisher-code-evidence/2",
    source_system: c.system,
    entity_type: type,
    native_id: nativeId,
    data,
    provenance: prov(data),
  });
  return [row("code-source-unit", `ZZ:unit:${c.unit}`, unitData), row("code-section", `ZZ:${c.path}`, sectionData)];
}

async function db(files) {
  const database = new PGlite();
  await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key, public boolean not null);
    create table storage.objects(bucket_id text, name text, metadata jsonb);
    insert into storage.buckets values('corpus-originals', false);`);
  for (const file of files) await database.exec(await fs.readFile(`database/contracts/${file}`, "utf8"));
  return database;
}
const BASE = [
  "corpus-ingest-v1.sql",
  "canonical-integer-jsonb-v1.sql",
  "corpus-publisher-code-intake-v1.sql",
  "corpus-publisher-code-intake-v2.sql",
  "corpus-publisher-code-projection-v2.sql",
];
const V3 = "corpus-publisher-code-multicode-v3.sql";
const call = (database, name, args) => database.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args);
const one = async (database, name, args) => (await call(database, name, args)).rows[0].r;

async function land(database, c, fns) {
  await database.exec("reset role");
  const originalSha = sha(Buffer.from(c.original));
  const unitSha = sha(c.unitText);
  const objs = [
    { sha256: originalSha, bytes: Buffer.byteLength(c.original), kind: "publisher_original" },
    { sha256: unitSha, bytes: Buffer.byteLength(c.unitText), kind: "unit_text_derivative", codePoints: points(c.unitText) },
  ];
  for (const o of objs) {
    await database.query("insert into storage.objects values($1,$2,$3)", [
      "corpus-originals",
      `state-codes/sha256/${o.sha256.slice(0, 2)}/${o.sha256}`,
      { size: String(o.bytes) },
    ]);
  }
  await database.exec("set role service_role");
  const registered = await one(database, fns.register, [manifest(c)]);
  await one(database, fns.open, [c.run, registered.manifest_sha256]);
  const payload = objs.map((o) => ({
    sha256: o.sha256,
    bytes: o.bytes,
    kind: o.kind,
    sources: [{ source_url: `${c.url}p1`, retrieved_at: stamp, http_status: 200, retrieval_method: "publisher_page", proxy: null }],
    readback: {
      bytes: o.bytes,
      bucket: "corpus-originals",
      object_key: `state-codes/sha256/${o.sha256.slice(0, 2)}/${o.sha256}`,
      readback_sha256: o.sha256,
      readback_bytes: o.bytes,
      verification_method: "authenticated-whole-object-get-sha256",
      http_status: 200,
      verified_at: stamp,
      ...(o.codePoints ? { readback_text_encoding: "utf-8", readback_text_code_points: o.codePoints } : {}),
    },
  }));
  await one(database, "corpus_publisher_code_register_objects_v2", [c.run, payload]);
  const batch = rows(c, registered.manifest_sha256);
  await one(database, "corpus_publisher_code_intake_v2", [c.run, batch]);
  assert.equal((await one(database, "corpus_publisher_code_verify_batch_v2", [c.run, batch])).verified, true);
  return { registered, closed: await one(database, fns.finish, [c.run, "completed", { note: "fixture" }]) };
}
const V2 = { register: "corpus_publisher_code_register_manifest_v2", open: "corpus_publisher_code_open_run_v2", finish: "corpus_publisher_code_finish_run_v2" };
const V3FN = { register: "corpus_publisher_code_register_manifest_v3", open: "corpus_publisher_code_open_run_v3", finish: "corpus_publisher_code_finish_run_v3" };

async function primaryReviewedThenV3() {
  const database = await db(BASE);
  await database.exec("set role service_role");
  await land(database, PRIMARY, V2);
  await one(database, "corpus_publisher_code_review_v2", ["ZZ", "reviewed", true, "fixture review"]);
  const before = {
    state: (await database.query("select * from corpus_ingest.publisher_code_states_v2 order by jurisdiction")).rows,
    projected: await one(database, "corpus_publisher_code_projected_states_v2", []),
    outline: await one(database, "corpus_publisher_code_projected_outline_v2", ["ZZ", []]),
    section: await one(database, "corpus_publisher_code_projected_section_v2", ["ZZ", "ZZ:1.01"]),
    search: await one(database, "corpus_publisher_code_projected_search_v2", ["FIXTURE", "ZZ", 30]),
    coverage: (await one(database, "corpus_publisher_code_coverage_v2", [false])).states.find((s) => s.jurisdiction === "ZZ"),
  };
  await database.exec("reset role");
  await database.exec(await fs.readFile(`database/contracts/${V3}`, "utf8"));
  await database.exec("set role service_role");
  return { database, before };
}

test("applying v3 backfills the existing state as its primary code and changes nothing the v2 contract returns", async () => {
  const { database, before } = await primaryReviewedThenV3();
  const codes = (await database.query("select * from corpus_ingest.publisher_code_codes_v3")).rows;
  assert.equal(codes.length, 1);
  assert.equal(codes[0].source_system, "zz-code");
  assert.equal(codes[0].primary_code, true);
  assert.equal(codes[0].review_status, "reviewed");
  assert.equal(codes[0].public_projection_allowed, true);
  assert.equal(Number(codes[0].sections), 1);
  assert.deepEqual((await database.query("select * from corpus_ingest.publisher_code_states_v2 order by jurisdiction")).rows, before.state);
  assert.deepEqual(await one(database, "corpus_publisher_code_projected_states_v2", []), before.projected);
  assert.deepEqual(await one(database, "corpus_publisher_code_projected_outline_v2", ["ZZ", []]), before.outline);
  assert.deepEqual(await one(database, "corpus_publisher_code_projected_section_v2", ["ZZ", "ZZ:1.01"]), before.section);
  assert.deepEqual(await one(database, "corpus_publisher_code_projected_search_v2", ["FIXTURE", "ZZ", 30]), before.search);
  const cov = (await one(database, "corpus_publisher_code_coverage_v2", [false])).states.find((s) => s.jurisdiction === "ZZ");
  assert.deepEqual({ ...cov, updated_at: null }, { ...before.coverage, updated_at: null });
  const v3 = (await one(database, "corpus_publisher_code_coverage_v3", [false])).codes;
  assert.equal(v3.length, 1);
  assert.equal(v3[0].primary_code, true);
  assert.equal(v3[0].sections, 1);
  await database.close();
});

test("a second code lands under the same jurisdiction without touching the primary code's row, review or projection", async () => {
  const { database, before } = await primaryReviewedThenV3();
  await assert.rejects(
    call(database, "corpus_publisher_code_register_manifest_v2", [manifest(SECOND)]),
    /one source system/,
  );
  const second = await land(database, SECOND, V3FN);
  assert.equal(second.registered.primary_code, false);
  assert.equal(second.closed.status, "completed");
  assert.equal(second.closed.source_system, "zz-civil");
  assert.deepEqual((await database.query("select * from corpus_ingest.publisher_code_states_v2 order by jurisdiction")).rows, before.state);
  const codes = (await database.query("select * from corpus_ingest.publisher_code_codes_v3 order by source_system")).rows;
  assert.deepEqual(codes.map((c) => [c.source_system, c.primary_code, c.review_status, c.public_projection_allowed, c.sections, c.units]), [
    ["zz-civil", false, "landed", false, 1, 1],
    ["zz-code", true, "reviewed", true, 1, 1],
  ]);
  assert.deepEqual(await one(database, "corpus_publisher_code_projected_states_v2", []), before.projected);
  assert.deepEqual(await one(database, "corpus_publisher_code_projected_outline_v2", ["ZZ", []]), before.outline);
  assert.equal(await one(database, "corpus_publisher_code_projected_section_v2", ["ZZ", "ZZ:art-1"]), null);
  assert.equal((await one(database, "corpus_publisher_code_projected_search_v2", ["CIVIL", "ZZ", 30])).total, 0);
  const projected = await one(database, "corpus_publisher_code_projected_codes_v3", []);
  assert.deepEqual(projected.map((p) => p.source_system), ["zz-code"]);
  assert.equal((await one(database, "corpus_publisher_code_projected_outline_v3", ["ZZ", "zz-civil", []])).available, false);
  assert.equal(await one(database, "corpus_publisher_code_projected_section_v3", ["ZZ", "zz-civil", "ZZ:art-1"]), null);
  assert.equal((await one(database, "corpus_publisher_code_projected_search_v3", ["CIVIL", null, null, 30])).total, 0);
  const v3 = (await one(database, "corpus_publisher_code_coverage_v3", [false])).codes;
  assert.deepEqual(v3.map((c) => [c.source_system, c.primary_code, c.sections]), [["zz-code", true, 1], ["zz-civil", false, 1]]);
  await database.close();
});

test("review and projection are tracked per code", async () => {
  const { database, before } = await primaryReviewedThenV3();
  await land(database, SECOND, V3FN);
  const reviewed = await one(database, "corpus_publisher_code_review_v3", ["ZZ", "zz-civil", "reviewed", true, "civil review"]);
  assert.equal(reviewed.public_projection_allowed, true);
  assert.equal(reviewed.primary_code, false);
  const projected = await one(database, "corpus_publisher_code_projected_codes_v3", []);
  assert.deepEqual(projected.map((p) => [p.source_system, p.primary_code, p.code_title]), [
    ["zz-code", true, "Fixture Code"],
    ["zz-civil", false, "Fixture Civil Code"],
  ]);
  const groups = await one(database, "corpus_publisher_code_projected_outline_v3", ["ZZ", "zz-civil", []]);
  assert.equal(groups.kind, "groups");
  assert.equal(groups.level, "book");
  const sections = await one(database, "corpus_publisher_code_projected_outline_v3", ["ZZ", "zz-civil", [{ level: "book", number: "1" }]]);
  assert.equal(sections.sections[0].native_id, "ZZ:art-1");
  const published = await one(database, "corpus_publisher_code_projected_section_v3", ["ZZ", "zz-civil", "ZZ:art-1"]);
  assert.equal(published.text, SECOND.sectionText);
  assert.equal(published.source_system, "zz-civil");
  assert.equal(await one(database, "corpus_publisher_code_projected_section_v3", ["ZZ", "zz-code", "ZZ:art-1"]), null);
  const found = await one(database, "corpus_publisher_code_projected_search_v3", ["CIVIL", "ZZ", null, 30]);
  assert.equal(found.total, 1);
  assert.equal(found.hits[0].source_system, "zz-civil");
  assert.equal((await one(database, "corpus_publisher_code_projected_search_v3", ["FIXTURE", "ZZ", null, 30])).total, 2);
  // The v2 projection still shows only the primary code.
  assert.deepEqual(await one(database, "corpus_publisher_code_projected_states_v2", []), before.projected);
  assert.equal(await one(database, "corpus_publisher_code_projected_section_v2", ["ZZ", "ZZ:art-1"]), null);
  // Turning the second code off leaves the primary public; turning the primary off leaves the second public.
  await one(database, "corpus_publisher_code_review_v3", ["ZZ", "zz-civil", "reviewed", false, "flag off"]);
  assert.deepEqual((await one(database, "corpus_publisher_code_projected_codes_v3", [])).map((p) => p.source_system), ["zz-code"]);
  await one(database, "corpus_publisher_code_review_v3", ["ZZ", "zz-civil", "reviewed", true, "flag on"]);
  const primaryOff = await one(database, "corpus_publisher_code_review_v3", ["ZZ", "zz-code", "reviewed", false, "primary off"]);
  assert.equal(primaryOff.primary_code, true);
  assert.equal((await database.query("select public_projection_allowed from corpus_ingest.publisher_code_states_v2")).rows[0].public_projection_allowed, false);
  assert.deepEqual((await one(database, "corpus_publisher_code_projected_codes_v3", [])).map((p) => p.source_system), ["zz-civil"]);
  assert.deepEqual(await one(database, "corpus_publisher_code_projected_states_v2", []), []);
  await assert.rejects(call(database, "corpus_publisher_code_review_v3", ["ZZ", "zz-civil", "landed", true, "bad"]), /reviewed code/);
  await assert.rejects(call(database, "corpus_publisher_code_review_v3", ["ZZ", "zz-nothing", "reviewed", true, "bad"]), /Unknown code/);
  await database.close();
});

test("one open run per jurisdiction still holds across codes, and a held code blocks only its own runs", async () => {
  const { database } = await primaryReviewedThenV3();
  const registered = await one(database, "corpus_publisher_code_register_manifest_v3", [manifest(SECOND)]);
  await one(database, "corpus_publisher_code_open_run_v3", [SECOND.run, registered.manifest_sha256]);
  const primarySha = (await database.query("select current_manifest_sha256 s from corpus_ingest.publisher_code_codes_v3 where source_system = 'zz-code'")).rows[0].s;
  await assert.rejects(
    call(database, "corpus_publisher_code_open_run_v3", ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", primarySha]),
    /Another run is open|open for this jurisdiction/,
  );
  await one(database, "corpus_publisher_code_finish_run_v3", [SECOND.run, "failed", { note: "fixture" }]);
  await one(database, "corpus_publisher_code_review_v3", ["ZZ", "zz-civil", "held", false, "mismatch"]);
  await assert.rejects(
    call(database, "corpus_publisher_code_open_run_v3", ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", registered.manifest_sha256]),
    /held/,
  );
  const reopened = await one(database, "corpus_publisher_code_open_run_v3", ["ffffffff-ffff-4fff-8fff-ffffffffffff", primarySha]);
  assert.equal(reopened.status, "running");
  await database.close();
});

test("anonymous and authenticated roles cannot execute the v3 contract", async () => {
  const { database } = await primaryReviewedThenV3();
  for (const role of ["anon", "authenticated"]) {
    await database.exec(`set role ${role}`);
    await assert.rejects(call(database, "corpus_publisher_code_register_manifest_v3", [manifest(SECOND)]), /permission denied/);
    await assert.rejects(call(database, "corpus_publisher_code_coverage_v3", [false]), /permission denied/);
    await assert.rejects(call(database, "corpus_publisher_code_projected_codes_v3", []), /permission denied/);
    await assert.rejects(database.query("select * from corpus_ingest.publisher_code_codes_v3"), /permission denied/);
  }
  await database.close();
});
