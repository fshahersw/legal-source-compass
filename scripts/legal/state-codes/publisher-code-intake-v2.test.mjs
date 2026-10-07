// Isolated PostgreSQL tests for publisher-code-intake/2. Fixtures never reach Supabase.
// Runtime: PUBLISHER_CODE_PGLITE or private/tools/.../@electric-sql/pglite (same pin as the v1 tests).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalIntegerJson, hashBytes } from "../../admin/local-catalog-evidence-contract.mjs";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve(
    "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
  );
const { PGlite } = await import(pathToFileURL(runtime).href);
const sha = (value) => hashBytes(value);
const points = (text) => [...text].length;
const run = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const stamp = "2026-10-06T03:40:00Z";

function manifest() {
  return {
    schema_version: "publisher-code-manifest/2",
    jurisdiction: "ZZ",
    publisher: "Fixture Publisher",
    publisher_url: "https://example.test/",
    source_system: "zz-code",
    code_title: "Fixture Code",
    parser: { name: "zz-fixture", version: "1" },
    retrieval: {
      methods: ["publisher_page", "proxied_fetch"],
      source_url_patterns: ["^https://example\\.test/code/"],
      terms_gate: false,
      official_source: true,
      rate_limit_ms: 1000,
    },
    structure: { levels: ["title", "section"], unit: "one publisher page" },
    section_id: {
      scheme: "official_citation_path",
      regex: "^[0-9]+\\.[0-9]+$",
      example: "1.01",
      citation_format: "Fixture Code § <path>",
    },
    currency: { basis: "publisher_statement", location: "page footer" },
    review: { reviewed_by: "contract test", reviewed_at: "2026-10-06" },
  };
}

const original = Buffer.from("synthetic original");
const unitText = "Title 1\nSec. 1.01. FIXTURE TEXT.\n";
const sectionText = "FIXTURE TEXT.\n";
const originalSha = sha(original);
const unitSha = sha(unitText);
const sectionSha = sha(sectionText);

function currency() {
  return {
    basis: "publisher_statement",
    statement: "Current through October 1, 2026",
    through_date: "2026-10-01",
    edition: "2026",
  };
}
function provenance(recordSha, extra = {}) {
  return {
    source_url: "https://example.test/code/t1",
    source_sha256: originalSha,
    retrieved_at: stamp,
    retrieval_method: "publisher_page",
    proxy: null,
    source_as_of: "2026-10-01",
    record_hash_codec: "canonical-integer-jsonb/1",
    record_sha256: recordSha,
    parser: "zz-fixture/1",
    manifest_sha256: null,
    ...extra,
  };
}
const gates = {
  jurisdiction: "ZZ",
  publisher_native_entity: false,
  public_projection_allowed: false,
  current_law_verified: false,
  calculation_activation_allowed: false,
};

