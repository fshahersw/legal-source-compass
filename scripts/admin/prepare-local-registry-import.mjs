/** Offline ordinary-only registry intake. Held source originals remain outside this import. */
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes, localOccurrenceKey } from './local-catalog-evidence-contract.mjs';
import { validateLocalRegistryRecord, LOCAL_REGISTRY_ARTIFACT_URIS } from './local-registry-evidence-contract.mjs';
import { selectLocalEvidenceWinner } from './local-evidence-winner.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((s, i, all) => s.startsWith('--') ? [s.slice(2), all[i + 1]] : []).filter(p => p.length));
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.run ?? '') || !args.manifest || !args.verification || !args.output) {
  throw new Error('Use --run UUID --manifest candidate-manifest-v3.json --verification independent-verification-v3.json --output private-directory.');
}
const manifestPath = resolve(args.manifest), candidateBytes = await readFile(manifestPath), candidate = JSON.parse(candidateBytes);
const verificationPath = resolve(args.verification), verificationBytes = await readFile(verificationPath), verification = JSON.parse(verificationBytes);
if (candidate.schema_version !== 'local-source-registry-candidates/3' || candidate.envelope_schema !== 'local-source-registry-evidence/2'
  || candidate.normalizer_version !== 'local-source-registry-reviewed/3' || candidate.source_system !== 'local-source-registry'
  || candidate.original_occurrences !== 33930 || candidate.ordinary_safe_records !== 33927
  || candidate.ordinary_safe_distinct_entities !== 33297 || candidate.ordinary_safe_distinct_versions !== 33448
  || candidate.held_occurrences !== 3 || candidate.held_credential_occurrences !== 1 || candidate.held_oversized_occurrences !== 2) {
  throw new Error('Registry intake requires the reviewed v3 schema, namespace and complete occurrence accounting.');
}
if (verification.status !== 'independent-v3-original-source-and-intentional-redaction-verification-passed'
  || verification.normalizer_version !== candidate.normalizer_version || verification.envelope_schema !== candidate.envelope_schema
  || verification.original_source_occurrences_verified !== 33930 || verification.ordinary_source_records_verified_unchanged !== 33927
  || verification.credential_source_occurrences_intentionally_redacted !== 1 || verification.held_occurrences !== 3
  || verification.held_credential_occurrences !== 1 || verification.held_oversized_occurrences !== 2
  || verification.node_records_verified !== 33930 || verification.node_ordinary_records_verified !== 33927 || verification.node_held_records_verified !== 3
  || verification.node_canonical_integer_codec_check !== 'passed' || verification.node_recursive_credential_parameter_url_scan !== 'passed-zero-remaining'
  || verification.original_v2_retained_unmodified !== true
  || ['credential_parameter_url_occurrences_after_redaction', 'original_source_hash_mismatches', 'source_record_mismatches',
    'original_payload_hash_mismatches', 'derived_payload_hash_mismatches', 'pdf_bodies_read', 'http_api_calls'].some(k => verification[k] !== 0)) {
  throw new Error('The original-occurrence and intentional-redaction verification receipt did not pass.');
}
const sourceDir = dirname(manifestPath), output = resolve(args.output); await mkdir(output, { recursive: true });
const artifacts = new Map(candidate.source_artifacts.map(a => [a.source_file_uri, a]));
if (artifacts.size !== 15 || [...artifacts.keys()].some(uri => !LOCAL_REGISTRY_ARTIFACT_URIS.has(uri))) throw new Error('Registry artifact set differs from the approved originals.');
if (verification.source_artifacts_verified.length !== 15 || [...artifacts.values()].reduce((n,a) => n + a.source_record_count,0) !== 33930
  || verification.source_artifacts_verified.some(a => {
    const original = artifacts.get(a.source_file_uri);
    return !original || a.verified_sha256 !== original.source_sha256 || a.verified_bytes !== original.source_bytes || a.verified_records !== original.source_record_count;
  })) throw new Error('Verified original artifact identities or occurrence counts differ.');
for (const a of artifacts.values()) {
  const original = await readFile(fileURLToPath(a.source_file_uri));
  if (original.length !== a.source_bytes || hashBytes(original) !== a.source_sha256) throw new Error('Original registry artifact changed after verification.');
  const retained = join(output, 'originals', a.source_sha256); await mkdir(retained, { recursive: true });
  await copyFile(fileURLToPath(a.source_file_uri), join(retained, fileURLToPath(a.source_file_uri).split(/[\\/]/).at(-1)));
}
const scope = { source_system: 'local-source-registry', schema_version: 'local-source-registry-evidence/2',
  normalizer_version: 'local-source-registry-reviewed/3', candidate_manifest_sha256: hashBytes(candidateBytes),
  raw_source_occurrences_independently_verified: true, raw_source_verification_sha256: hashBytes(verificationBytes),
  public_projection_allowed: false, calculation_activation_allowed: false, publisher_native_entity: false,
  metadata_only: true, original_source_occurrences: 33930, held_source_occurrences: 3, ordinary_selected_occurrences: 33927, pdf_bytes_read: 0 };
