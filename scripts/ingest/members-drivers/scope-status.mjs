// Prints the CourtListener service's scope progress (manifest.scopes) and the count results from done/ for the mdl-members pass.
//   node scope-status.mjs
import fs from 'node:fs';
import path from 'node:path';
const pass = 'C:/Users/firas/.codex/corpus-cache/courtlistener/passes/2026-10-03T1045Z-members';
const m = JSON.parse(fs.readFileSync(path.join(pass, 'live-backfill-manifest.json'), 'utf8'));
console.log('manifest keys:', Object.keys(m).join(','));
for (const [k, v] of Object.entries(m.scopes ?? {})) {
  const s = JSON.stringify(v);
  console.log('scope', k, s.length > 260 ? s.slice(0, 260) + '...' : s);
}
console.log('--- count results');
for (const f of fs.readdirSync(path.join(pass, 'done')).filter(x => /-cnt-|count-/.test(x))) {
  const j = JSON.parse(fs.readFileSync(path.join(pass, 'done', f), 'utf8'));
  console.log(f.replace(/^[0-9]+-[0-9]+-/, ''), JSON.stringify(j.result).slice(0, 220));
}
