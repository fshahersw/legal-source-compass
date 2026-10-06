// Authoritative per-case document inventory: DocketBird document-list CSV first, then PDF pulls.
// Lands every CSV row through corpus_admin_gapfill_docketbird_v1 as docket-document entities (pdf_downloaded:false).
// If the provider CSV route rejects Bearer auth (known API-gateway quirk), builds the same column set from
// /documents/search enumeration and archives a canonical CSV snapshot with sha256 provenance.
import fs from 'node:fs/promises';
import path from 'node:path';
import {archiveRaw, sha256, canonicalIntegerJson, appendJsonl} from './lib.mjs';
import {DB_ORIGIN, DocketBird} from './clients.mjs';
import {dbDocumentRow} from './normalize.mjs';

export const CSV_URL = `${DB_ORIGIN}/document-list.csv`;
/** Case-page “Download CSV” export (same Bearer session as the REST API). */
export const casePageCsvUrl = caseId => `${DB_ORIGIN}/cases/${encodeURIComponent(caseId)}/document-list.csv`;
const COL = {
  id: ['document id', 'document_id', 'id', 'docketbird document id'],
  entry: ['entry number', 'entry_number', 'docket sheet number', 'docket_sheet_number', 'entry no', 'entry no.'],
  date: ['date', 'filing date', 'filing_date', 'filed'],
  description: ['description', 'title', 'document description'],
  status: ['status', 'download status', 'availability'],
  label: ['label', 'document type', 'doc type'],
  parties: ['parties', 'party', 'party names'],
  filename: ['filename', 'file name', 'custom filename', 'custom_filename'],
};

const norm = h => String(h ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
function pick(row, names) {
  for (const [k, v] of Object.entries(row)) if (names.includes(norm(k)) && String(v ?? '').trim()) return String(v).trim();
  return null;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const split = line => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { q = !q; continue; }
      if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  const headers = split(lines[0]).map(norm);
  return lines.slice(1).map(line => {
    const vals = split(line);
    const r = {};
    headers.forEach((h, i) => { r[h] = vals[i] ?? ''; });
    return r;
  });
}

export function parseDocumentListCsv(text) {
  const rows = parseCsv(text);
  return rows.map(r => {
    const docId = pick(r, COL.id);
    const entry = pick(r, COL.entry);
    const entryNum = entry && /^\d+$/.test(entry) ? Number(entry) : null;
    return {
      document_id: docId,
      entry_number: entryNum,
      filing_date: pick(r, COL.date),
      description: pick(r, COL.description),
      status: pick(r, COL.status),
      label: pick(r, COL.label),
      parties: pick(r, COL.parties),
      filename: pick(r, COL.filename),
      raw: r,
    };
  }).filter(r => r.document_id);
}

export function csvToDocument(caseId, row, receipt, inventorySource) {
  const doc = {
    id: row.document_id,
    title: row.description,
    filing_date: row.filing_date,
    restricted: false,
    primary_docket_sheet_number: row.entry_number,
    downloaded: /not downloaded|pending/i.test(row.status ?? '') ? 0 : null,
    custom_filename: row.filename,
    document_list_status: row.status,
    document_list_label: row.label,
    document_list_parties: row.parties,
    inventory_source: inventorySource,
  };
  const base = dbDocumentRow(caseId, doc, receipt);
  const tool = inventorySource === 'case-page-document-list-csv' ? 'GET /cases/{id}/document-list.csv'
    : inventorySource === 'document-list-csv' ? 'GET /document-list.csv'
      : 'GET /documents/search (inventory fallback)';
  base.provenance = {...base.provenance, source_tool: tool, inventory_csv_sha256: receipt.source_sha256};
  return base;
}

async function fetchCsvUrl({url, cacheDir, key, fetchImpl, label}) {
  const res = await fetchImpl(url, {headers: {Authorization: `Bearer ${key}`, Accept: 'text/csv,*/*'}, redirect: 'error', signal: AbortSignal.timeout(120000)});
  const bytes = Buffer.from(await res.arrayBuffer());
  const receipt = await archiveRaw(cacheDir, bytes, {source: 'docketbird', source_url: url, request_method: 'GET', http_status: res.status, retrieved_at: new Date().toISOString(), schema_version: 'docketbird-document-list-csv/1', export_route: label});
  const text = bytes.toString('utf8');
  const ok = res.status === 200 && !text.trim().startsWith('{') && !/^\s*</.test(text);
  return {ok, text: ok ? text : null, receipt, http_status: res.status, route: label, preview: ok ? null : text.slice(0, 120)};
}

/** Try case-page export, then the legacy query route; record every attempt. */
export async function fetchDocumentListCsv({caseId, cacheDir, key = process.env.DOCKETBIRD_API_KEY, fetchImpl = fetch}) {
  const attempts = [];
  for (const [label, url] of [['case-page-document-list-csv', casePageCsvUrl(caseId)], ['document-list-csv', `${CSV_URL}?case_id=${encodeURIComponent(caseId)}`]]) {
    const r = await fetchCsvUrl({url, cacheDir, key, fetchImpl, label});
    attempts.push({route: label, http_status: r.http_status, ok: r.ok});
    if (r.ok) return {text: r.text, receipt: r.receipt, source: label, attempts};
  }
  return {text: null, receipt: attempts.at(-1)?.receipt, source: null, attempts};
}

export async function buildInventoryCsvFromSearch({db, caseId, cacheDir}) {
  const st = {search: {cursor: null, ids: [], done: false}};
  const save = async () => {};
  while (!st.search.done) {
    const params = {case_id: caseId, q: '*', size: '100', ...(st.search.cursor ? {cursor: st.search.cursor} : {})};
    const {data} = await db.get('/documents/search', params);
    for (const d of data.documents ?? []) st.search.ids.push({id: d.document_id, title: d.title ?? null, filing_date: d.filing_date ?? null});
    st.search.cursor = data.next_cursor ?? null;
    st.search.done = !st.search.cursor;
  }
  const header = 'Document ID,Entry Number,Date,Description,Status,Label,Parties,Filename\n';
  const lines = st.search.ids.map(d => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [d.id, '', d.filing_date ?? '', d.title ?? '', 'search_index', '', '', ''].map(esc).join(',');
  });
  const text = header + lines.join('\n') + (lines.length ? '\n' : '');
  const bytes = Buffer.from(text, 'utf8');
  const receipt = await archiveRaw(cacheDir, bytes, {source: 'docketbird', source_url: `${DB_ORIGIN}/documents/search`, request_method: 'GET', http_status: 200, retrieved_at: new Date().toISOString(), schema_version: 'docketbird-document-list-csv/1', inventory_fallback: true});
  return {text, receipt, source: 'search_enumeration_fallback', enumerated: st.search.ids.length};
}

