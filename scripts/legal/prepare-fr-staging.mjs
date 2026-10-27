import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { FEDERAL_REGISTER_SCHEMA_VERSION, heldUrlSet, isIsoDay, windowProblems } from '../../src/lib/legal/frRefresh.ts';
import { inputKey } from './stage.ts';

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const agencyRows = agencies => agencies.data.map(data => JSON.stringify({ source_system: 'federalregister', entity_type: 'agencies', native_id: String(data.id), data, provenance: { ...agencies.provenance, record_sha256: hash(data), schema_version: FEDERAL_REGISTER_SCHEMA_VERSION } })).join('\n') + '\n';
const documentObject = row => ({ source_system: 'federalregister', entity_type: 'documents', native_id: row.id, data: JSON.parse(row.payload), provenance: JSON.parse(row.provenance) });
const documentRow = row => JSON.stringify(documentObject(row)) + '\n';
const WINDOW_SQL = 'select id,html_url,publication_date,payload,provenance from publications where publication_date>=? and publication_date<=? order by publication_date,html_url';

/**
 * The staging input keys of every publication in [from, through] of an acquired native directory,
 * computed exactly as stage.ts does. Used to ask production which of them it has already staged.
 */
export function windowInputKeys(source, from, through) {
  const db = new DatabaseSync(path.join(source, 'native.sqlite'), { readOnly: true });
  try { return db.prepare(WINDOW_SQL).all(from, through).map(row => inputKey(documentObject(row))); } finally { db.close(); }
}

/** The 2026-10-02 full snapshot (2000-01 through 2026-10-02, 322 monthly periods). Kept to replay that load exactly. */
export function prepareFullSnapshot(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const db = new DatabaseSync(path.join(source, 'native.sqlite'), { readOnly: true });
  const periods = db.prepare('select * from periods order by start_date').all();
  if (periods.length !== 322 || periods.at(-1).end_date !== '2026-10-02' || periods.some(p => p.status !== 'acquired' || p.expected !== p.actual)) throw Error('Expected source periods are not all acquired');
  const agencies = JSON.parse(fs.readFileSync(path.join(source, 'agencies.json'), 'utf8'));
  const agencyFile = path.join(destination, 'agencies-native.jsonl');
  if (fs.existsSync(agencyFile)) throw Error('Preserve an existing normalized snapshot; choose a new destination');
  fs.writeFileSync(agencyFile, agencyRows(agencies));
  const files = [agencyFile];
  for (let year = 2000; year <= 2026; year++) {
    const target = path.join(destination, `documents-${year}.jsonl`);
    const fd = fs.openSync(target, 'wx'); let rows = 0;
    try {
      for (const row of db.prepare('select id,payload,provenance from publications where publication_date>=? and publication_date<=? order by html_url').iterate(`${year}-01-01`, `${year}-12-31`)) { fs.writeSync(fd, documentRow(row)); rows++; }
    } finally { fs.closeSync(fd); }
    files.push(target); console.log(JSON.stringify({ year, rows }));
  }
  db.close();
  const config = { schema_version: 'legal-atlas/3.1', database: path.join(destination, 'stage.sqlite'), output: path.join(destination, 'reports'), end_year: 2026, support_files: [agencyFile], files };
  fs.writeFileSync(path.join(destination, 'config.json'), JSON.stringify(config, null, 2));
  return config;
}

/**
 * An incremental window [from, through]. Every acquired period must tile the window with the
 * publisher's count kept. Publications already held in legal_atlas (matched by exact publisher
 * URL from `held`) are left out, so no second version of a held document is ever staged; a held
 * row whose payload changed upstream is listed, not restaged. Rows whose staging input key is in
 * `staged` (already in legal_atlas.staging but not held, i.e. staged earlier and rejected in
 * production) are left out and listed too: production staging is immutable per input key, so
 * restaging one is at best a no-op and, after a mapper change, aborts the whole upload with
 * 'Immutable staging version conflict'. Agencies are support rows only: they resolve parent
 * agencies and are never restaged as new agency versions.
 */
export function prepareWindow(source, destination, { from, through, held = [], staged = [] }) {
  if (!isIsoDay(from) || !isIsoDay(through) || from > through) throw Error('Use --from and --through as ISO dates with from <= through');
  fs.mkdirSync(destination, { recursive: true });
  const db = new DatabaseSync(path.join(source, 'native.sqlite'), { readOnly: true });
  try {
    const problems = windowProblems(db.prepare('select * from periods order by start_date').all(), from, through);
    if (problems.length) throw Error(`Window is not completely acquired: ${problems.join('; ')}`);
    const agencies = JSON.parse(fs.readFileSync(path.join(source, 'agencies.json'), 'utf8'));
    const agencyFile = path.join(destination, 'agencies-native.jsonl');
    const target = path.join(destination, `documents-${from}_${through}.jsonl`);
    if (fs.existsSync(agencyFile) || fs.existsSync(target)) throw Error('Preserve an existing normalized snapshot; choose a new destination');
    fs.writeFileSync(agencyFile, agencyRows(agencies));
    const heldUrls = heldUrlSet(held); const stagedKeys = new Set(staged);
    const byDay = {}; const skipped = []; let alreadyStaged = 0;
    const fd = fs.openSync(target, 'wx'); let rows = 0;
    try {
      for (const row of db.prepare(WINDOW_SQL).iterate(from, through)) {
        if (heldUrls.has(row.html_url)) { skipped.push({ id: row.id, source_url: row.html_url, publication_date: row.publication_date, reason: 'held' }); continue; }
        const native = documentObject(row); const key = stagedKeys.size ? inputKey(native) : null;
        if (key && stagedKeys.has(key)) { skipped.push({ id: row.id, source_url: row.html_url, publication_date: row.publication_date, reason: 'already_staged', input_key: key }); alreadyStaged++; continue; }
        fs.writeSync(fd, JSON.stringify(native) + '\n'); rows++;
        byDay[row.publication_date] = (byDay[row.publication_date] ?? 0) + 1;
      }
    } finally { fs.closeSync(fd); }
    const source_rows = db.prepare('select count(*) n from publications where publication_date>=? and publication_date<=?').get(from, through).n;
    const config = { schema_version: 'legal-atlas/3.1', database: path.join(destination, 'stage.sqlite'), output: path.join(destination, 'reports'), end_year: Number(through.slice(0, 4)),
      window: { from, through, source_rows, staged_rows: rows, held_skipped: skipped.length - alreadyStaged, ...(alreadyStaged ? { already_staged_skipped: alreadyStaged } : {}), by_day: byDay }, support_files: [agencyFile], files: [target] };
    fs.writeFileSync(path.join(destination, 'config.json'), JSON.stringify(config, null, 2));
    if (skipped.length) fs.writeFileSync(path.join(destination, 'held-skipped.json'), JSON.stringify(skipped, null, 2));
    return config;
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1]; };
  const from = flag('--from'); const through = flag('--through'); const heldFile = flag('--held');
  const [source, destination] = args;
  if (!source || !destination) throw Error('Usage: prepare-fr-staging.mjs NATIVE_DIR DEST [--from D --through D [--held held.json]]');
  if (from || through) {
    const held = heldFile ? JSON.parse(fs.readFileSync(heldFile, 'utf8')) : [];
    const config = prepareWindow(source, destination, { from, through, held: Array.isArray(held) ? held : held.held ?? [] });
    console.log(JSON.stringify(config.window));
  } else prepareFullSnapshot(source, destination);
}