const literal = value => { const payload = JSON.stringify(value), tag = `$registry_${hashBytes(payload).slice(0, 20)}$`; if (payload.includes(tag)) throw new Error('SQL delimiter collision.'); return `${tag}${payload}${tag}::jsonb`; };
const registration = `do $registry_registration$ begin
if exists(select 1 from corpus_ingest.runs where id='${args.run}'::uuid and scope is distinct from ${literal(scope)})then raise exception 'Registry run scope is pinned to another packet';end if;
insert into corpus_ingest.runs(id,status,scope)values('${args.run}'::uuid,'running',${literal(scope)})on conflict do nothing;
if exists(select 1 from jsonb_to_recordset(${literal([...artifacts.values()])})as x(source_system text,source_file_uri text,source_sha256 text,source_bytes bigint,source_record_count bigint)
join corpus_ingest.local_source_artifacts a using(source_system,source_file_uri,source_sha256)where(a.source_bytes,a.source_record_count)is distinct from(x.source_bytes,x.source_record_count))then raise exception 'Original registry artifact bytes or rowcount mismatch';end if;
insert into corpus_ingest.local_source_artifacts(source_system,source_file_uri,source_sha256,source_bytes,source_record_count,registered_by_run)
select source_system,source_file_uri,source_sha256,source_bytes,source_record_count,'${args.run}'::uuid
from jsonb_to_recordset(${literal([...artifacts.values()])})as x(source_system text,source_file_uri text,source_sha256 text,source_bytes bigint,source_record_count bigint)on conflict do nothing;
end $registry_registration$;
`;
await writeFile(join(output, 'register-local-registry-run-and-artifacts.sql'), registration);
const prepared = { schemaVersion: 'local-registry-ordinary-import/1', runId: args.run, scope,
  candidateManifest: manifestPath, candidateManifestSha256: hashBytes(candidateBytes), rawVerification: verificationPath,
  rawVerificationSha256: hashBytes(verificationBytes), records: 0, batches: [], heldOriginalOccurrences: 3,
  registration: { name: 'register-local-registry-run-and-artifacts.sql', bytes: Buffer.byteLength(registration), sha256: hashBytes(registration) } };
let batch = [], bytes = 2, inputBytes = 0, inputHash = createHash('sha256'); const seen = new Set(), versions = new Set(), winners = new Map();
async function flush() {
  if (!batch.length) return;
  const query = `select corpus_ingest.ingest_local_registry_entities_v1('${args.run}'::uuid,${literal(batch)}) as result;\n`;
  if (Buffer.byteLength(query) > 750000) throw new Error('Registry SQL exceeds the approved management API budget; preserve and hold the record.');
  const name = `batch-${String(prepared.batches.length).padStart(5, '0')}.sql`; await writeFile(join(output, name), query);
  prepared.batches.push({ name, records: batch.length, bytes: Buffer.byteLength(query), sha256: hashBytes(query), state: 'prepared' });
  prepared.records += batch.length; batch = []; bytes = 2;
}
const input = join(sourceDir, 'ordinary-safe-candidates-v3.jsonl'), stream = createReadStream(input);
stream.on('data', bytes => { inputBytes += bytes.length; inputHash.update(bytes); });
for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
  if (!line) continue;
  const r = validateLocalRegistryRecord(JSON.parse(line), artifacts, scope), key = localOccurrenceKey(r);
  if (seen.has(key)) throw new Error('Duplicate registry source occurrence.'); seen.add(key);
  const identity = JSON.stringify([r.source_system, r.entity_type, r.native_id]);
  versions.add(JSON.stringify([r.entity_type, r.native_id, r.provenance.record_sha256]));
  winners.set(identity, selectLocalEvidenceWinner(winners.get(identity), r));
  const size = Buffer.byteLength(JSON.stringify(r)) + 1;
  if (size > 700000) throw new Error('Oversized registry source occurrence escaped its transport hold.');
  if (batch.length && (bytes + size > 700000 || batch.length >= 1000)) await flush();
  batch.push(r); bytes += size;
}
await flush(); prepared.inputSha256 = inputHash.digest('hex');
if (prepared.records !== 33927) throw new Error('Ordinary registry occurrence count changed.');
if (inputBytes !== candidate.ordinary_packet.bytes || prepared.inputSha256 !== candidate.ordinary_packet.sha256
  || winners.size !== 33297 || versions.size !== 33448) throw new Error('Frozen ordinary registry bytes, hash or identity/version counts changed.');
prepared.inputBytes = inputBytes; prepared.expectedVersions = versions.size;
const identities = [...winners.values()].map(r => [r.entity_type, r.native_id, r.provenance.record_sha256]);
identities.sort((a,b) => { for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1; return 0; });
prepared.expectedCurrentLocalEntities = winners.size;
prepared.expectedCurrentLocalEntitiesSha256 = hashBytes(identities.map(row => row.join('\t')).join('\n'));
await writeFile(join(output, 'manifest.json'), JSON.stringify(prepared, null, 2) + '\n');
console.log(JSON.stringify({ manifest: join(output, 'manifest.json'), records: prepared.records, batches: prepared.batches.length,
  expectedCurrentLocalEntities: winners.size, inputSha256: prepared.inputSha256 }));
