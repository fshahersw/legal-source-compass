// Prints manifest record counts (captured) and provider totals per CourtListener docket scope for reconciliation with the database.
import fs from 'node:fs';
const pass = 'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-03T1045Z-members';
const m = JSON.parse(fs.readFileSync(`${pass}/live-backfill-manifest.json`, 'utf8'));
const kind = process.argv[2] ?? 'docket-entries';
const rows = [];
for (const [k, v] of Object.entries(m.scopes)) {
  if (!k.startsWith(kind + ':')) continue;
  const id = k.split(':')[1];
  rows.push({ id, records: v.records ?? 0, complete: v.complete === true, total: (m.counts ?? {})[k]?.count ?? null, status: v.status ?? null, updated_at: v.updated_at });
}
rows.sort((a, b) => Number(a.id) - Number(b.id));
for (const r of rows) console.log(JSON.stringify(r));
