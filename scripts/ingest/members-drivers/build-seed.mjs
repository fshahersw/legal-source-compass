import fs from 'node:fs';
const dir = 'C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/full-matter-audit/';
const census = JSON.parse(fs.readFileSync(dir + 'jpml-census.json', 'utf8'));
const parents = JSON.parse(fs.readFileSync(new URL('./parents.json', import.meta.url), 'utf8'));
const tier1 = [3047, 3140, 3094, 3163, 3180, 3166, 3080, 3113, 3081, 2846, 2873, 2804, 3108, 3149, 3114, 3185, 3125, 3144, 3043, 3060, 3014, 2738, 2741, 3026];
const tier2 = [2885, 2924, 2323, 2973, 2789, 2921, 2672, 2843, 2800, 3031, 2606, 2592, 2545, 2782];
// latest census row per MDL, newest report_date first
const byMdl = new Map();
for (const r of census) {
  const list = byMdl.get(r.mdl) ?? [];
  list.push(r);
  byMdl.set(r.mdl, list);
}
function parseDocketbirdId(id) {
  // court-office:yyyy-type-seq
  const m = String(id ?? '').match(/^([a-z]+)-(\d{1,2}):(\d{4})-([a-z]{2,4})-(\d{3,6})$/);
  return m ? { court_id: m[1], office: m[2], year: Number(m[3]), type: m[4], seq: m[5].padStart(5, '0'), docketbird_id: id, docket_key: `${m[1]}:${m[2]}:${m[3]}-${m[4]}-${m[5].padStart(5, '0')}`, docket_number: `${m[2]}:${m[3].slice(2)}-${m[4]}-${m[5].padStart(5, '0')}` } : null;
}
const out = [];
const seen = new Set();
for (const p of parents) {
  const mdl = Number(p.mdl);
  if (!mdl || seen.has(mdl)) continue;
  seen.add(mdl);
  const rows = (byMdl.get(mdl) ?? []).slice().sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)));
  const latest = rows[0] ?? null;
  const tier = tier1.includes(mdl) ? 'tier1' : tier2.includes(mdl) ? 'tier2' : 'other';
  out.push({
    mdl, tier, tier_rank: tier === 'tier1' ? tier1.indexOf(mdl) : tier === 'tier2' ? tier2.indexOf(mdl) : null,
    caption_parent_csv: p.caption, master_docketbird_id: p.docket, master: parseDocketbirdId(p.docket),
    cl_ids_parent_csv: p.cl_ids ? String(p.cl_ids).split(/;\s*/).filter(Boolean) : [],
    jpml_parent_csv: { pending: p.jpml_pending === '' ? null : Number(p.jpml_pending), historical: p.jpml_all === '' ? null : Number(p.jpml_all), census_date: p.jpml_date || null },
    census_latest: latest ? { report_date: latest.report_date, pending: latest.pending, historical: latest.historical, scope: latest.scope, url: latest.url, official_master_docket: latest.official_master_docket ?? null, caption: latest.caption } : null,
    role: p.role,
  });
}
// Tier-2 MDLs absent from parent-matters.csv: master identity from the exact CourtListener header (court + docket number), no DocketBird id claimed
const extras = [
  { mdl: 2606, caption: 'IN RE: Benicar (Olmesartan) Products Liability Litigation', cl_ids: ['5838695'], court: 'njd', number: '1:15-md-02606' },
  { mdl: 2592, caption: 'IN RE: Xarelto (Rivaroxaban) Products Liability Litigation', cl_ids: ['4270519'], court: 'laed', number: '2:14-md-02592' },
  { mdl: 2545, caption: 'IN RE: Testosterone Replacement Therapy Products Liability Litigation', cl_ids: ['4261857', '18704765'], court: 'ilnd', number: '1:14-cv-01748' },
];
function parseNumber(court, n) {
  const m = String(n).match(/^(\d{1,2}):(\d{2})-([a-z]{2,4})-(\d{3,6})$/);
  const year = Number(m[2]) < 70 ? 2000 + Number(m[2]) : 1900 + Number(m[2]);
  const seq = m[4].padStart(5, '0');
  return { court_id: court, office: String(Number(m[1])), year, type: m[3], seq, docketbird_id: null, docket_key: `${court}:${Number(m[1])}:${year}-${m[3]}-${seq}`, docket_number: n };
}
for (const x of extras) {
  if (seen.has(x.mdl)) continue;
  seen.add(x.mdl);
  const rows = (byMdl.get(x.mdl) ?? []).slice().sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)));
  const latest = rows[0] ?? null;
  out.push({ mdl: x.mdl, tier: 'tier2', tier_rank: tier2.indexOf(x.mdl), caption_parent_csv: x.caption, master_docketbird_id: null, master: parseNumber(x.court, x.number), cl_ids_parent_csv: x.cl_ids, jpml_parent_csv: { pending: null, historical: null, census_date: null },
    census_latest: latest ? { report_date: latest.report_date, pending: latest.pending, historical: latest.historical, scope: latest.scope, url: latest.url, official_master_docket: latest.official_master_docket ?? null, caption: latest.caption } : { report_date: null, pending: null, historical: null, scope: null, url: null, official_master_docket: null, caption: x.caption }, role: 'extra seed (not in parent-matters.csv); master identity from CourtListener header' });
}
// tier ordering lists may include MDLs absent from parent-matters.csv
const missing = [...tier1, ...tier2].filter(m => !seen.has(m));
fs.writeFileSync(new URL('./matters-seed.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('matters', out.length, 'tier1', out.filter(o => o.tier === 'tier1').length, 'tier2', out.filter(o => o.tier === 'tier2').length, 'missing from parent csv', JSON.stringify(missing));
for (const o of out.filter(o => o.tier === 'tier1').sort((a, b) => a.tier_rank - b.tier_rank)) console.log(o.mdl, o.master_docketbird_id, JSON.stringify(o.cl_ids_parent_csv), o.census_latest?.pending, o.census_latest?.historical, o.census_latest?.report_date);
