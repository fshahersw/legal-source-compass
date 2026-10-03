import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const [destination, endDate = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!destination || !/^20\d{2}-\d{2}-\d{2}$/.test(endDate)) throw Error('Usage: acquire-federal-register.mjs PRIVATE_DIRECTORY END_DATE');
fs.mkdirSync(path.join(destination, 'pages'), { recursive: true });
const db = new DatabaseSync(path.join(destination, 'native.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS pages(url TEXT PRIMARY KEY,sha256 TEXT NOT NULL,retrieved_at TEXT NOT NULL,path TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS publications(html_url TEXT PRIMARY KEY,id TEXT NOT NULL,publication_date TEXT NOT NULL,payload TEXT NOT NULL,provenance TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS document_versions(id TEXT NOT NULL,sha256 TEXT NOT NULL,payload TEXT NOT NULL,provenance TEXT NOT NULL,PRIMARY KEY(id,sha256));
  CREATE TABLE IF NOT EXISTS periods(start_date TEXT PRIMARY KEY,end_date TEXT NOT NULL,expected INTEGER NOT NULL,actual INTEGER NOT NULL,status TEXT NOT NULL,as_of TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS publications_date ON publications(publication_date);
  CREATE INDEX IF NOT EXISTS publications_number ON publications(id);`);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequest = 0;
async function get(url) {
  const u = new URL(url);
  if (u.origin !== 'https://www.federalregister.gov' || !u.pathname.startsWith('/api/v1/') || u.username || u.password) throw Error('Unexpected source endpoint');
  const cached = db.prepare('select * from pages where url=?').get(url);
  if (cached) {
    const bytes = fs.readFileSync(cached.path);
    if (hash(bytes) !== cached.sha256) throw Error('Retained page checksum changed');
    return { data: JSON.parse(bytes), provenance: { source_url: url, retrieved_at: cached.retrieved_at, source_sha256: cached.sha256, http_status: 200 } };
  }
  let response;
  for (let attempt = 0; attempt < 7; attempt++) {
    await pause(Math.max(0, 1000 - (Date.now() - lastRequest))); lastRequest = Date.now();
    try { response = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(60000), headers: { Accept: 'application/json' } }); }
    catch { if (attempt === 6) throw Error('Federal Register network retries exhausted; acquisition is resumable'); await pause(Math.min(30000, 1000 * 2 ** attempt)); continue; }
    if (response.ok) break;
    if (response.status !== 429 && response.status < 500) throw Error(`Federal Register HTTP ${response.status}`);
    const retry = response.headers.get('retry-after');
    const wait = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Math.max(0, Date.parse(retry) - Date.now()) : 0;
    await response.body?.cancel();
    // Long publisher cooldowns stop with a retry time instead of retrying early.
    if (wait > 60000) throw Error(`Federal Register cooldown; retry after ${new Date(Date.now() + wait).toISOString()}`);
    await pause(Math.max(wait || 0, Math.min(30000, 1000 * 2 ** attempt)));
  }
  if (!response?.ok) throw Error('Federal Register retries exhausted');
  const bytes = Buffer.from(await response.arrayBuffer()); const sha256 = hash(bytes);
  const data = JSON.parse(bytes); const retrieved = new Date().toISOString();
  const file = path.join(destination, 'pages', sha256 + '.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: 'wx' });
  db.prepare('insert into pages values(?,?,?,?)').run(url, sha256, retrieved, file);
  return { data, provenance: { source_url: url, retrieved_at: retrieved, source_sha256: sha256, http_status: 200 } };
}
const fields = ['document_number','title','type','publication_date','agencies','cfr_references','regulation_id_numbers','docket_ids','dockets','effective_on','html_url','pdf_url','raw_text_url','full_text_xml_url','action','comments_close_on','regulations_dot_gov_info','regulation_id_number_info','json_url','citation'];
const source = await get('https://www.federalregister.gov/api/v1/agencies.json');
fs.writeFileSync(path.join(destination, 'agencies.json'), JSON.stringify(source));
for (let year = 2000; year <= Number(endDate.slice(0, 4)); year++) for (let month = 1; month <= 12; month++) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  if (start > endDate) break;
  const end = [new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), endDate].sort()[0];
  const prior = db.prepare('select * from periods where start_date=?').get(start);
  if (prior?.status === 'acquired' && prior.end_date === end) continue;
  const stat = fs.statfsSync(destination); if (stat.bavail * stat.bsize < 5 * 1024 ** 3) throw Error('Acquisition stopped at the 5 GiB disk reserve');
  const url = new URL('https://www.federalregister.gov/api/v1/documents.json');
  url.searchParams.set('conditions[publication_date][gte]', start); url.searchParams.set('conditions[publication_date][lte]', end); url.searchParams.set('per_page', '1000');
  for (const field of fields) url.searchParams.append('fields[]', field);
  let next = url.href; let expected = null; let total = 0; const seen = new Set(); const ids = new Set();
  while (next) {
    if (seen.has(next)) throw Error('Repeated Federal Register cursor'); seen.add(next);
    const { data, provenance } = await get(next);
    if (!Array.isArray(data.results) || !Number.isSafeInteger(data.count)) throw Error('Unexpected Federal Register result shape');
    if (expected !== null && expected !== data.count) throw Error('Publisher count changed within a period; do not mark it complete'); expected = data.count;
    db.exec('BEGIN');
    try {
      for (const row of data.results) {
        if (typeof row.document_number !== 'string' || typeof row.html_url !== 'string' || row.publication_date < start || row.publication_date > end || ids.has(row.html_url)) throw Error('Duplicate publication or out-of-period Federal Register record');
        // The source reuses some document numbers for different publication dates
        // (for example 00-888). Keep the official number and every source version.
        ids.add(row.html_url); const raw = JSON.stringify(row); const recordHash = hash(raw);
        const p = JSON.stringify({ ...provenance, record_sha256: recordHash, schema_version: 'federal-register-api-v1/round3', source_as_of: endDate });
        db.prepare('insert or ignore into document_versions values(?,?,?,?)').run(row.document_number, recordHash, raw, p);
        db.prepare('insert into publications values(?,?,?,?,?) on conflict(html_url) do update set payload=excluded.payload,provenance=excluded.provenance').run(row.html_url, row.document_number, row.publication_date, raw, p);
        total++;
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    next = data.next_page_url;
  }
  if (expected !== total) throw Error('Federal Register total does not match its published count');
  db.prepare('insert or replace into periods values(?,?,?,?,?,?)').run(start, end, expected, total, 'acquired', new Date().toISOString());
  console.log(JSON.stringify({ period: start.slice(0, 7), source_rows: total, state: 'acquired', audited: false }));
}
console.log(JSON.stringify({ rows: db.prepare('select count(*) n from publications').get().n, periods: db.prepare('select count(*) n from periods').get().n, state: 'acquired', audited: false })); db.close();
