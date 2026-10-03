// Preserve small review/edge work queues before deleting the redundant local DB.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { LEGAL_ENUMS } from '../../src/lib/legal/schema.ts';
const [configFile] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const db = new DatabaseSync(config.database, { readOnly: true });
const output = path.join(config.output, 'cloud-handoff'); fs.mkdirSync(output, { recursive: true });
const files = db.prepare('select path,sha256,state,rows from files order by path').all();
if (files.some(f => f.state !== 'complete')) throw Error('Mapping is not complete');
const metadata = Object.fromEntries(db.prepare('select key,value from stage_metadata').all().map(r => [r.key,r.value]));
const edgePath = path.join(output, 'edges.jsonl'); const fd = fs.openSync(edgePath, 'wx'); const edgeDigest = crypto.createHash('sha256'); let edges = 0;
try {
  for (const row of db.prepare('select edge_key,payload from edges order by edge_key').iterate()) {
    const line = JSON.stringify({ edge_key: row.edge_key, payload: JSON.parse(row.payload) }) + '\n';
    fs.writeSync(fd, line); edgeDigest.update(line); edges++;
  }
} finally { fs.closeSync(fd); }
const seed = crypto.randomBytes(32).toString('hex');
const rank = key => crypto.createHash('sha256').update(seed + '\n' + key).digest('hex');
function keep(items, key, limit) {
  const value = rank(key);
  if (items.length === limit && value >= items.at(-1).rank) return;
  let low = 0, high = items.length;
  while (low < high) { const mid = (low + high) >>> 1; if (items[mid].rank < value) low = mid + 1; else high = mid; }
  items.splice(low, 0, { key, rank: value }); if (items.length > limit) items.pop();
}
const samples = Object.fromEntries(Object.keys(LEGAL_ENUMS.entity_type).map(type => [type, { population: 0, required: 100, selected: [] }]));
const population = crypto.createHash('sha256').update(JSON.stringify({ metadata, files }));
// record_key is immutable and embeds the source version. The mapper and all
// source-file hashes above bind this snapshot without scanning payloads again.
for (const row of db.prepare('select record_key from records order by record_key').iterate()) {
  const key = row.record_key, type = JSON.parse(key)[1];
  samples[type].population++; keep(samples[type].selected, key, 100); population.update(key);
}
const sourceSamples = []; let inputs = 0;
for (const row of db.prepare('select input_key from inputs order by input_key').iterate()) { inputs++; keep(sourceSamples, row.input_key, 50); }
const handoff = { schema_version: metadata.schema_version, population_sha256: population.digest('hex'), population_basis: 'Immutable canonical keys, mapper hash and original input-file hashes',
  mapper_sha256: metadata.mapper_sha256, source_files: files, source_inputs: inputs, seed,
  entity_samples: Object.fromEntries(Object.entries(samples).map(([type, s]) => [type, { population: s.population, required: s.required, keys: s.selected.map(x => x.key) }])),
  source_samples: { federalregister: { population: inputs, required: 50, keys: sourceSamples.map(x => x.key) } },
  edge_file: edgePath, edge_sha256: edgeDigest.digest('hex'), edges, reviews: [], complete: false };
fs.writeFileSync(path.join(output, 'handoff.json'), JSON.stringify(handoff, null, 2), { flag: 'wx' });
fs.writeFileSync(path.join(output, 'edge-upload-config.json'), JSON.stringify({ ...config, edge_file: edgePath }, null, 2), { flag: 'wx' });
db.close();
console.log(JSON.stringify({ source_inputs: inputs, records: Object.values(samples).reduce((n,s) => n+s.population,0), edges, output, complete: false }));
