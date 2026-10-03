import fs from 'node:fs';
import path from 'node:path';
const pass = 'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-03T1045Z-members';
const m = JSON.parse(fs.readFileSync(path.join(pass, 'live-backfill-manifest.json'), 'utf8'));
const want = new Set(['69674950', '72052106', '73443394', '72030009', '65407433', '68222905', '67678440', '6240169', '8408916']);
for (const [k, v] of Object.entries(m.scopes)) {
  const id = k.split(':')[1];
  if (!want.has(id)) continue;
  const c = (m.counts ?? {})[k];
  console.log(k.padEnd(28), 'records', String(v.records).padStart(6), 'complete', v.complete, 'count', c?.count ?? '-', 'next', v.next ? 'yes' : 'no', v.updated_at?.slice(11, 19));
}
const q = fs.readdirSync(path.join(pass, 'queue'));
console.log('queue:', q.join(' | '));
const failed = fs.readdirSync(path.join(pass, 'failed'));
console.log('failed:', failed.length, failed.slice(0, 5).join(' | '));
const counts = Object.entries(m.counts ?? {}).map(([k, v]) => `${k}=${v.count}`).join(' ');
console.log(counts);
