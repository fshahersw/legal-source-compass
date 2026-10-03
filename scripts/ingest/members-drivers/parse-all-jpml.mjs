// Parses every PDF listed in jpml-pdfs/fetch-index.jsonl (and extra specs) with parse-jpml-schedule.py -> jpml-parse/*.json
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const work = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members';
const py = 'C:/Users/firas/AppData/Local/Programs/Python/Python311/python.exe';
const parser = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/wt-members/scripts/ingest/parse-jpml-schedule.py';
const outDir = path.join(work, 'jpml-parse');
fs.mkdirSync(outDir, { recursive: true });
const entries = fs.readFileSync(path.join(work, 'jpml-pdfs', 'fetch-index.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
for (const e of entries) {
  const name = path.basename(e.file).replace(/\.pdf$/, '');
  const res = execFileSync(py, [parser, e.file, '--source-url', e.url, '--retrieved-at', e.retrieved_at], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const j = JSON.parse(res);
  fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify(j, null, 1));
  console.log(name, j.mdl_no, j.doc_type, j.doc_date, 'rows', j.row_count, 'unresolved courts', j.rows.filter(r => r.unresolved_court).length);
}
