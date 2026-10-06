// Live equivalence check for the extracted entry builder: rebuild existing sw_docket_entries_v1 rows from the lake with makeEntryRecord and compare
// them with what is projected (item, filters, title, text, detail minus per-run provenance).
//   node verify-entry-record.mjs <cl_docket_id> <mdl> <docket_key> <docket_number> <court_id> [sample=100]
import {rpc, rest} from '../members-pgrest.mjs';
import {makeEntryRecord} from '../members-entry-record.mjs';
import {canon, sha256} from '../members-publish-rules.mjs';
import {sameJson} from './project-registry.mjs';

const [docket, mdl, docket_key, docket_number, court_id, sampleArg] = process.argv.slice(2);
const enc = encodeURIComponent, SCHEMA = 'sw-matter-registry-view/1';
const ctx = {mdl, docket_key, docket_number, court_id};
const run0 = (await rest(`corpus_records?select=detail&dataset=eq.sw_docket_entries_v1&filters->>mdl=eq.${mdl}&limit=1`)).data[0].detail.provenance.run_ids[0];
const finish = rec => { rec.detail.provenance.projection_row_sha256 = sha256(canon([rec.id, rec.title, rec.item, rec.detail, rec.filters, rec.text, rec.source_url])); return rec; };
const env = {run: run0, SCHEMA, DS_ENTRIES: 'sw_docket_entries_v1', finish, clDocketUrl: id => `https://www.courtlistener.com/docket/${id}/`,
  masterLink: c => `#record/sw_matter_dockets_v1/${enc(`sw-md:${c.mdl}:${c.docket_key}`)}`, matterLink: c => `#record/sw_matters_v1/${enc(`sw-matter:${c.mdl}`)}`};
const lake = (await rpc('corpus_sw_registry_read_v1', {p_kind: 'docket-entries', p_docket_ids: [docket], p_limit: Number(sampleArg ?? 100)})).rows;
let same = 0, diff = 0; const bad = [];
// CourtListener may rename a docket slug between lake versions; the slug part of docket URLs is masked (the numeric ids still compare).
const mask = o => JSON.parse(JSON.stringify(o).replace(/(https:\/\/www\.courtlistener\.com\/docket\/\d+\/\d*\/?)[a-z0-9-]*\/?/g, '$1'));
const strip = r => { const d = JSON.parse(JSON.stringify(r.detail)); delete d.provenance; return mask({item: r.item, filters: r.filters, title: r.title, text: r.text, detail: d}); };
for (const row of lake) {
  const built = makeEntryRecord(row, ctx, env).rec;
  const live = (await rest(`corpus_records?select=title,text,item,detail,filters&dataset=eq.sw_docket_entries_v1&id=eq.${enc(built.id)}`)).data[0];
  if (live && sameJson(strip(built), strip(live))) same++; else { diff++; if (bad.length < 3) bad.push(built.id); }
}
console.log(JSON.stringify({docket, mdl, compared: lake.length, identical: same, different: diff, examples: bad}));
if (process.env.SHOW_DIFF && bad[0]) {
  const row = lake.find(r => `sw-entry:courtlistener:${r.native_id}` === bad[0]);
  const built = strip(makeEntryRecord(row, ctx, env).rec), live = strip((await rest(`corpus_records?select=title,text,item,detail,filters&dataset=eq.sw_docket_entries_v1&id=eq.${enc(bad[0])}`)).data[0]);
  const walk = (a, b, p = '') => { if (sameJson(a, b)) return; if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${p}.${k}`); } else console.log(p, JSON.stringify(a)?.slice(0, 160), '|', JSON.stringify(b)?.slice(0, 160)); };
  walk(built, live);
}
