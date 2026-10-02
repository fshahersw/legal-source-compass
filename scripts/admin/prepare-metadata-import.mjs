/** Prepare resumable administrative SQL batches; never embeds credentials or fetches PDFs. */
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((s, i, a) => s.startsWith('--') ? [s.slice(2), a[i + 1]] : []).filter(p => p.length));
if (!args.run || !/^[0-9a-f-]{36}$/i.test(args.run) || !args.input || !args.output) {
  throw new Error('Use --run UUID --input completed.jsonl --output private-batch-directory. Do not use partial files.');
}
if (args.input.endsWith('.part')) throw new Error('Partial source files cannot be imported.');
const input = resolve(args.input), output = resolve(args.output);
await mkdir(output, { recursive: true });
const aliases = {
  'people-db-people': 'people', 'people-db-positions': 'positions',
  'people-db-educations': 'educations', 'people-db-schools': 'schools',
  'people-db-political-affiliations': 'political-affiliations',
  'people-db-races': 'races', people_db_race: 'race-choices',
  'people-db-retention-events': 'retention-events',
};
const hash = (v) => createHash('sha256').update(v).digest('hex');
const manifest = { schemaVersion: 'corpus-ingest-batches/1', runId: args.run, input, inputSha256: null, records: 0, metadataOnly: true, batches: [] };
let records = [], bytes = 2, sourceHash = createHash('sha256');
const rawInput = createReadStream(input); rawInput.on('data', b => sourceHash.update(b));
const reader = createInterface({ input: rawInput, crlfDelay: Infinity });
async function flush() {
  if (!records.length) return;
  const payload = JSON.stringify(records), delimiter = `$corpus_${hash(payload).slice(0, 16)}$`;
  if (payload.includes(delimiter)) throw new Error('SQL delimiter collision.');
  const query = `select corpus_ingest.ingest_entities('${args.run}'::uuid,${delimiter}${payload}${delimiter}::jsonb) as result;\n`;
  const name = `batch-${String(manifest.batches.length).padStart(5, '0')}.sql`;
  await writeFile(join(output, name), query);
  manifest.batches.push({ name, records: records.length, bytes: Buffer.byteLength(query), sha256: hash(query), state: 'prepared' });
  manifest.records += records.length; records = []; bytes = 2;
}
for await (const line of reader) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (!r.native_id || !r.entity_type || !r.source_system || !r.schema_version || !r.data || Array.isArray(r.data)
    || !/^[0-9a-f]{64}$/.test(r.provenance?.record_sha256 ?? '') || !/^https?:\/\//.test(r.provenance?.source_url ?? '') || !r.provenance?.retrieved_at) {
    throw new Error(`Missing identity/schema/hash/source provenance at record ${manifest.records + records.length + 1}.`);
  }
  r.provenance = { ...r.provenance, native_entity_type: r.provenance.native_entity_type ?? r.entity_type };
  r.entity_type = aliases[r.entity_type] ?? r.entity_type;
  const size = Buffer.byteLength(JSON.stringify(r)) + 1;
  if (size > 850000) throw new Error('Single record exceeds the safe management-API budget; preserve it and use a direct database importer.');
  if (records.length && (bytes + size > 850000 || records.length >= 2000)) await flush();
  records.push(r); bytes += size;
}
await flush(); manifest.inputSha256 = sourceHash.digest('hex');
const path = join(output, 'manifest.json');
await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ manifest: path, records: manifest.records, batches: manifest.batches.length, inputSha256: manifest.inputSha256 }));
