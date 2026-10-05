// LOCAL POSTGRESQL SIMULATION ONLY. Never connects to Supabase, uploads objects,
// or writes production verification receipts. The Storage catalog is a test double.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalIntegerJson, hashBytes } from '../../admin/local-catalog-evidence-contract.mjs';

const [packetArg, outputArg, expectedHash] = process.argv.slice(2);
if (!packetArg || !outputArg || !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) {
  throw new Error('Usage: node simulate-publisher-code-intake.mjs PRIVATE_PACKET NEW_PRIVATE_OUTPUT PINNED_MANIFEST_SHA256');
}
const packet = path.resolve(packetArg), output = path.resolve(outputArg), privateRoot = path.resolve('private');
for (const p of [packet, output]) {
  const rel = path.relative(privateRoot, p);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Both paths must be within private/');
}
await fs.mkdir(output); // Exclusive fresh run; never silently replace an earlier result.
const hash = value => hashBytes(canonicalIntegerJson(value));
const manifestBytes = await fs.readFile(path.join(packet, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(hashBytes(manifestBytes), expectedHash);
assert.equal(hash(manifest), expectedHash);
const assetBytes = await fs.readFile(path.join(packet, 'assets.json'));
assert.equal(hashBytes(assetBytes), manifest.assets.sha256);
const assets = JSON.parse(assetBytes);
assert.equal(hash(assets), manifest.assets.sha256);
const runtime = process.env.PUBLISHER_CODE_PGLITE ?? path.resolve('private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(runtime).href);
const db = new PGlite(path.join(output, 'test-database'));
const run = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const report = { schema_version: 'publisher-code-local-simulation/1', started_at: new Date().toISOString(),
  status: 'running', production: false, cloud_objects_verified: false, database_deployed: false, published: false,
  storage_catalog: 'local test double; no actual authenticated cloud readback', manifest_sha256: expectedHash,
  contract_sha256: hashBytes(await fs.readFile('database/contracts/corpus-publisher-code-intake-v1.sql')),
  asset_files_verified: 0, batches_imported: 0, records_imported: 0 };
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key, public boolean not null);
    create table storage.objects(bucket_id text, name text, metadata jsonb);
    create index on storage.objects(bucket_id,name);
    insert into storage.buckets values('corpus-originals',false);`);
  for (const name of ['corpus-ingest-v1.sql', 'canonical-integer-jsonb-v1.sql', 'corpus-publisher-code-intake-v1.sql']) {
    await db.exec(await fs.readFile(`database/contracts/${name}`, 'utf8'));
  }
  await db.query('insert into corpus_ingest.runs(id,status,scope) values($1,$2,$3)', [run, 'running', {
    source_system: manifest.source_system, contract: 'publisher-code-intake/1', jurisdiction: 'TX', packet_manifest_sha256: expectedHash,
    private_only: true, public_projection_allowed: false, calculation_activation_allowed: false }]);
  // Test-only receipts remain in this isolated DB and memory. They are not saved
  // to an uploader receipt file and cannot prove any real Storage verification.
  const mockReadbacks = [];
  for (const a of assets) {
    const rel = path.relative(privateRoot, path.resolve(a.path));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Asset outside private capture tree');
    const bytes = await fs.readFile(a.path);
    assert.equal(bytes.length, a.bytes); assert.equal(hashBytes(bytes), a.sha256);
    report.asset_files_verified++;
    mockReadbacks.push({ sha256: a.sha256, bytes: a.bytes, bucket: 'corpus-originals',
      object_key: `state-codes/sha256/${a.sha256.slice(0, 2)}/${a.sha256}`, readback_sha256: a.sha256, readback_bytes: a.bytes,
      verification_method: 'authenticated-whole-object-get-sha256', http_status: 200, verified_at: report.started_at,
      test_only: true, actual_cloud_verification: false });
  }
  await db.query(`insert into storage.objects select x->>'bucket',x->>'object_key',jsonb_build_object('size',x->'bytes')
    from jsonb_array_elements($1::jsonb) x`, [mockReadbacks]);
  await db.exec('set role service_role');
  report.registration = (await db.query('select public.corpus_publisher_code_register_v1($1,$2,$3,$4) receipt', [run, manifest, assets, mockReadbacks])).rows[0].receipt;
  for (const [i, b] of manifest.batches.entries()) {
    assert.equal(b.file, `batch-${String(i).padStart(5, '0')}.json`);
    const bytes = await fs.readFile(path.join(packet, b.file));
    assert.equal(bytes.length, b.bytes); assert.equal(hashBytes(bytes), b.sha256);
    const rows = JSON.parse(bytes); assert.equal(rows.length, b.records);
    const receipt = (await db.query('select public.corpus_publisher_code_intake_v1($1,$2,$3) receipt', [run, i, rows])).rows[0].receipt;
    assert.equal(receipt.received, rows.length);
    report.batches_imported++; report.records_imported += receipt.received;
    await fs.appendFile(path.join(output, 'local-batch-results.jsonl'), JSON.stringify({ batch: i, hash: b.sha256, receipt, production: false }) + '\n');
    if (i % 10 === 0) console.log(JSON.stringify({ local_simulation: true, batches: report.batches_imported, records: report.records_imported }));
  }
  await db.exec('reset role');
  report.database_counts = (await db.query(`select entity_type,count(*)::int records from corpus_ingest.entities group by entity_type order by entity_type`)).rows;
  assert.deepEqual(Object.fromEntries(report.database_counts.map(r => [r.entity_type, r.records])), manifest.counts);
  report.versions = (await db.query('select count(*)::int n from corpus_ingest.entity_versions')).rows[0].n;
  report.observations = (await db.query('select count(*)::int n from corpus_ingest.observations')).rows[0].n;
  assert.equal(report.versions, report.records_imported); assert.equal(report.observations, report.records_imported);
  report.public_tables = (await db.query(`select count(*)::int n from information_schema.tables where table_schema='public'`)).rows[0].n;
  assert.equal(report.public_tables, 0);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  await fs.writeFile(path.join(output, 'simulation-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  await db.close();
  console.log(JSON.stringify(report));
}
