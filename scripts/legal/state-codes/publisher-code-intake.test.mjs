// Isolated PostgreSQL tests. Fixtures never reach Supabase or app bundles.
// Install the pinned test runtime separately, leaving application dependencies alone:
// npm install --prefix private/tools/publisher-code-contract-tests --save-exact --ignore-scripts @electric-sql/pglite@0.5.8
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { canonicalIntegerJson, hashBytes } from "../../admin/local-catalog-evidence-contract.mjs";

const runtime =
  process.env.PUBLISHER_CODE_PGLITE ??
  path.resolve(
    "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
  );
const { PGlite } = await import(pathToFileURL(runtime).href);
const hash = (value) => hashBytes(canonicalIntegerJson(value));
const run = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const archiveHash = hashBytes("synthetic archive fixture"),
  text = "Sec. 16.003. TWO YEARS. Fixture statute text 🏛.";
const textHash = hashBytes(text),
  rawHash = hashBytes("synthetic chapter fixture");
const stamp = "2026-10-05T16:00:00Z";
const gates = {
  jurisdiction: "TX",
  publisher_native_entity: false,
  public_projection_allowed: false,
  current_law_verified: false,
  calculation_activation_allowed: false,
};

function envelope(type, id, data) {
  return {
    schema_version: "publisher-code-evidence/1",
    source_system: "texas-legislature-code",
    entity_type: type,
    native_id: id,
    data,
    provenance: {
      source_url: "https://tcss.legis.texas.gov/resources/Zips/CP.htm.zip",
      source_sha256: archiveHash,
      publisher_member: "cp.16.htm",
      raw_member_sha256: rawHash,
      retrieved_at: stamp,
      source_as_of: null,
      retrieval_method: "publisher_zip_member",
      record_hash_codec: "canonical-integer-jsonb/1",
      record_sha256: hash(data),
      parser: "texas-publisher-html/5",
    },
  };
}

function fixture() {
  const chapter = envelope("code-chapter-document", "CP:cp.16.htm", {
    ...gates,
    code: "CP",
    code_name: "Fixture Code",
    publisher_member: "cp.16.htm",
    raw_member_sha256: rawHash,
    raw_member_bytes: 25,
    archive_sha256: archiveHash,
    text_sha256: textHash,
    text_bytes: Buffer.byteLength(text),
    section_occurrences: 1,
    publisher_filename_legacy_hint: false,
    identity_kind: "publisher_code_and_member_filename",
  });
  const section = envelope("code-section-occurrence", "CP:cp.16.htm:16.003:1", {
    ...gates,
    code: "CP",
    chapter_identity: chapter.native_id,
    native_citation_key: "CP:16.003",
    native_section_anchor: "16.003",
    occurrence: 1,
    citation_heading: "Sec. 16.003. TWO YEARS.",
    publisher_section_url: null,
    identity_evidence: "preceding_named_anchor",
    anchor_whitespace_anomaly: false,
    publisher_filename_legacy_hint: false,
    hierarchy: {},
    text_sha256: textHash,
    text_derivative_sha256: textHash,
    text_span: { unit: "unicode_code_points", start: 0, end: [...text].length },
    following_context_start: null,
    identity_kind: "publisher_member_anchor_occurrence",
  });
  const batches = [[chapter], [section]];
  const assets = [
    {
      path: "private/test/archive.zip",
      sha256: archiveHash,
      bytes: 25,
      kind: "publisher_archive",
      source_references: [
        {
          code: "CP",
          source_url: chapter.provenance.source_url,
          sha256: archiveHash,
          bytes: 25,
          retrieved_at: stamp,
          http_status: 200,
        },
      ],
    },
    {
      path: "private/test/chapter.txt",
      sha256: textHash,
      bytes: Buffer.byteLength(text),
      kind: "chapter_text_derivative",
      source_references: [
        {
          chapter_identity: chapter.native_id,
          archive_sha256: archiveHash,
          raw_member_sha256: rawHash,
          parser: chapter.provenance.parser,
        },
      ],
    },
  ];
  const readbacks = assets.map((a) => ({
    sha256: a.sha256,
    bytes: a.bytes,
    bucket: "corpus-originals",
    object_key: `state-codes/sha256/${a.sha256.slice(0, 2)}/${a.sha256}`,
    readback_sha256: a.sha256,
    readback_bytes: a.bytes,
    verification_method: "authenticated-whole-object-get-sha256",
    http_status: 200,
    verified_at: stamp,
    ...(a.kind === "chapter_text_derivative"
      ? { readback_text_encoding: "utf-8", readback_text_code_points: [...text].length }
      : {}),
  }));
  const manifest = {
    schema_version: "publisher-code-private-packet/1",
    project_id: "xosqzzsnhxcyehcnirpa",
    source_system: "texas-legislature-code",
    parser: "texas-publisher-html/5",
    counts: { "code-chapter-document": 1, "code-section-occurrence": 1 },
    assets: {
      file: "assets.json",
      sha256: hash(assets),
      unique_objects: 2,
      unique_bytes: assets.reduce((n, a) => n + a.bytes, 0),
    },
    batches: batches.map((b, i) => ({
      file: `batch-${String(i).padStart(5, "0")}.json`,
      records: b.length,
      bytes: Buffer.byteLength(canonicalIntegerJson(b)),
      sha256: hash(b),
    })),
    registered: false,
    published: false,
    cloud_verified: false,
  };
  return { batches, assets, readbacks, manifest };
}