function unitRow() {
  const data = {
    ...gates,
    identity_kind: "publisher_source_unit",
    unit_key: "t1",
    unit_kind: "page",
    heading: "Title 1",
    original_sha256: originalSha,
    publisher_member: null,
    raw_member_sha256: null,
    text_sha256: unitSha,
    text_code_points: points(unitText),
    sections_expected: 1,
    currency: currency(),
  };
  return {
    schema_version: "publisher-code-evidence/2",
    source_system: "zz-code",
    entity_type: "code-source-unit",
    native_id: "ZZ:unit:t1",
    data,
    provenance: provenance(sha(canonicalIntegerJson(data))),
  };
}
function sectionRow(text = sectionText, spanEnd) {
  const start = unitText.indexOf(text);
  const data = {
    ...gates,
    identity_kind: "official_citation_path",
    citation_path: "1.01",
    citation: "Fixture Code § 1.01",
    heading: "FIXTURE",
    text,
    text_sha256: sha(text),
    text_code_points: points(text),
    hierarchy: [
      { level: "title", number: "1", heading: "Title 1" },
      { level: "section", number: "1.01", heading: "FIXTURE" },
    ],
    history: null,
    status_note: null,
    unit_id: "ZZ:unit:t1",
    unit_text_sha256: unitSha,
    span: { unit: "unicode_code_points", start, end: spanEnd ?? start + points(text) },
    currency: currency(),
  };
  return {
    schema_version: "publisher-code-evidence/2",
    source_system: "zz-code",
    entity_type: "code-section",
    native_id: "ZZ:1.01",
    data,
    provenance: provenance(sha(canonicalIntegerJson(data))),
  };
}
async function db() {
  const database = new PGlite();
  await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key, public boolean not null);
    create table storage.objects(bucket_id text, name text, metadata jsonb);
    insert into storage.buckets values('corpus-originals', false);`);
  for (const file of [
    "corpus-ingest-v1.sql",
    "canonical-integer-jsonb-v1.sql",
    "corpus-publisher-code-intake-v1.sql",
    "corpus-publisher-code-intake-v2.sql",
    "corpus-publisher-code-projection-v2.sql",
  ]) {
    await database.exec(await fs.readFile(`database/contracts/${file}`, "utf8"));
  }
  return database;
}
const call = (database, name, args) =>
  database.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args);
async function ready(database) {
  await database.exec("reset role");
  const objs = [
    { sha256: originalSha, bytes: original.length, kind: "publisher_original" },
    {
      sha256: unitSha,
      bytes: Buffer.byteLength(unitText),
      kind: "unit_text_derivative",
      codePoints: points(unitText),
    },
  ];
  for (const o of objs) {
    await database.query("insert into storage.objects values($1,$2,$3)", [
      "corpus-originals",
      `state-codes/sha256/${o.sha256.slice(0, 2)}/${o.sha256}`,
      { size: String(o.bytes) },
    ]);
  }
  await database.exec("set role service_role");
  const registered = (
    await call(database, "corpus_publisher_code_register_manifest_v2", [manifest()])
  ).rows[0].r;
  const opened = (
    await call(database, "corpus_publisher_code_open_run_v2", [run, registered.manifest_sha256])
  ).rows[0].r;
  const unit = unitRow();
  const section = sectionRow();
  for (const row of [unit, section]) row.provenance.manifest_sha256 = registered.manifest_sha256;
  for (const row of [unit, section])
    row.provenance.record_sha256 = sha(canonicalIntegerJson(row.data));
  const payload = objs.map((o) => ({
    sha256: o.sha256,
    bytes: o.bytes,
    kind: o.kind,
    sources: [
      {
        source_url: "https://example.test/code/t1",
        retrieved_at: stamp,
        http_status: 200,
        retrieval_method: "publisher_page",
        proxy: null,
      },
    ],
    readback: {
      bytes: o.bytes,
      bucket: "corpus-originals",
      object_key: `state-codes/sha256/${o.sha256.slice(0, 2)}/${o.sha256}`,
      readback_sha256: o.sha256,
      readback_bytes: o.bytes,
      verification_method: "authenticated-whole-object-get-sha256",
      http_status: 200,
      verified_at: stamp,
      ...(o.codePoints
        ? { readback_text_encoding: "utf-8", readback_text_code_points: o.codePoints }
        : {}),
    },
  }));
  await call(database, "corpus_publisher_code_register_objects_v2", [run, payload]);
  return { registered, opened, unit, section };
}

test("a manifest, one run, a unit and a section land and verify, and coverage reports them", async () => {
  const database = await db();
  const { registered, opened, unit, section } = await ready(database);
  assert.equal(registered.registered, true);
  assert.equal(opened.status, "running");
  assert.equal(
    (await call(database, "corpus_publisher_code_register_manifest_v2", [manifest()])).rows[0].r
      .replayed,
    true,
  );
  const landed = (await call(database, "corpus_publisher_code_intake_v2", [run, [unit, section]]))
    .rows[0].r;
  assert.equal(landed.received, 2);
  assert.equal(landed.new_versions, 2);
  assert.equal(landed.replayed, false);
  const proof = (
    await call(database, "corpus_publisher_code_verify_batch_v2", [run, [unit, section]])
  ).rows[0].r;
  assert.equal(proof.verified, true);
  assert.equal(proof.conflicts, 0);
  assert.equal(
    (await call(database, "corpus_publisher_code_intake_v2", [run, [unit, section]])).rows[0].r
      .replayed,
    true,
  );
  const closed = (
    await call(database, "corpus_publisher_code_finish_run_v2", [
      run,
      "completed",
      { note: "fixture" },
    ])
  ).rows[0].r;
  assert.equal(closed.status, "completed");
  assert.equal(closed.observations["code-section"], 1);
  const coverage = (await call(database, "corpus_publisher_code_coverage_v2", [false])).rows[0].r;
  const zz = coverage.states.find((s) => s.jurisdiction === "ZZ");
  assert.equal(zz.sections, 1);
  assert.equal(zz.units, 1);
  assert.equal(zz.review_status, "landed");
  assert.equal(zz.public_projection_allowed, false);
  assert.equal(zz.currency.through_min, "2026-10-01");
  assert.deepEqual(zz.currency.editions, ["2026"]);
  assert.equal(zz.last_run_status, "completed");
  await database.close();
});

test("rejects a terms gate, a bad section id, a foreign host, a section ahead of its unit, projection before review, and a second open run", async () => {
  const database = await db();
  await database.exec("set role service_role");
  const gated = manifest();
  gated.retrieval.terms_gate = true;
  await assert.rejects(
    call(database, "corpus_publisher_code_register_manifest_v2", [gated]),
    /Invalid publisher-code manifest/,
  );
  const registered = (
    await call(database, "corpus_publisher_code_register_manifest_v2", [manifest()])
  ).rows[0].r;
  await call(database, "corpus_publisher_code_open_run_v2", [run, registered.manifest_sha256]);
  await assert.rejects(
    call(database, "corpus_publisher_code_open_run_v2", [
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      registered.manifest_sha256,
    ]),
    /Another run is open/,
  );
  const { unit, section } = await ready(database);
  const mustReject = async (label, promise, re) => {
    try {
      const value = await promise;
      throw new Error(`${label} resolved ${JSON.stringify(value.rows?.[0]?.r).slice(0, 180)}`);
    } catch (error) {
      if (!re.test(String(error.message))) throw new Error(`${label} -> ${error.message}`);
    }
  };
  const ahead = structuredClone(section);
  await mustReject(
    "ahead",
    call(database, "corpus_publisher_code_intake_v2", [run, [ahead]]),
    /Parent source unit not retained/,
  );
  const badId = structuredClone(section);
  badId.data.citation_path = "NOT-A-SECTION";
  badId.native_id = "ZZ:NOT-A-SECTION";
  badId.provenance.record_sha256 = sha(canonicalIntegerJson(badId.data));
  await mustReject(
    "bad-id",
    call(database, "corpus_publisher_code_intake_v2", [run, [unit, badId]]),
    /Section identity/,
  );
  const foreign = structuredClone(unit);
  foreign.provenance.source_url = "https://evil.example/code/t1";
  foreign.provenance.record_sha256 = sha(canonicalIntegerJson(foreign.data));
  await mustReject(
    "foreign",
    call(database, "corpus_publisher_code_intake_v2", [run, [foreign]]),
    /not registered for this run/,
  );
  await assert.rejects(
    call(database, "corpus_publisher_code_review_v2", ["ZZ", "landed", true, "too early"]),
    /reviewed state/,
  );
  const reviewed = (
    await call(database, "corpus_publisher_code_review_v2", [
      "ZZ",
      "reviewed",
      true,
      "fixture review",
    ])
  ).rows[0].r;
  assert.equal(reviewed.public_projection_allowed, true);
  await database.close();
});

test("a private state stays hidden until its review flag allows projection", async () => {
  const database = await db();
  const { unit, section } = await ready(database);
  await call(database, "corpus_publisher_code_intake_v2", [run, [unit, section]]);
  await call(database, "corpus_publisher_code_finish_run_v2", [
    run,
    "completed",
    { note: "fixture" },
  ]);
  assert.deepEqual(
    (await call(database, "corpus_publisher_code_projected_states_v2", [])).rows[0].r,
    [],
  );
  assert.equal(
    (await call(database, "corpus_publisher_code_projected_section_v2", ["ZZ", "ZZ:1.01"])).rows[0]
      .r,
    null,
  );
  assert.equal(
    (await call(database, "corpus_publisher_code_projected_outline_v2", ["ZZ", []])).rows[0].r
      .available,
    false,
  );
  await call(database, "corpus_publisher_code_review_v2", [
    "ZZ",
    "reviewed",
    true,
    "fixture review",
  ]);
  const states = (await call(database, "corpus_publisher_code_projected_states_v2", [])).rows[0].r;
  assert.equal(states.length, 1);
  assert.equal(states[0].jurisdiction, "ZZ");
  assert.equal(states[0].code_title, "Fixture Code");
  assert.deepEqual(states[0].currency.editions, ["2026"]);
  assert.equal(states[0].currency.through_max, "2026-10-01");
  assert.equal(states[0].sections, 1);
  const outline = (await call(database, "corpus_publisher_code_projected_outline_v2", ["ZZ", []]))
    .rows[0].r;
  assert.equal(outline.kind, "groups");
  assert.equal(outline.level, "title");
  assert.equal(outline.groups[0].number, "1");
  assert.equal(outline.groups[0].count, 1);
  const sections = (
    await call(database, "corpus_publisher_code_projected_outline_v2", [
      "ZZ",
      [{ level: "title", number: "1" }],
    ])
  ).rows[0].r;
  assert.equal(sections.kind, "sections");
  assert.equal(sections.sections[0].native_id, "ZZ:1.01");
  assert.equal(sections.sections[0].citation, "Fixture Code § 1.01");
  const published = (
    await call(database, "corpus_publisher_code_projected_section_v2", ["ZZ", "ZZ:1.01"])
  ).rows[0].r;
  assert.equal(published.text, sectionText);
  assert.equal(published.heading, "FIXTURE");
  assert.equal(published.currency.edition, "2026");
  assert.equal(published.currency.through_date, "2026-10-01");
  assert.equal(published.source_url, "https://example.test/code/t1");
  assert.equal(published.history, null);
  const found = (
    await call(database, "corpus_publisher_code_projected_search_v2", ["FIXTURE", "ZZ", 30])
  ).rows[0].r;
  assert.equal(found.total, 1);
  assert.equal(found.hits[0].native_id, "ZZ:1.01");
  await call(database, "corpus_publisher_code_review_v2", ["ZZ", "reviewed", false, "flag off"]);
  assert.equal(
    (await call(database, "corpus_publisher_code_projected_section_v2", ["ZZ", "ZZ:1.01"])).rows[0]
      .r,
    null,
  );
  await database.close();
});

test("anonymous and authenticated roles cannot execute the contract", async () => {
  const database = await db();
  for (const role of ["anon", "authenticated"]) {
    await database.exec(`set role ${role}`);
    await assert.rejects(
      call(database, "corpus_publisher_code_register_manifest_v2", [manifest()]),
      /permission denied/,
    );
    await assert.rejects(
      call(database, "corpus_publisher_code_coverage_v2", [false]),
      /permission denied/,
    );
    await assert.rejects(
      call(database, "corpus_publisher_code_projected_states_v2", []),
      /permission denied/,
    );
    await assert.rejects(
      call(database, "corpus_publisher_code_projected_section_v2", ["ZZ", "ZZ:1.01"]),
      /permission denied/,
    );
    await database.exec("reset role");
  }
  await database.close();
});

test("a later run cannot reuse a payload hash for different content", async () => {
  const database = await db();
  const { registered, unit, section } = await ready(database);
  await call(database, "corpus_publisher_code_intake_v2", [run, [unit, section]]);
  await call(database, "corpus_publisher_code_finish_run_v2", [
    run,
    "completed",
    { note: "fixture" },
  ]);
  const second = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await call(database, "corpus_publisher_code_open_run_v2", [second, registered.manifest_sha256]);
  const changed = JSON.parse(JSON.stringify(section));
  changed.data.heading = "REWRITTEN";
  await assert.rejects(
    call(database, "corpus_publisher_code_intake_v2", [second, [changed]]),
    /Canonical payload hash mismatch/,
  );
  await database.close();
});
