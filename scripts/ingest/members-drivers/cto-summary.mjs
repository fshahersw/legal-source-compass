import fs from 'node:fs';
const dir = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members/jpml-parse/';
const by = {};
for (const f of fs.readdirSync(dir).filter(n => n.startsWith('cl-'))) {
  const j = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
  const k = `${j.cl.docket_id}|mdl ${j.mdl_no}`;
  const e = by[k] ?? { docs: 0, rows: 0, types: {}, keys: new Set(), noRows: 0, unresolved: 0, mismatchMdl: 0, pages: 0 };
  e.docs++; e.rows += j.row_count; e.types[j.doc_type] = (e.types[j.doc_type] ?? 0) + 1;
  if (!j.row_count) e.noRows++;
  for (const r of j.rows) { if (r.docket_key) e.keys.add(r.docket_key); else e.unresolved++; }
  by[k] = e;
}
for (const [k, e] of Object.entries(by)) console.log(k.padEnd(24), 'docs', String(e.docs).padStart(3), 'rows', String(e.rows).padStart(5), 'distinct keys', String(e.keys.size).padStart(5), 'docs w/o rows', e.noRows, 'unresolved rows', e.unresolved, JSON.stringify(e.types));
// docs with zero rows: list a few
let shown = 0;
for (const f of fs.readdirSync(dir).filter(n => n.startsWith('cl-'))) {
  const j = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
  if (!j.row_count && shown < 6) { shown++; console.log('NOROWS', f, j.mdl_no, j.doc_type, j.cto_no, j.pages, 'pages'); }
}
