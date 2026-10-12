// Synthetic isolated PostgreSQL tests. No corpus credentials or live mutations.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalIntegerJson, hashBytes } from "../../admin/local-catalog-evidence-contract.mjs";
const { PGlite } = await import(
  pathToFileURL(
    process.env.PUBLISHER_CODE_PGLITE ??
      path.resolve(
        "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
      ),
  ).href
);
const oldRun = "124b4562-8590-5a0c-9509-96af3d444054";
const newRun = "48f97671-5852-5965-8b45-1adbe689b8ce";
const newManifest = "4dd46270ad4da9362d75ef7f8202eec296e2768a4e794c271c041943b2ea9a03";
const oldManifest = "8c4d8025e4f8a5055a2f420a77bbc22f9b9e376886496d795e8aacbcdba90599";
const archive = "2b443092fc6ad7fbee78d694dd885ec9a44337ebc2b9557980c8846d27978f2c";
const sha = (v) => hashBytes(canonicalIntegerJson(v));
const source = "ca-leginfo-pubinfo";
const url = "https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip";
const oldTime = "2026-10-09T02:19:34Z",
  newTime = "2026-10-05T22:24:52.030Z";
const call = (db, fn, rows) => db.query(`select public.${fn}($1) r`, [rows]);
async function fixture(nativeId = "CA:CIV:1") {
  const db = new PGlite();
  await db.exec("set timezone='UTC'");
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;");
  for (const file of ["corpus-ingest-v1.sql", "canonical-integer-jsonb-v1.sql"])
    await db.exec(await fs.readFile("database/contracts/" + file, "utf8"));
  await db.exec(`create table corpus_ingest.publisher_code_states_v2(jurisdiction text primary key,source_system text,current_manifest_sha256 text,public_projection_allowed boolean);
 create table corpus_ingest.publisher_code_codes_v3(source_system text,public_projection_allowed boolean);`);
  for (const [id, manifest] of [
    [oldRun, oldManifest],
    [newRun, newManifest],
  ])
    await db.query("insert into corpus_ingest.runs(id,status,scope) values($1,$2,$3)", [
      id,
      "completed",
      { source_system: source, manifest_sha256: manifest },
    ]);
  await db.query("insert into corpus_ingest.publisher_code_states_v2 values($1,$2,$3,$4)", [
    "CA",
    source,
    newManifest,
    false,
  ]);
  await db.query("insert into corpus_ingest.publisher_code_codes_v3 values($1,$2)", [
    source,
    false,
  ]);
  const gates = {
    jurisdiction: "CA",
    publisher_native_entity: false,
    public_projection_allowed: false,
    current_law_verified: false,
    calculation_activation_allowed: false,
  };
  const oldData = { ...gates, text: "13 units", hierarchy: [{ level: "section", number: "1" }] };
  const newData = {
    ...gates,
    text: "1/3 units",
    hierarchy: [
      { level: "code", number: "CIV", node_id: "CA:CIV", heading: "Civil Code" },
      { level: "section", number: "1" },
    ],
  };
  const rows = [];
  for (const [run, manifest, time, data, version] of [
    [oldRun, oldManifest, oldTime, oldData, "3"],
    [newRun, newManifest, newTime, newData, "4"],
  ]) {
    const hash = sha(data);
    const provenance = {
      parser: "california-pubinfo-xml/" + version,
      manifest_sha256: manifest,
      source_sha256: archive,
      source_url: url,
      retrieved_at: time,
      source_as_of: null,
      record_hash_codec: "canonical-integer-jsonb/1",
      record_sha256: hash,
    };
    await db.query("insert into corpus_ingest.entity_versions values($1,$2,$3,$4,$5,$6,$7,$8)", [
      source,
      "code-section",
      nativeId,
      hash,
      "publisher-code-evidence/2",
      data,
      "retained-fixture",
      run,
    ]);
    await db.query(
      "insert into corpus_ingest.observations values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [run, source, "code-section", nativeId, hash, url, archive, null, time, provenance],
    );
    if (version === "3")
      await db.query(
        "insert into corpus_ingest.entities(source_system,entity_type,native_id,payload_sha256,schema_version,data,provenance,source_as_of,retrieved_at,last_run) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          source,
          "code-section",
          nativeId,
          hash,
          "publisher-code-evidence/2",
          data,
          provenance,
          null,
          time,
          run,
        ],
      );
    else rows.push({ entity_type: "code-section", native_id: nativeId, payload_sha256: hash });
  }
  await db.exec(await fs.readFile("database/contracts/corpus-ca-parser4-promotion-v1.sql", "utf8"));
  return { db, rows };
}
async function entity(db) {
  return (await db.query("select to_jsonb(e) r from corpus_ingest.entities e")).rows[0].r;
}

