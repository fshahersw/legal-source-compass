// Smoke test for database/contracts/pdf-govinfo-source-v1.sql (run it right after the migration; it is also safe BEFORE it, where the govinfo checks report "not yet migrated").
//   node --use-system-ca scripts/ingest/official-mdl/govinfo-migration-smoke.mjs --credentials=<preview json with the service key> [--run-dir=<official-mdl run dir>] [--save-snapshot=<file>] [--compare-snapshot=<file>]
// What it does (service role through PostgREST; nothing is ever written except the idempotent re-registration of one receipt that is already registered):
//   A. idempotent re-registration of ONE existing official-court receipt: the RPC must acknowledge it and corpus_matter_pdf_documents_v1 must report identical counts before/after
//      (also compare in SQL:  select count(*) from corpus_ingest.pdf_asset_observations;  and  select count(*) from corpus_ingest.pdf_document_assets;  before and after: both unchanged)
//   B. corpus_pdf_availability_v1: govinfo open only with sealing_related_locator_held = false; the other providers unchanged
//   C. govinfo dry-run through corpus_admin_register_pdf_assets_v1 with a well-formed row whose storage object does not exist: after the migration the ONLY failure is
//      'Private stored original not found at verified size' (all govinfo validations passed, nothing written); malformed variants fail with 'GovInfo granule identity or sealing flag mismatch'
//   D. official-court counts of five matters are identical to a snapshot taken before (--save-snapshot before, --compare-snapshot after)
//   E. corpus_official_mdl_documents_v1 answers and reports by_source
// Exit code 0 only when every check that applies to the detected state passes. Credentials are never printed.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { transportRow } from '../../admin/register-private-pdf-assets.mjs';
import { resolveRunDir, parseArgs, readJsonl } from './store.mjs';

const args = parseArgs(process.argv.slice(2));
const runDir = resolveRunDir(args['run-dir']);
const cfg = JSON.parse(fs.readFileSync(String(args.credentials), 'utf8'));
if (cfg.EXTERNAL_SUPABASE_URL !== 'https://xosqzzsnhxcyehcnirpa.supabase.co') throw Error('WRONG_PROJECT');
const token = cfg.EXTERNAL_SUPABASE_KEY;
const headers = { apikey: token, 'Content-Type': 'application/json', ...(!token.startsWith('sb_') ? { Authorization: 'Bearer ' + token } : {}) };
async function rpc(name, body) {
  const res = await fetch(cfg.EXTERNAL_SUPABASE_URL + '/rest/v1/rpc/' + name, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, ok: res.ok, data, message: data?.message ?? null };
}
const results = [];
const check = (name, pass, detail = {}) => { results.push({ name, pass }); console.log(JSON.stringify({ check: name, pass, ...detail })); };

// B. availability rule
const avail = async (system, flags) => (await rpc('corpus_pdf_availability_v1', { p_source_system: system, p_provider_flags: flags })).data;
const govinfoOpen = await avail('govinfo', { sealing_related_locator_held: false });
const migrated = govinfoOpen === 'open';
console.log(JSON.stringify({ detected_state: migrated ? 'migrated' : 'not yet migrated (govinfo reports held)' }));
check('availability: official-court false -> open (unchanged)', (await avail('official-court', { sealing_related_locator_held: false })) === 'open');
check('availability: official-court true -> held (unchanged)', (await avail('official-court', { sealing_related_locator_held: true })) === 'held');
check('availability: docketbird without restricted=false -> held (unchanged)', (await avail('docketbird', {})) === 'held');
check('availability: courtlistener available+unsealed -> open (unchanged)', (await avail('courtlistener', { is_available: true, is_sealed: false })) === 'open');
check('availability: unknown source -> held', (await avail('unknown-source', { sealing_related_locator_held: false })) === 'held');
if (migrated) {
  check('availability: govinfo flag false -> open', govinfoOpen === 'open');
  check('availability: govinfo flag true -> held', (await avail('govinfo', { sealing_related_locator_held: true })) === 'held');
  check('availability: govinfo flag missing -> held', (await avail('govinfo', {})) === 'held');
}

// A. idempotent re-registration of one existing receipt
const transfers = path.join(runDir, 'transfers');
const label = fs.existsSync(path.join(transfers, 'b001-ilnd')) ? 'b001-ilnd' : fs.readdirSync(transfers)[0];
const receipt = readJsonl(path.join(transfers, label, 'transfer-receipts.jsonl')).find(r => r.state === 'cloud_verified');
const row = transportRow(receipt);
const summaryOf = async caseId => (await rpc('corpus_matter_pdf_documents_v1', { p_native_case_ids: [caseId], p_limit: 1, p_offset: 0 })).data?.summary;
const before = await summaryOf(receipt.native_case_id);
const reg = await rpc('corpus_admin_register_pdf_assets_v1', { p_rows: [row] });
const after = await summaryOf(receipt.native_case_id);
check('re-registration of an existing receipt is acknowledged', reg.ok && reg.data?.received === 1 && reg.data?.private_only === true, { case: receipt.native_case_id, status: reg.status, message: reg.message });
check('re-registration leaves the matter PDF summary unchanged', JSON.stringify(before) === JSON.stringify(after), { before, after });

