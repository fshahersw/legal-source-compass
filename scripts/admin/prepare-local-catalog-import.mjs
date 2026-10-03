/** Offline preparation only. No source queries, database writes, credentials or PDF reads. */
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { hashBytes, localOccurrenceKey, validateLocalCatalogRecord, validateLocalCatalogUri } from './local-catalog-evidence-contract.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((s, i, all) => s.startsWith('--') ? [s.slice(2), all[i + 1]] : []).filter(pair => pair.length));
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.run ?? '') || !args.manifest || !args.verification || !args.output) {
  throw new Error('Use --run UUID --manifest candidate-manifest.json --verification independent-verification.json --output private-directory.');
}
const manifestPath = resolve(args.manifest), manifestBytes = await readFile(manifestPath);
const candidate = JSON.parse(manifestBytes), verification = JSON.parse(await readFile(resolve(args.verification), 'utf8'));
const manifestSha256 = hashBytes(manifestBytes);
if (verification.candidate_manifest_sha256 !== manifestSha256 || verification.source_or_payload_mismatches !== 0
  || verification.original_occurrences_verified !== candidate.candidate_observations || verification.unresolved_pointer_edges !== 0) {
  throw new Error('Independent original-source, payload, or pointer verification is absent or stale.');
}
const output = resolve(args.output); await mkdir(output, { recursive: true });
const artifacts = new Map();
for (const [relativePath, artifact] of Object.entries(candidate.source_artifacts)) {
  validateLocalCatalogUri(artifact.source_file_uri);
  artifacts.set(artifact.source_file_uri, { source_system: candidate.source_system, source_file_uri: artifact.source_file_uri,
    source_sha256: artifact.source_sha256, source_bytes: artifact.bytes,
    source_record_count: candidate.original_row_counts[relativePath] ?? 0 });
}
const literal = (value) => {
  const payload = JSON.stringify(value), delim = `$local_${hashBytes(payload).slice(0, 20)}$`;
  if (payload.includes(delim)) throw new Error('SQL delimiter collision.');
  return `${delim}${payload}${delim}::jsonb`;
};
const scope = { source_system: candidate.source_system, contract_version: 'local-catalog-evidence/1',
  candidate_manifest_sha256: manifestSha256, candidate_observations: candidate.candidate_observations,
  distinct_payload_versions: candidate.distinct_payload_versions, distinct_local_entity_ids: candidate.distinct_local_entity_ids,
  held_occurrences: candidate.held_occurrences, local_pointer_edges: candidate.exact_local_pointer_edges,
  metadata_only: true, publisher_native_entity: false, public_projection_allowed: false, pdf_bytes_read: 0 };
const registration = `do $local_registration$ begin
if exists(select 1 from corpus_ingest.runs where id='${args.run}'::uuid and scope is distinct from ${literal(scope)}) then
  raise exception 'Local run is already pinned to a different scope';
end if;
insert into corpus_ingest.runs(id,status,scope) values('${args.run}'::uuid,'running',${literal(scope)}) on conflict do nothing;
if exists(select 1 from jsonb_to_recordset(${literal([...artifacts.values()])}) as x(source_system text,source_file_uri text,source_sha256 text,source_bytes bigint,source_record_count bigint)
  join corpus_ingest.local_source_artifacts a using(source_system,source_file_uri,source_sha256)
  where (a.source_bytes,a.source_record_count) is distinct from (x.source_bytes,x.source_record_count)) then
  raise exception 'Registered local artifact has conflicting bytes or logical row count';
end if;
insert into corpus_ingest.local_source_artifacts(source_system,source_file_uri,source_sha256,source_bytes,source_record_count,registered_by_run)
select source_system,source_file_uri,source_sha256,source_bytes,source_record_count,'${args.run}'::uuid
from jsonb_to_recordset(${literal([...artifacts.values()])}) as x(source_system text,source_file_uri text,source_sha256 text,source_bytes bigint,source_record_count bigint)
on conflict do nothing;
end $local_registration$;
`;
await writeFile(join(output, 'register-local-run-and-artifacts.sql'), registration);
const prepared = { schemaVersion: 'local-catalog-import-batches/1', runId: args.run, candidateManifestSha256: manifestSha256,
  candidateManifest: manifestPath, verification: resolve(args.verification), sourceSystem: candidate.source_system,
  metadataOnly: true, publisherNativeEntitiesWritten: 0, records: 0, batches: [],
  registration: { name: 'register-local-run-and-artifacts.sql', bytes: Buffer.byteLength(registration), sha256: hashBytes(registration) } };
let batch = [], bytes = 2, inputHash = createHash('sha256'); const seen = new Set();
async function flush() {
  if (!batch.length) return;
  const query = `select corpus_ingest.ingest_local_catalog_entities_v1('${args.run}'::uuid,${literal(batch)}) as result;\n`;
  if (Buffer.byteLength(query) > 750000) throw new Error('Prepared local SQL exceeds the management API budget.');
  const name = `batch-${String(prepared.batches.length).padStart(5, '0')}.sql`;
  await writeFile(join(output, name), query);
  prepared.batches.push({ name, records: batch.length, bytes: Buffer.byteLength(query), sha256: hashBytes(query), state: 'prepared' });
  prepared.records += batch.length; batch = []; bytes = 2;
}
const input = resolve(candidate.files['candidate-envelopes.jsonl'].path), stream = createReadStream(input);
stream.on('data', chunk => inputHash.update(chunk));
for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
  if (!line) continue;
  const record = validateLocalCatalogRecord(JSON.parse(line), artifacts), key = localOccurrenceKey(record);
  if (seen.has(key)) throw new Error('Repeated local occurrence identity.');
  seen.add(key);
  const size = Buffer.byteLength(JSON.stringify(record)) + 1;
  if (size > 700000) throw new Error('Oversized local record: preserve original and use a separate importer.');
  if (batch.length && (bytes + size > 700000 || batch.length >= 1000)) await flush();
  batch.push(record); bytes += size;
}
await flush();
prepared.inputSha256 = inputHash.digest('hex');
if (prepared.records !== candidate.candidate_observations || prepared.inputSha256 !== candidate.files['candidate-envelopes.jsonl'].sha256) {
  throw new Error('Pinned local source input or count changed while preparing batches.');
}
await writeFile(join(output, 'manifest.json'), JSON.stringify(prepared, null, 2) + '\n');
console.log(JSON.stringify({ manifest: join(output, 'manifest.json'), records: prepared.records,
  batches: prepared.batches.length, candidateManifestSha256: manifestSha256, inputSha256: prepared.inputSha256 }));
