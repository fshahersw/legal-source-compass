// DEPRECATED 2026-10-03 16:25Z: `official-mdl` owns official-court PDF acquisition (own run dir, crawl-delay aware transfers; see _work/contracts/official-mdl-documents.md).
// Do NOT drop rows built by this script into _work/contracts/pdf-queue-additions: the CL-family freezer would transfer njd.uscourts.gov links at 1 request/s.
// It ran once for MDL 2738 (10 rows, frozen as a-0011 / a-0012) and is kept for reference. Re-running it overwrites --out (an earlier re-run emptied a file).
//
// Builds pdf-backfill queue additions ('source-qualified-pdf-queue/1', provider 'official-court') from the court's own MDL pages that the registry fetched
// (_work/agents/mdl-members/official-pages/*.html + fetch-index.jsonl). No PDF bytes are requested here; pdf-backfill freezes and transfers them.
// Only direct links on *.uscourts.gov pages are queued; sealing-related labels are held (never queued). Rows already present in any frozen queue are skipped.
//
// node --use-system-ca scripts/ingest/members-official-pdf-queue.mjs --mdl=2738 --out=<file.jsonl>
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { sha256 } from './members-registry-lib.mjs';
import { validateQueueRow, sourcePrivacyQualification } from './backfill-pdfs-to-supabase.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), 'true'] : [x.slice(2, i), x.slice(i + 1)]; }));
const mdl = Number(args.mdl);
const out = path.resolve(args.out ?? '');
if (!mdl || !args.out) throw new Error('--mdl and --out are required');
const work = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members';
const CFG = { 2738: { case_id: '3:16-md-02738', host: 'https://www.njd.uscourts.gov', pages: ['njd-talc-upcoming', 'njd-talc-main', 'njd-talc-panel-orders'] } }[mdl];
if (!CFG) throw new Error(`no official pages configured for MDL ${mdl}`);
const index = new Map(fs.readFileSync(path.join(work, 'official-pages', 'fetch-index.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.label, r]));
const SEAL = /seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact/i;
const clean = s => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const iso = s => { const m = String(s).match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})/); if (!m) return null; const y = m[3].length === 2 ? (Number(m[3]) < 70 ? 2000 + Number(m[3]) : 1900 + Number(m[3])) : Number(m[3]); return `${y}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`; };

// known URLs in frozen queues (pdf-backfill) and other additions
const known = new Set();
async function scan(file) { const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity }); for await (const l of rl) { if (!l.trim()) continue; try { const r = JSON.parse(l); if (r.download_url) known.add(r.download_url); if (r.durable_url) known.add(r.durable_url); } catch { /* skip */ } } }
const pb = 'C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-03/pdf-backfill-20261003';
const pf = 'C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/pdf-focus-20261002';
for (const base of [pb, pf]) for (const d of ['courtlistener-pdf-batches', 'docketbird-pdf-batches', 'additions-pdf-batches']) { const dir = path.join(base, d); if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.queue.jsonl')) await scan(path.join(dir, f)); }
const additions = 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/contracts/pdf-queue-additions';
for (const f of fs.readdirSync(additions)) if (f.endsWith('.jsonl') && !f.startsWith('_') && path.resolve(additions, f) !== out) await scan(path.join(additions, f));

const rows = []; const held = []; const skipped = [];
const seen = new Set();
for (const label of CFG.pages) {
  const rec = index.get(label);
  if (!rec) continue;
  const html = fs.readFileSync(rec.file, 'utf8');
  // links with their printed label; a following "Date:" / "Description:" pair (orders list) is attached when present
  for (const m of html.matchAll(/<a href="(\/sites\/njd\/files\/[^"]+\.pdf)"[^>]*>([^<]*)<\/a>(?:<\/p>\s*<p>Date:\s*([^<]*)<\/p>\s*<p>Description:\s*([\s\S]*?)<\/p>)?/g)) {
    const url = CFG.host + m[1];
    if (/AttorneyJJTalcumPowderMDL/i.test(url)) continue; // court instructions for opening a case, not a docket document
    if (seen.has(url)) continue; seen.add(url);
    const linkLabel = clean(m[2]);
    const description = m[4] ? clean(m[4]) : null;
    const datePrinted = m[3] ? clean(m[3]) : (linkLabel.match(/\d{1,2}-\d{1,2}-\d{4}/) ?? [null])[0];
    const title = description || linkLabel;
    if (SEAL.test(title) || SEAL.test(linkLabel)) { held.push({ url, title, reason: 'sealing_related_label' }); continue; }
    if (known.has(url)) { skipped.push({ url, reason: 'already_in_a_frozen_queue' }); continue; }
    const record = { matter: `mdl:${mdl}`, case_id: CFG.case_id, url, link_label: linkLabel, description, date_printed: datePrinted, page_url: rec.final_url, page_sha256: rec.sha256 };
    const recordSha = sha256(JSON.stringify(record));
    const row = {
      schema_version: 'source-qualified-pdf-queue/1', provider: 'official-court',
      native_document_id: url, native_document_identity_kind: 'publisher_observed_pdf_locator_url', native_case_id: CFG.case_id, native_case_identity_kind: 'exact_sourced_master_docket_literal',
      durable_url: url, download_url: url, expected_sha1: null, expected_bytes: null, title, filing_date: null,
      selected_source_record_sha256: recordSha,
      provider_flags: { sealing_related_locator_held: false, pdf_http_access_verified: false, pdf_content_verified: false },
      eligible: true, held_reason: null,
      source_claims: { matter_scope: `mdl:${mdl}`, source_document_label: title, index_date_iso: datePrinted ? iso(datePrinted) : null, date_semantics: 'date printed beside the link on the court MDL page', date_is_verified_native_filing_date: false, pdf_content_verified: false, source_metadata_only: true },
      scope_evidence: [{ kind: 'sw_matter_registry_priority', filter: 'official_court_mdl_page', docket_id: null, entry_number: null, note: `MDL ${mdl} document listed on the court's own MDL page (the CourtListener master docket is blocked at the source)`, firm_appearance_certified: false }],
      origins: [{ capture_file: rec.file, capture_file_sha256: rec.sha256, native_case_id: CFG.case_id, native_record_sha256: recordSha, retrieved_at: rec.retrieved_at, source_url: rec.final_url, source_sha256: rec.sha256 }],
      provenance: { adapter_version: 'sw-matter-registry-official-pdf-queue/1', metadata_only_adapter: true, pdf_transfers: 0, new_api_requests: 0, source_page_label: label, native_document_identity_is_source_locator: true, expected_pdf_checksum_and_size: 'not_recorded' },
    };
    row.source_privacy_qualification = sourcePrivacyQualification(row);
    validateQueueRow(row);
    rows.push(row);
  }
}
fs.mkdirSync(path.dirname(out), { recursive: true });
const body = rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
fs.writeFileSync(out, body);
fs.writeFileSync(out + '.manifest.json', JSON.stringify({ file: out, rows: rows.length, bytes: Buffer.byteLength(body), sha256: sha256(body), mdl, held, skipped, created_at: new Date().toISOString(), schema_version: 'source-qualified-pdf-queue/1' }, null, 1));
console.log(JSON.stringify({ event: 'official_queue', mdl, rows: rows.length, held: held.length, skipped: skipped.length, out: path.basename(out) }));