// C. govinfo dry-run (never matches a stored object)
const sha = randomBytes(32).toString('hex'), sha1 = createHash('sha1').update(sha).digest('hex'), recordSha = randomBytes(32).toString('hex');
const pkg = 'USCOURTS-njd-3_16-md-02738', granule = pkg + '-999999', url = 'https://www.govinfo.gov/content/pkg/' + pkg + '/pdf/' + granule + '.pdf';
const govRow = (over = {}) => ({ state: 'cloud_verified', project_id: 'xosqzzsnhxcyehcnirpa', bucket: 'corpus-originals', provider: 'govinfo', native_document_id: granule, native_case_id: '3:16-md-02738', durable_url: url,
  sha256: sha, sha1, bytes: 1234, storage_key: 'seeger-weiss/pdf-sha256/' + sha.slice(0, 2) + '/' + sha + '.pdf', selected_source_record_sha256: recordSha, queue_sha256: randomBytes(32).toString('hex'), verified_at: new Date().toISOString(),
  provider_flags: { sealing_related_locator_held: false, pdf_http_access_verified: false, pdf_content_verified: false },
  source_origins: [{ native_document_id: granule, native_case_id: '3:16-md-02738', native_record_sha256: recordSha, source_response_sha256: randomBytes(32).toString('hex'), retrieved_at: new Date().toISOString() }], ...over });
const dry = await rpc('corpus_admin_register_pdf_assets_v1', { p_rows: [govRow()] });
if (migrated) {
  check('govinfo dry-run reaches the storage check and writes nothing', !dry.ok && /Private stored original not found at verified size/.test(dry.message ?? ''), { message: dry.message });
  for (const [name, over] of [['sealing flag true', { provider_flags: { sealing_related_locator_held: true } }], ['wrong URL', { durable_url: url.replace('/pdf/', '/htm/') }], ['empty case number', { native_case_id: '' }],
    ['malformed granule id', { native_document_id: 'USCOURTS-njd-xyz' }], ['URL of another granule', { durable_url: url.replace('999999', '1') }]]) {
    const bad = await rpc('corpus_admin_register_pdf_assets_v1', { p_rows: [govRow(over)] });
    // the origin parent check can fire first when only native_case_id changes; either way the row is rejected and nothing is written
    check('govinfo variant rejected: ' + name, !bad.ok && /GovInfo granule identity or sealing flag mismatch|Original provenance digest or parent required|Invalid verified PDF asset/.test(bad.message ?? ''), { message: bad.message });
  }
} else {
  check('pre-migration: govinfo rows are rejected as an unknown provider (expected before the migration)', !dry.ok && /Invalid verified PDF asset/.test(dry.message ?? ''), { message: dry.message });
}

// D. official-court counts unchanged
const ids = ['3:16-md-02738', '1:23-cv-00818', '3:24-md-03114-D', '2:25-md-03163-KSM', '4:26-md-3185', '3:25md3140'];
const snapshot = {};
for (const id of ids) snapshot[id] = await summaryOf(id);
if (args['save-snapshot']) { fs.writeFileSync(path.resolve(String(args['save-snapshot'])), JSON.stringify(snapshot, null, 1)); console.log(JSON.stringify({ snapshot_saved: path.resolve(String(args['save-snapshot'])) })); }
if (args['compare-snapshot']) {
  const prior = JSON.parse(fs.readFileSync(path.resolve(String(args['compare-snapshot'])), 'utf8'));
  for (const id of ids) check('official-court summary unchanged for ' + id, JSON.stringify(prior[id]) === JSON.stringify(snapshot[id]), { before: prior[id], after: snapshot[id] });
}

// E. projection RPC
const docs = await rpc('corpus_official_mdl_documents_v1', { p_native_case_ids: ['3:24-md-03114-D'], p_limit: 2, p_offset: 0 });
check('corpus_official_mdl_documents_v1 answers with printed titles', docs.ok && docs.data?.rows?.length > 0 && docs.data.rows.every(r => r.source_system && r.printed_title !== undefined), { total: docs.data?.summary?.total ?? null, by_source: docs.data?.summary?.by_source ?? null });

const failed = results.filter(r => !r.pass);
console.log(JSON.stringify({ summary: { checks: results.length, failed: failed.length, state: migrated ? 'migrated' : 'not yet migrated' } }));
if (failed.length) process.exitCode = 2;
