// Isolated contract check of an actual private packet. No network or live database.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const packet = process.argv[2];
if (!packet) throw new Error("Usage: node check_packet_sql.mjs <private packet>");
const fixture = JSON.parse(
  await fs.readFile(path.join(packet, "sql-contract-fixtures.json"), "utf8"),
);
const manifest = JSON.parse(await fs.readFile(path.join(packet, "manifest.json"), "utf8"));
const { PGlite } = await import(
  pathToFileURL(
    path.resolve(
      process.env.PUBLISHER_CODE_PGLITE ??
        "private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js",
    ),
  ).href
);
const db = new PGlite();
const call = async (name, args) =>
  (
    await db.query(
      "select public." + name + "(" + args.map((_, i) => "$" + (i + 1)).join(",") + ") as result",
      args,
    )
  ).rows[0].result;
try {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; " +
      "create schema storage; create table storage.buckets(id text primary key, public boolean not null); " +
      "create table storage.objects(bucket_id text, name text, metadata jsonb); " +
      "insert into storage.buckets values('corpus-originals', false);",
  );
  for (const name of [
    "corpus-ingest-v1",
    "canonical-integer-jsonb-v1",
    "corpus-publisher-code-intake-v1",
    "corpus-publisher-code-intake-v2",
    "corpus-publisher-code-projection-v2",
    "corpus-publisher-code-source-occurrence-v1",
    "corpus-third-party-edition-v1",
  ]) {
    await db.exec(await fs.readFile("database/contracts/" + name + ".sql", "utf8"));
  }
  for (const obj of fixture.objects) {
    await db.query("insert into storage.objects values($1,$2,$3)", [
      "corpus-originals",
      obj.readback.object_key,
      { size: String(obj.bytes) },
    ]);
  }
  await db.exec("set role service_role");
  const registered = await call("corpus_publisher_code_register_manifest_v2", [manifest]);
  assert.equal(registered.manifest_sha256, fixture.manifest_sha256);
  await call("corpus_publisher_code_open_run_v2", [fixture.run_id, registered.manifest_sha256]);
  for (let i = 0; i < fixture.objects.length; i += 100)
    await call("corpus_publisher_code_register_objects_v2", [
      fixture.run_id,
      fixture.objects.slice(i, i + 100),
    ]);
  for (const row of [...fixture.units, ...fixture.sections]) {
    await call("corpus_publisher_code_intake_v2", [fixture.run_id, [row]]);
  }
  await db.exec("reset role");
  const actual = (
    await db.query(
      "select count(*)::int total, " +
        "count(*) filter(where corpus_ingest.canonical_integer_jsonb_sha256_v1(data) <> provenance->>'record_sha256')::int hash_errors " +
        "from corpus_ingest.entities",
    )
  ).rows[0];
  assert.equal(actual.total, fixture.units.length + fixture.sections.length);
  assert.equal(actual.hash_errors, 0);
  const readback = (
    await db.query(await fs.readFile(path.join(packet, "cloud-readback.sql"), "utf8"))
  ).rows[0].readback;
  assert.equal(readback.source_records, fixture.sections.length);
  assert.equal(readback.units, fixture.units.length);
  assert.equal(readback.payload_hash_errors, 0);
  assert.equal(readback.text_hash_errors, 0);
  assert.equal(readback.hidden_unresolved_comparisons, 0);
  assert.equal(readback.status_only_binding_errors, 0);
  assert.equal(readback.whole_payload_match, false); // This deliberately loads bounded samples.
  const report = {
    passed: true,
    manifest_sha256: fixture.manifest_sha256,
    units: fixture.units.length,
    sections: fixture.sections.length,
    selection: fixture.selection,
    qualification:
      "Isolated actual-packet contract samples; no storage upload or live database mutation.",
  };
  await fs.writeFile(
    path.join(packet, "sql-contract-verification.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(report));
} finally {
  await db.close();
}