export async function landCaseInventory({work, caseId, stageDir, runId, apply = true}) {
  const cacheDir = path.join(work, 'raw', 'document-list');
  await fs.mkdir(stageDir, {recursive: true});
  const ckFile = path.join(work, 'inventory-checkpoint.json');
  const ck = JSON.parse(await fs.readFile(ckFile, 'utf8').catch(() => '{"cases":{}}'));
  if (ck.cases[caseId]?.landed) return ck.cases[caseId];

  let text, receipt, source, meta = {};
  const primary = await fetchDocumentListCsv({caseId, cacheDir});
  meta.csv_attempts = primary.attempts ?? [];
  if (primary.text && primary.source) {
    text = primary.text; receipt = primary.receipt; source = primary.source;
    await fs.mkdir(path.join(work, 'document-list'), {recursive: true});
    await fs.writeFile(path.join(work, 'document-list', `${caseId.replace(/[^A-Za-z0-9]/g, '_')}.csv`), text);
  } else {
    const db = new DocketBird({cacheDir, maxRequests: 500000, minGapMs: 250});
    const fb = await buildInventoryCsvFromSearch({db, caseId, cacheDir});
    text = fb.text; receipt = fb.receipt; source = fb.source; meta = {...meta, enumerated: fb.enumerated, inventory_fallback: true};
    await fs.mkdir(path.join(work, 'document-list'), {recursive: true});
    await fs.writeFile(path.join(work, 'document-list', `${caseId.replace(/[^A-Za-z0-9]/g, '_')}.csv`), text);
  }
  const parsed = parseDocumentListCsv(text);
  const docFile = path.join(stageDir, 'docket-document.jsonl');
  let staged = 0;
  for (const row of parsed) {
    if (!row.document_id.startsWith(caseId + '-')) continue;
    const ingest = csvToDocument(caseId, row, receipt, source);
    ingest.data.inventory_record_sha256 = sha256(canonicalIntegerJson(ingest.data));
    await appendJsonl(docFile, ingest);
    staged++;
  }
  ck.cases[caseId] = {landed: true, at: new Date().toISOString(), source, rows: staged, parsed: parsed.length, csv_sha256: receipt.source_sha256, ...meta};
  await fs.writeFile(ckFile, JSON.stringify(ck, null, 2));
  if (apply && staged && runId) {
    const {spawn} = await import('node:child_process');
    const here = path.dirname(new URL(import.meta.url).pathname);
    const delta = path.join(work, 'delta-inventory'); await fs.rm(delta, {recursive: true, force: true});
    await fs.mkdir(path.join(delta, 'docketbird-rest'), {recursive: true});
    await fs.copyFile(docFile, path.join(delta, 'docketbird-rest', 'docket-document.jsonl'));
    const code = await new Promise(res => spawn('node', [path.join(here, 'send-staged.mjs'), '--provider=docketbird', `--stage=${delta}`, `--run=${runId}`, '--apply'], {stdio: 'inherit'}).on('exit', res));
    if (code !== 0) throw new Error('INVENTORY_LAND_FAILED');
  }
  return ck.cases[caseId];
}
