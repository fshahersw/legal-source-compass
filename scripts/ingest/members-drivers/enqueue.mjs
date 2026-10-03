// Usage: node enqueue.mjs '<json array of tasks>'  (or --file=tasks.json)
import fs from 'node:fs';
import path from 'node:path';
const pass = process.env.CL_PASS ?? 'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-03T1045Z-members';
const arg = process.argv[2] ?? '';
const tasks = arg.startsWith('--file=') ? JSON.parse(fs.readFileSync(arg.slice(7), 'utf8')) : JSON.parse(arg);
const q = path.join(pass, 'queue');
const existing = new Set([...fs.readdirSync(q), ...fs.readdirSync(path.join(pass, 'done')), ...fs.readdirSync(path.join(pass, 'failed'))]);
let n = 0;
for (const t of tasks) {
  const pr = String(t.priority ?? 5).padStart(2, '0');
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const label = (t.label ?? `${t.type}-${t.docket_id ?? t.court ?? 'x'}-${t.kind ?? ''}-${t.docket_number ?? ''}`).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 70);
  const name = `${pr}-${stamp}-${String(n).padStart(3, '0')}-${label}.json`;
  if (existing.has(name)) continue;
  fs.writeFileSync(path.join(q, name), JSON.stringify(t, null, 1));
  n++;
}
console.log('enqueued', n, 'queue size now', fs.readdirSync(q).length);
