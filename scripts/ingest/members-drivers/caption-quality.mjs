// Audits the captions extracted from JPML order schedules (jpml-parse/*.json): well-formedness by document type.
// node caption-quality.mjs [--show=N] [--mdl=3047]
import fs from 'node:fs';
import path from 'node:path';
const dir = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members/jpml-parse';
const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return [x.slice(2, i), x.slice(i + 1)]; }));
const show = Number(args.show ?? 0);
const only = args.mdl ? Number(args.mdl) : null;
const FRAG_START = /^(et al|llc|inc|corp|corporation|company|co\.|ltd|l\.p\.|lp|pharma|pharmaceuticals|usa|plc|and|d\/b\/a)\b/i;
function verdict(c) {
  const s = String(c ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return 'empty';
  if (/2SSRVHG/i.test(s)) return 'garbled_marker';
  if (/[^\x20-\x7e\u2019\u2018\u201c\u201d\u2013\u2014\u00e9\u00e8\u00f1\u00e1\u00ed\u00f3\u00fa\u00fc\u00e7]/.test(s)) return 'odd_chars';
  const v = s.match(/\s(?:v|vs)\.?\s/gi) ?? [];
  if (v.length > 1) return 'two_captions_merged';
  if (FRAG_START.test(s)) return 'starts_mid_phrase';
  if (/\s(?:v|vs)\.?$/i.test(s) || /\bet$/i.test(s) || /\b(?:of|the|and|for|d\/b\/a|a|an)$/i.test(s)) return 'ends_mid_phrase';
  if (s.length < 6) return 'too_short';
  return 'ok';
}
const tally = {}; const samples = {};
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (only && j.mdl_no !== only) continue;
  for (const r of j.rows ?? []) {
    const k = `${j.doc_type}|${verdict(r.caption)}`;
    tally[k] = (tally[k] ?? 0) + 1;
    if (show && verdict(r.caption) !== 'ok' && (samples[k] ?? []).length < show) (samples[k] ??= []).push(String(r.caption).replace(/\s+/g, ' ').slice(0, 130));
  }
}
console.log(JSON.stringify(tally, null, 1));
for (const [k, v] of Object.entries(samples)) console.log(k, JSON.stringify(v));