test("explicit parser selection preserves real timestamps, versions, full beforeimages, gates and guarded rollback", async () => {
  const { db, rows } = await fixture();
  const before = await entity(db);
  await db.exec("set role service_role");
  assert.equal((await call(db, "corpus_ca_parser4_promote_v1", rows)).rows[0].r.promoted, 1);
  const after = await entity(db);
  assert.equal(after.data.text, "1/3 units");
  assert.equal(Date.parse(after.retrieved_at), Date.parse(newTime));
  assert.equal(after.provenance.retrieved_at, newTime);
  assert.equal(after.data.current_law_verified, false);
  await db.exec("set timezone='America/Chicago'");
  assert.equal(
    (await call(db, "corpus_ca_parser4_promote_v1", rows)).rows[0].r.already_promoted,
    1,
  );
  await db.exec("set timezone='UTC'");
  const ledger = (
    await db.query("select original_record,replacement from corpus_ingest.cleanup_decisions")
  ).rows[0];
  assert.deepEqual(ledger.original_record, before);
  assert.deepEqual(
    ledger.replacement,
    Object.fromEntries(Object.entries(after).filter(([k]) => k !== "data")),
  );
  assert.equal(
    (await db.query("select count(*) n from corpus_ingest.entity_versions")).rows[0].n,
    2,
  );
  assert.equal((await call(db, "corpus_ca_parser4_restore_v1", rows)).rows[0].r.restored, 1);
  assert.deepEqual(await entity(db), before);
  assert.equal(
    (await call(db, "corpus_ca_parser4_restore_v1", rows)).rows[0].r.already_restored,
    1,
  );
  assert.equal((await call(db, "corpus_ca_parser4_promote_v1", rows)).rows[0].r.promoted, 1);
  await db.close();
});

test("promotion rejects an incorrect hash, duplicate identities, unknown target and tampered retained payload", async () => {
  const { db, rows } = await fixture();
  for (const bad of [
    [{ ...rows[0], payload_sha256: "f".repeat(64) }],
    [...rows, ...rows],
    [{ ...rows[0], native_id: "NJ:1" }],
    [],
  ])
    await assert.rejects(call(db, "corpus_ca_parser4_promote_v1", bad));
  await db.query(
    "update corpus_ingest.entity_versions set data=jsonb_set(data,'{text}','\"altered\"') where first_run=$1",
    [newRun],
  );
  await assert.rejects(call(db, "corpus_ca_parser4_promote_v1", rows), /verified retained/);
  assert.equal(
    (await db.query("select count(*) n from corpus_ingest.cleanup_decisions")).rows[0].n,
    0,
  );
  await db.close();
});

test("actual publisher identifiers keep spaces, brackets and fractions without invented normalization", async () => {
  for (const nativeId of ["CA:CONS:SECTION 1.", "CA:CCP:[1084.]", "CA:CONS:SEC. 6½."]) {
    const { db, rows } = await fixture(nativeId);
    assert.equal((await call(db, "corpus_ca_parser4_promote_v1", rows)).rows[0].r.promoted, 1);
    assert.equal((await entity(db)).native_id, nativeId);
    await db.close();
  }
});

test("both publication gates and concurrent runs block promotion", async () => {
  const { db, rows } = await fixture();
  for (const mutation of [
    "update corpus_ingest.publisher_code_states_v2 set public_projection_allowed=true",
    "update corpus_ingest.publisher_code_codes_v3 set public_projection_allowed=true",
    `update corpus_ingest.runs set status='running' where id='${oldRun}'`,
  ]) {
    await db.exec("begin");
    await db.exec(mutation);
    await assert.rejects(
      call(db, "corpus_ca_parser4_promote_v1", rows),
      /closed publication gates/,
    );
    await db.exec("rollback");
  }
  await db.close();
});

test("a changed current row or quarantined source is never overwritten", async () => {
  const { db, rows } = await fixture();
  for (const mutation of [
    "update corpus_ingest.entities set retrieved_at='2026-10-12T00:00:00Z'",
    "update corpus_ingest.entities set review_status='quarantined'",
    "update corpus_ingest.entities set data=jsonb_set(data,'{text}','\"other\"')",
  ]) {
    await db.exec("begin");
    await db.exec(mutation);
    await assert.rejects(call(db, "corpus_ca_parser4_promote_v1", rows), /diagnosed parser-3/);
    await db.exec("rollback");
  }
  await db.close();
});

test("rollback refuses to clobber later changes and unauthorized roles cannot select versions", async () => {
  const { db, rows } = await fixture();
  for (const role of ["anon", "authenticated"]) {
    await db.exec("set role " + role);
    for (const fn of ["corpus_ca_parser4_promote_v1", "corpus_ca_parser4_restore_v1"])
      await assert.rejects(call(db, fn, rows), /permission denied/);
    await db.exec("reset role");
  }
  await call(db, "corpus_ca_parser4_promote_v1", rows);
  await db.exec("update corpus_ingest.entities set review_status='quarantined'");
  await assert.rejects(call(db, "corpus_ca_parser4_restore_v1", rows), /changed after promotion/);
  await db.close();
});