async function dbFor(f = fixture()) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key, public boolean not null);
    create table storage.objects(bucket_id text, name text, metadata jsonb);
    insert into storage.buckets values('corpus-originals',false);`);
  for (const file of [
    "corpus-ingest-v1.sql",
    "canonical-integer-jsonb-v1.sql",
    "corpus-publisher-code-intake-v1.sql",
    "corpus-publisher-code-progress-v1.sql",
  ]) {
    await db.exec(await fs.readFile(`database/contracts/${file}`, "utf8"));
  }
  await db.query("insert into corpus_ingest.runs(id,status,scope) values($1,$2,$3)", [
    run,
    "running",
    {
      source_system: "texas-legislature-code",
      contract: "publisher-code-intake/1",
      jurisdiction: "TX",
      packet_manifest_sha256: hash(f.manifest),
      private_only: true,
      public_projection_allowed: false,
      calculation_activation_allowed: false,
    },
  ]);
  for (const r of f.readbacks)
    await db.query("insert into storage.objects values($1,$2,$3)", [
      r.bucket,
      r.object_key,
      { size: r.bytes },
    ]);
  return db;
}
const register = (db, f, id = run) =>
  db.query("select public.corpus_publisher_code_register_v1($1,$2,$3,$4) as receipt", [
    id,
    f.manifest,
    f.assets,
    f.readbacks,
  ]);
const ingest = (db, f, i, id = run) =>
  db.query("select public.corpus_publisher_code_intake_v1($1,$2,$3) as receipt", [
    id,
    i,
    f.batches[i],
  ]);
const progress = async (db, f) =>
  (
    await db.query("select public.corpus_publisher_code_status_v1($1,$2) value", [
      run,
      hash(f.manifest),
    ])
  ).rows[0].value;
const proof = async (db, f, i) =>
  (
    await db.query("select public.corpus_publisher_code_verify_batch_v1($1,$2,$3) value", [
      run,
      i,
      f.batches[i],
    ])
  ).rows[0].value;
function repin(f) {
  f.manifest.assets.sha256 = hash(f.assets);
  f.manifest.batches = f.batches.map((b, i) => {
    for (const row of b) row.provenance.record_sha256 = hash(row.data);
    return {
      file: `batch-${String(i).padStart(5, "0")}.json`,
      records: b.length,
      bytes: Buffer.byteLength(canonicalIntegerJson(b)),
      sha256: hash(b),
    };
  });
}
async function withDb(fn, f = fixture()) {
  const db = await dbFor(f);
  try {
    await fn(db, f);
  } finally {
    await db.close();
  }
}

test("read-only progress resolves registration, exact version proof and completed runs", async () =>
  withDb(async (db, f) => {
    await db.exec("set role service_role");
    assert.equal((await progress(db, f)).registered, false);
    const absent = (
      await db.query("select public.corpus_publisher_code_status_v1($1,$2) value", [
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        hash(f.manifest),
      ])
    ).rows[0].value;
    assert.equal(absent.run_exists, false);
    await assert.rejects(
      db.query("select public.corpus_publisher_code_status_v1($1,$2)", [run, "0".repeat(64)]),
      /Run scope differs/,
    );
    await register(db, f);
    assert.equal((await progress(db, f)).objects, 2);
    assert.equal((await proof(db, f, 0)).verified, false);
    await ingest(db, f, 0);
    await ingest(db, f, 1);
    assert.equal((await proof(db, f, 0)).verified, true);
    assert.equal((await proof(db, f, 1)).verified, true);
    assert.deepEqual((await progress(db, f)).observation_counts, f.manifest.counts);
    await db.exec("reset role");
    await db.exec("update corpus_ingest.runs set status='completed'");
    await db.exec("set role service_role");
    assert.equal((await progress(db, f)).run_status, "completed");
    assert.equal((await proof(db, f, 1)).verified, true);
  }));
test("Unicode span is bounded by verified code points rather than larger UTF8 byte count", async () => {
  const f = fixture();
  f.batches[1][0].data.text_span.end = [...text].length + 1;
  repin(f);
  assert.ok(f.batches[1][0].data.text_span.end < Buffer.byteLength(text));
  await withDb(async (db) => {
    await register(db, f);
    await ingest(db, f, 0);
    await assert.rejects(ingest(db, f, 1), /parent span mismatch/);
  }, f);
  await withDb(async (db, good) => {
    delete good.readbacks[1].readback_text_code_points;
    await assert.rejects(register(db, good), /whole-body receipt/);
  });
});

test("a batch receipt cannot conceal missing observations, changed payload or absent private objects", async () =>
  withDb(async (db, f) => {
    await register(db, f);
    await ingest(db, f, 0);
    await ingest(db, f, 1);
    const changed = structuredClone(f);
    changed.batches[1][0].data.citation_heading = "Wrong text";
    await assert.rejects(proof(db, changed, 1), /immutable batch/);
    await db.query(
      "delete from corpus_ingest.observations where entity_type='code-section-occurrence'",
    );
    const missing = await proof(db, f, 1);
    assert.equal(missing.receipt_present, true);
    assert.equal(missing.matched, 0);
    assert.equal(missing.verified, false);
    await db.exec(
      "update corpus_ingest.entity_versions set data=data||'{\"code_name\":\"Corrupted\"}'::jsonb where entity_type='code-chapter-document'",
    );
    assert.equal((await proof(db, f, 0)).verified, false);
    await db.exec("delete from storage.objects");
    assert.equal((await progress(db, f)).objects_missing_from_private_catalog, 2);
  }));

test("imports ordered reviewed batches, preserves exact payloads, and replays without duplicate observations", async () =>
  withDb(async (db, f) => {
    await db.exec("set role service_role");
    await register(db, f);
    await ingest(db, f, 0);
    await ingest(db, f, 1);
    assert.equal((await ingest(db, f, 1)).rows[0].receipt.replayed, true);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*)::int n from corpus_ingest.entity_versions")).rows[0].n,
      2,
    );
    assert.equal(
      (await db.query("select count(*)::int n from corpus_ingest.observations")).rows[0].n,
      2,
    );
    const rows = (await db.query("select data from corpus_ingest.entities order by entity_type"))
      .rows;
    assert.deepEqual(
      rows.map((r) => r.data),
      f.batches.map((b) => b[0].data),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from information_schema.tables where table_schema=$1",
          ["public"],
        )
      ).rows[0].n,
      0,
    );
  }));

test("anon and authenticated cannot register, ingest or read private packet tables", async () =>
  withDb(async (db) => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(register(db, fixture()), /permission denied/);
      await assert.rejects(ingest(db, fixture(), 0), /permission denied/);
      await assert.rejects(
        db.query("select public.corpus_publisher_code_status_v1($1,$2)", [
          run,
          hash(fixture().manifest),
        ]),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select public.corpus_publisher_code_verify_batch_v1($1,0,$2)", [
          run,
          fixture().batches[0],
        ]),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select * from corpus_ingest.publisher_code_packets_v1"),
        /permission denied/,
      );
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    await assert.rejects(
      db.exec("delete from corpus_ingest.publisher_code_packets_v1"),
      /permission denied/,
    );
  }));

test("unverified object, public bucket, and changed asset plan are rejected atomically", async () =>
  withDb(async (db, f) => {
    f.readbacks[0].readback_sha256 = "0".repeat(64);
    await assert.rejects(register(db, f), /whole-body receipt/);
    f.readbacks[0].readback_sha256 = f.assets[0].sha256;
    await db.exec("update storage.buckets set public=true");
    await assert.rejects(register(db, f), /whole-body receipt/);
    await db.exec("update storage.buckets set public=false");
    f.assets[0].bytes++;
    await assert.rejects(register(db, f), /asset plan mismatch/);
    assert.equal(
      (await db.query("select count(*)::int n from corpus_ingest.publisher_code_objects_v1"))
        .rows[0].n,
      0,
    );
  }));

test("changed batch bytes, out-of-order intake and closed runs cannot be imported", async () =>
  withDb(async (db, f) => {
    await register(db, f);
    await assert.rejects(ingest(db, f, 1), /recorded order/);
    f.batches[0][0].data.code_name = "Changed after review";
    await assert.rejects(ingest(db, f, 0), /immutable batch/);
    await db.exec(`update corpus_ingest.runs set status='completed'`);
    await assert.rejects(register(db, f), /open private publisher-code run/);
    await assert.rejects(ingest(db, f, 0), /open private publisher-code run/);
  }));

test("even a newly pinned packet cannot activate rules or replace source identity", async () => {
  for (const mutate of [
    (r) => {
      r.data.public_projection_allowed = true;
    },
    (r) => {
      r.provenance.source_url = "https://example.com/unrelated";
    },
  ]) {
    const f = fixture();
    mutate(f.batches[0][0]);
    f.batches[0][0].provenance.record_sha256 = hash(f.batches[0][0].data);
    f.manifest.batches[0].sha256 = hash(f.batches[0]);
    f.manifest.batches[0].bytes = Buffer.byteLength(canonicalIntegerJson(f.batches[0]));
    await withDb(async (db) => {
      await register(db, f);
      await assert.rejects(ingest(db, f, 0), /private gate/);
    }, f);
  }
});

test("source versions and quarantine survive a subsequent observation", async () =>
  withDb(async (db, f) => {
    await register(db, f);
    await ingest(db, f, 0);
    await db.exec(`update corpus_ingest.entities set review_status='quarantined'`);
    await ingest(db, f, 1);
    const next = fixture(),
      nextRun = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    next.batches[0][0].data.code_name = "Corrected fixture label";
    for (const b of next.batches)
      for (const row of b) row.provenance.retrieved_at = "2026-10-05T17:00:00Z";
    next.assets[0].source_references[0].retrieved_at = "2026-10-05T17:00:00Z";
    repin(next);
    await db.query(
      `insert into corpus_ingest.runs(id,status,scope)
    select $1,status,scope || jsonb_build_object('packet_manifest_sha256',$2::text) from corpus_ingest.runs where id=$3`,
      [nextRun, hash(next.manifest), run],
    );
    await register(db, next, nextRun);
    await ingest(db, next, 0, nextRun);
    await ingest(db, next, 1, nextRun);
    assert.equal(
      (
        await db.query(
          `select review_status from corpus_ingest.entities where entity_type='code-chapter-document'`,
        )
      ).rows[0].review_status,
      "quarantined",
    );
    assert.equal(
      (
        await db.query(
          `select data->>'code_name' label from corpus_ingest.entities where entity_type='code-chapter-document'`,
        )
      ).rows[0].label,
      "Corrected fixture label",
    );
    assert.equal(
      (await db.query("select count(*)::int n from corpus_ingest.entity_versions")).rows[0].n,
      3,
    );
    assert.equal(
      (await db.query("select count(*)::int n from corpus_ingest.observations")).rows[0].n,
      4,
    );
    assert.deepEqual(
      (
        await db.query(`select data from corpus_ingest.entity_versions where payload_sha256=$1`, [
          f.batches[0][0].provenance.record_sha256,
        ])
      ).rows[0].data,
      f.batches[0][0].data,
    );
  }));

test("reviewed packet still rejects cross-code archives and cross-member derivatives", async () => {
  for (const [asset, key, value, reason] of [
    [0, "code", "CN", /private gate/],
    [1, "chapter_identity", "CP:cp.17.htm", /derivative\/source binding/],
  ]) {
    const f = fixture();
    f.assets[asset].source_references[0][key] = value;
    repin(f);
    await withDb(async (db) => {
      await register(db, f);
      await assert.rejects(ingest(db, f, 0), reason);
    }, f);
  }
});

test("section occurrence must bind an existing exact chapter version and valid span", async () => {
  for (const mutate of [
    (r) => {
      r.data.text_derivative_sha256 = "0".repeat(64);
    },
    (r) => {
      r.data.chapter_identity = "CP:cp.17.htm";
    },
    (r) => {
      r.data.text_span.end = 99999;
    },
  ]) {
    const f = fixture();
    mutate(f.batches[1][0]);
    repin(f);
    await withDb(async (db) => {
      await register(db, f);
      await ingest(db, f, 0);
      await assert.rejects(ingest(db, f, 1), /parent span mismatch/);
      assert.equal(
        (await db.query("select count(*)::int n from corpus_ingest.entities")).rows[0].n,
        1,
      );
    }, f);
  }
});
