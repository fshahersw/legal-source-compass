/**
 * Proves the projection reproduces the existing federal_register_history rows
 * field for field. Acquires a window of already-held days from the official API
 * and compares every projected field with the live row (matched by document URL).
 *
 *   node verify-projection.mjs --from 2026-08-10 --through 2026-08-20 --dir PRIVATE_DIR
 */
import { acquireRange, loadCheckpoint, readPage } from './acquire.mjs';
import { corpusClient } from './corpus.mjs';
import { projectRecord, DATASET, pickFields, compareNewestFirst, qualification, legacyQualification } from './lib.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const from = arg('--from'), through = arg('--through'), dir = arg('--dir');
if (!from || !through || !dir) throw new Error('Usage: --from DAY --through DAY --dir PRIVATE_DIR');
const corpus = corpusClient();
await acquireRange(dir, from, through, { recheckDays: 0 });
const cp = loadCheckpoint(dir);
const fetched = [];
for (const [day, entry] of Object.entries(cp.days)) {
  if (day < from || day > through) continue;
  for (const page of entry.pages) for (const row of readPage(dir, page).results) fetched.push(pickFields(row));
}
const live = new Map();
for (let offset = 0; ; offset += 1000) {
  const rows = await corpus.get(`corpus_records?dataset=eq.${DATASET}&select=id,ordinal,category,state,county_geoids,title,source_url,item,detail,text,filters&order=ordinal.asc&limit=1000&offset=${offset}`);
  for (const r of rows) {
    const published = r.item?.cells?.published;
    if (published >= from && published <= through) live.set(r.source_url, r);
  }
  if (!rows.length || rows.at(-1).item?.cells?.published < from) break;
}
const collected = '2026-08-20';
const coverage = { from: '1994-01-03', through: '2026-08-20' };
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
// The historical rows' `text` still ends with the pre-rewrite sentence (only detail.qualification was
// rewritten), so `text` is compared without its qualification suffix.
const suffixes = [qualification(coverage.from, coverage.through, collected), legacyQualification(coverage.from, coverage.through, collected)];
const stripQualification = (t) => { for (const s of suffixes) if (t.endsWith(s)) return t.slice(0, -s.length); return t; };
let matched = 0, missing = 0;
const diffs = {};
const examples = {};
for (const d of fetched) {
  const url = `https://www.federalregister.gov/d/${d.document_number}`;
  const row = live.get(url);
  if (!row) { missing++; continue; }
  const p = projectRecord(d, { id: row.id, ordinal: row.ordinal, collected, coverage });
  let exact = true;
  for (const k of ['category', 'state', 'county_geoids', 'title', 'source_url', 'item', 'detail', 'text', 'filters']) {
    const a = k === 'text' ? stripQualification(p[k]) : stable(p[k]);
    const b = k === 'text' ? stripQualification(row[k]) : stable(row[k]);
    if (a !== b) {
      exact = false;
      diffs[k] = (diffs[k] ?? 0) + 1;
      const a = stable(p[k]), b = stable(row[k]);
      let i = 0;
      while (a[i] === b[i]) i++;
      (examples[k] ??= []).length < 3 && examples[k].push({ doc: d.document_number, at: i, projected: a.slice(Math.max(0, i - 60), i + 120), live: b.slice(Math.max(0, i - 60), i + 120) });
    }
  }
  if (exact) matched++;
}
const liveOrder = [...live.values()].sort((a, b) => a.ordinal - b.ordinal).map((r) => r.source_url.split('/').pop());
const ourOrder = [...fetched].sort(compareNewestFirst).map((d) => d.document_number);
const orderMismatches = liveOrder.filter((n, i) => n !== ourOrder[i]).length;
console.log(JSON.stringify({ window: [from, through], fetched: fetched.length, live: live.size, matchedExact: matched, notInLive: missing, fieldDiffs: diffs, orderRuleMismatches: orderMismatches }));
if (Object.keys(examples).length) console.log(JSON.stringify(examples, null, 1).slice(0, 5000));
