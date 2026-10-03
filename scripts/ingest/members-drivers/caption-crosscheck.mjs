// Cross-checks JPML-schedule captions against independent captions (CourtListener header / DocketBird title) for the same docket key.
// node caption-crosscheck.mjs [--show=N]
import fs from 'node:fs';
import path from 'node:path';
const root = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members';
const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return [x.slice(2, i), x.slice(i + 1)]; }));
const show = Number(args.show ?? 0);
const tok = s => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['inc', 'llc', 'the', 'and', 'corp', 'ltd', 'plc', 'all', 'et', 'al', 'co'].includes(w)));
const overlap = (a, b) => { const A = tok(a), B = tok(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };
// independent captions by docket key
const indep = new Map();
for (const f of fs.readdirSync(path.join(root, 'registry-staging')).filter(n => /^bundle-\d+\.json$/.test(n))) {
  const b = JSON.parse(fs.readFileSync(path.join(root, 'registry-staging', f), 'utf8'));
  for (const d of b.dockets) for (const c of d.captions) if (c.source === 'courtlistener_header' || c.source === 'docketbird') indep.set(d.key, [...(indep.get(d.key) ?? []), c.value]);
}
const stats = {}; const bad = {};
const dir = path.join(root, 'jpml-parse');
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const r of j.rows ?? []) {
    const ind = indep.get(r.docket_key);
    if (!ind || !r.caption) continue;
    const best = Math.max(...ind.map(x => overlap(r.caption, x)));
    const k = `${j.doc_type}|${best >= 0.6 ? 'agrees' : best > 0 ? 'partial' : 'disagrees'}`;
    stats[k] = (stats[k] ?? 0) + 1;
    if (show && best < 0.6 && (bad[k] ?? []).length < show) (bad[k] ??= []).push({ docket: r.docket_key, jpml: String(r.caption).replace(/\s+/g, ' ').slice(0, 90), indep: ind[0].slice(0, 90) });
  }
}
console.log(JSON.stringify(stats, null, 1));
for (const [k, v] of Object.entries(bad)) console.log(k, JSON.stringify(v, null, 1));
