// Parses CTO / transfer-order schedule PDFs that pdf-backfill stored for the registry queue drops.
// Reads _stored.jsonl (sha256 + storage_key), joins the queue rows (download_url, entry id/number), fetches bytes from the private bucket
// (content-address verified), runs parse-jpml-schedule.py and writes jpml-parse/cl-<docid>.json.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined';
const work = `${root}/_work/agents/mdl-members`;
const additions = `${root}/_work/contracts/pdf-queue-additions`;
const py = 'C:/Users/firas/AppData/Local/Programs/Python/Python311/python.exe';
const parser = `${root}/wt-members/scripts/ingest/parse-jpml-schedule.py`;
const getter = `${root}/wt-members/scripts/ingest/members-bucket-get.mjs`;
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null; // restrict to CL docket ids
fs.mkdirSync(`${work}/bucket-pdfs`, { recursive: true });
fs.mkdirSync(`${work}/jpml-parse`, { recursive: true });
const queueRows = new Map();
for (const f of fs.readdirSync(additions).filter(n => n.endsWith('.jsonl') && !n.startsWith('_'))) {
  for (const l of fs.readFileSync(`${additions}/${f}`, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); queueRows.set(`${r.native_case_id}:${r.native_document_id}`, { ...r, _file: f }); }
}
const stored = fs.readFileSync(`${additions}/_stored.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
let done = 0, skipped = 0, failed = 0;
for (const s of stored) {
  if (s.provider !== 'courtlistener') continue;
  if (only && !only.has(String(s.native_case_id))) continue;
  const q = queueRows.get(`${s.native_case_id}:${s.native_document_id}`);
  if (!q || !/cto-schedules/.test(q._file)) { skipped++; continue; }
  const out = `${work}/jpml-parse/cl-${s.native_case_id}-${s.native_document_id}.json`;
  if (fs.existsSync(out) && !process.env.FORCE) { skipped++; continue; }
  const pdf = `${work}/bucket-pdfs/${s.sha256}.pdf`;
  try {
    if (!fs.existsSync(pdf)) execFileSync('node', ['--use-system-ca', getter, s.storage_key, pdf], { encoding: 'utf8' });
    const res = execFileSync(py, [parser, pdf, '--source-url', q.download_url, '--retrieved-at', s.verified_at, '--doc-date', q.filing_date ?? ''], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const j = JSON.parse(res);
    j.cl = { docket_id: String(s.native_case_id), recap_document_id: String(s.native_document_id), entry_native_id: q.origins?.[0]?.source_entry_native_id ?? null, entry_number: q.scope_evidence?.[0]?.entry_number ?? null, storage_key: s.storage_key, stored_sha256: s.sha256, queue: s.queue };
    if (!j.doc_date && q.filing_date) j.doc_date = q.filing_date;
    fs.writeFileSync(out, JSON.stringify(j));
    done++;
    if (done % 25 === 0) console.log(JSON.stringify({ progress: done, skipped, failed }));
  } catch (e) { failed++; console.log(JSON.stringify({ error: String(e.message).slice(0, 160), doc: s.native_document_id })); }
}
console.log(JSON.stringify({ event: 'done', parsed: done, skipped, failed }));
