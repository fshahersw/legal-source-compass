import fs from 'node:fs';
const dir = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members/registry-staging/';
for (const m of process.argv.slice(2)) {
  const b = JSON.parse(fs.readFileSync(`${dir}bundle-${m}.json`, 'utf8'));
  const master = b.dockets.find(d => d.role === 'master');
  const jp = b.dockets.find(d => d.role === 'jpml_panel');
  const j = master.judge_refs.map(x => `${x.role}:${x.source_string ?? '-'}${x.cl_person_id ? '#' + x.cl_person_id : ''}`).join('; ');
  const ids = master.provider_ids.map(p => `${p.provider}:${p.id}`).join(' ');
  const e = b.entry_captures[0];
  console.log(JSON.stringify({ mdl: m, master: master.key, ids, jpml_panel: jp?.provider_ids[0]?.id ?? null, judges: j, jpml: b.seed.jpml ? `${b.seed.jpml.pending}/${b.seed.jpml.historical}` : null, entries: e ? `${e.captured_manifest_records}/${e.provider_total}${e.complete ? ' complete' : ''}` : null, by_basis: b.counts.by_basis, dockets: b.counts.member_like_dockets, jpml_docs: b.jpml_documents.length }));
}
