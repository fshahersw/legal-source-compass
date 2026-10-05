// ISOLATED OFFLINE DATABASE SIMULATION. No real credentials or network. Storage
// rows and in-memory receipts are test doubles and never cloud verification.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { loadPublisherPacket, runPublisherIntake, publisherCredentials } from './run-publisher-code-intake.mjs';
import { hashBytes } from '../../admin/local-catalog-evidence-contract.mjs';

const [packetArg, outputArg, expectedHash] = process.argv.slice(2);
if (!packetArg || !outputArg || !expectedHash) throw Error('Usage: PRIVATE_PACKET NEW_PRIVATE_OUTPUT PINNED_MANIFEST_SHA256');
const privateRoot = await fs.realpath('private'), output = path.resolve(outputArg);
const parent = await fs.realpath(path.dirname(output)), relative = path.relative(privateRoot, parent);
if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('PRIVATE_OUTPUT_REQUIRED');
await fs.mkdir(output); // Never replace prior evidence.
const packet = await loadPublisherPacket(packetArg, expectedHash);
const runtime = process.env.PUBLISHER_CODE_PGLITE ?? path.resolve('private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(runtime).href);
const db = new PGlite(path.join(output, 'test-database'));
const runId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const report = { schema_version: 'publisher-code-runner-local-simulation/1', started_at: new Date().toISOString(), production: false,
  actual_cloud_verification: false, database_deployed: false, storage_catalog: 'local test double only', status: 'running',
  manifest_sha256: expectedHash, local_assets_rehashed: packet.assets.length, expected_records: packet.records,
  runner_sha256: hashBytes(await fs.readFile('scripts/legal/state-codes/run-publisher-code-intake.mjs')),
  progress_contract_sha256: hashBytes(await fs.readFile('database/contracts/corpus-publisher-code-progress-v1.sql')),
  intake_calls: 0, batch_verifications: 0, lost_acknowledgements_injected: 0 };
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key, public boolean not null);
    create table storage.objects(bucket_id text,name text,metadata jsonb); create index on storage.objects(bucket_id,name);
    insert into storage.buckets values('corpus-originals',false);`);
  for (const name of ['corpus-ingest-v1.sql','canonical-integer-jsonb-v1.sql','corpus-publisher-code-intake-v1.sql','corpus-publisher-code-progress-v1.sql']) {
    await db.exec(await fs.readFile(`database/contracts/${name}`, 'utf8'));
  }
  await db.query('insert into corpus_ingest.runs(id,status,scope) values($1,$2,$3)', [runId, 'running', {
    source_system: packet.manifest.source_system, contract: 'publisher-code-intake/1', jurisdiction: 'TX', packet_manifest_sha256: expectedHash,
    private_only: true, public_projection_allowed: false, calculation_activation_allowed: false }]);
  // Synthetic fixtures remain inside the isolated test database / process.
  // They are never written to a resumable uploader journal or production plan.
  const mockReadbacks = packet.assets.map(a => ({ project_id: packet.manifest.project_id, private_only: true, sha256: a.sha256, bytes: a.bytes,
    bucket: 'corpus-originals', object_key: `state-codes/sha256/${a.sha256.slice(0, 2)}/${a.sha256}`,
    readback_sha256: a.sha256, readback_bytes: a.bytes, verification_method: 'authenticated-whole-object-get-sha256', http_status: 200, verified_at: report.started_at }));
  await db.query(`insert into storage.objects select x->>'bucket',x->>'object_key',jsonb_build_object('size',x->'bytes') from jsonb_array_elements($1::jsonb) x`, [mockReadbacks]);
  await db.exec('set role service_role');
  const credentials = publisherCredentials({ EXTERNAL_SUPABASE_URL: `https://${packet.manifest.project_id}.supabase.co`, EXTERNAL_SUPABASE_KEY: 'sb_secret_offline_simulation_not_a_real_key' });
  let injectLostAck = true;
  const callsByBatch = new Map();
  const fetcher = async (url, init) => {
    const name = new URL(url).pathname.split('/').at(-1), b = JSON.parse(init.body);
    const signatures = {
      corpus_publisher_code_status_v1: [b.p_run,b.p_manifest_sha256],
      corpus_publisher_code_register_v1: [b.p_run,b.p_manifest,b.p_assets,b.p_readbacks],
      corpus_publisher_code_verify_batch_v1: [b.p_run,b.p_batch_index,b.p_rows],
      corpus_publisher_code_intake_v1: [b.p_run,b.p_batch_index,b.p_rows],
    };
    const args = signatures[name]; if (!args) throw Error('UNEXPECTED_OFFLINE_RPC');
    const value = (await db.query(`select public.${name}(${args.map((_,i) => '$'+(i+1)).join(',')}) value`, args)).rows[0].value;
    if (name === 'corpus_publisher_code_intake_v1') {
      report.intake_calls++; callsByBatch.set(b.p_batch_index, (callsByBatch.get(b.p_batch_index) ?? 0) + 1);
      if (injectLostAck) { injectLostAck = false; report.lost_acknowledgements_injected++; throw Error('SIMULATED_POST_COMMIT_RESPONSE_LOSS'); }
    }
    if (name === 'corpus_publisher_code_verify_batch_v1') report.batch_verifications++;
    return Response.json(value);
  };
  let announced = -1;
  const record = async event => {
    if (event.rpc === 'corpus_publisher_code_verify_batch_v1' && event.result?.verified === true && event.result.batch_index > announced) {
      announced = event.result.batch_index;
      if (announced % 20 === 0) console.log(JSON.stringify({ local_simulation: true, verified_through_batch: announced, total_batches: packet.manifest.batches.length }));
    }
  };
  const options = { packet, runId, credentials, record, priorReadbacks: mockReadbacks, maxObjects: 1, maxBatches: 10000, fetcher,
    ensureObject: async () => { throw Error('OFFLINE_SIMULATION_MUST_NOT_UPLOAD'); } };
  await assert.rejects(runPublisherIntake(options), /SIMULATED_POST_COMMIT_RESPONSE_LOSS/);
  const result = await runPublisherIntake(options);
  assert.equal(result.complete, true); assert.equal(result.records_verified, packet.records);
  assert.equal(report.intake_calls, packet.manifest.batches.length);
  assert.ok([...callsByBatch.values()].every(n => n === 1));
  assert.equal(result.database_run_completed_by_runner, false); assert.equal(result.final_status.run_status, 'running');
  assert.deepEqual(result.final_status.observation_counts, packet.counts);
  await db.exec('reset role');
  report.database_public_tables = (await db.query("select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n;
  assert.equal(report.database_public_tables, 0);
  report.records_verified = result.records_verified; report.batches_verified = result.batches_verified;
  report.no_batch_mutated_twice = true; report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  await fs.writeFile(path.join(output, 'simulation-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  await db.close(); console.log(JSON.stringify(report));
}
