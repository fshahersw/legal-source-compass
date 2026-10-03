// Per-drop status of the PDF queue additions written by mdl-members: rows queued vs rows stored by pdf-backfill (_stored.jsonl).
// node pdf-queue-status.mjs
import fs from 'node:fs';
import path from 'node:path';
const dir = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/contracts/pdf-queue-additions';
const stored = new Set();
const storedFile = path.join(dir, '_stored.jsonl');
for (const l of fs.readFileSync(storedFile, 'utf8').split('\n')) { if (!l.trim()) continue; try { const r = JSON.parse(l); stored.add(`${r.provider}:${r.native_document_id}`); } catch { /* skip */ } }
const failed = new Set();
const failedFile = path.join(dir, '_failed.jsonl');
if (fs.existsSync(failedFile)) for (const l of fs.readFileSync(failedFile, 'utf8').split('\n')) { if (!l.trim()) continue; try { const r = JSON.parse(l); failed.add(`${r.provider}:${r.native_document_id}`); } catch { /* skip */ } }
const out = [];
const totals = { files: 0, rows: 0, stored: 0, failed: 0 };
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.jsonl') && !n.startsWith('_')).sort()) {
  let rows = 0, st = 0, fl = 0; const dockets = new Set();
  for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!l.trim()) continue;
    let r; try { r = JSON.parse(l); } catch { continue; }
    rows++; dockets.add(r.native_case_id);
    const k = `${r.provider}:${r.native_document_id}`;
    if (stored.has(k)) st++; else if (failed.has(k)) fl++;
  }
  out.push({ file: f, rows, stored: st, failed: fl, pending: rows - st - fl, dockets: [...dockets].join(',') });
  totals.files++; totals.rows += rows; totals.stored += st; totals.failed += fl;
}
for (const o of out) console.log(JSON.stringify(o));
console.log(JSON.stringify({ totals, stored_index_rows: stored.size, failed_index_rows: failed.size }));
