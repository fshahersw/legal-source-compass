import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const [source, destination] = process.argv.slice(2);
fs.mkdirSync(destination, { recursive: true });
const db = new DatabaseSync(path.join(source, 'native.sqlite'), { readOnly: true });
const periods = db.prepare('select * from periods order by start_date').all();
if (periods.length !== 322 || periods.at(-1).end_date !== '2026-10-02' || periods.some(p => p.status !== 'acquired' || p.expected !== p.actual)) throw Error('Expected source periods are not all acquired');
const agencies = JSON.parse(fs.readFileSync(path.join(source, 'agencies.json'), 'utf8'));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const agencyFile = path.join(destination, 'agencies-native.jsonl');
if (fs.existsSync(agencyFile)) throw Error('Preserve an existing normalized snapshot; choose a new destination');
fs.writeFileSync(agencyFile, agencies.data.map(data => JSON.stringify({ source_system: 'federalregister', entity_type: 'agencies', native_id: String(data.id), data, provenance: { ...agencies.provenance, record_sha256: hash(data), schema_version: 'federal-register-api-v1/round3' } })).join('\n') + '\n');
const files = [agencyFile];
for (let year = 2000; year <= 2026; year++) {
  const target = path.join(destination, `documents-${year}.jsonl`);
  const fd = fs.openSync(target, 'wx'); let rows = 0;
  try {
    for (const row of db.prepare('select id,payload,provenance from publications where publication_date>=? and publication_date<=? order by html_url').iterate(`${year}-01-01`, `${year}-12-31`)) {
      fs.writeSync(fd, JSON.stringify({ source_system: 'federalregister', entity_type: 'documents', native_id: row.id, data: JSON.parse(row.payload), provenance: JSON.parse(row.provenance) }) + '\n'); rows++;
    }
  } finally { fs.closeSync(fd); }
  files.push(target); console.log(JSON.stringify({ year, rows }));
}
db.close();
const config = { schema_version: 'legal-atlas/3.1', database: path.join(destination, 'stage.sqlite'), output: path.join(destination, 'reports'), end_year: 2026, support_files: [agencyFile], files };
fs.writeFileSync(path.join(destination, 'config.json'), JSON.stringify(config, null, 2));
