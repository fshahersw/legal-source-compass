// Offline contract test of database/contracts/corpus-sw-docketbird-read-v1.sql (and its rollback) on pglite.
//   PUBLISHER_CODE_PGLITE=<path to @electric-sql/pglite/dist/index.js> node --test scripts/ingest/gap-fill/docketbird-read-sql.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const runtime = process.env.PUBLISHER_CODE_PGLITE ?? path.join(root, 'private/tools/publisher-code-contract-tests/node_modules/@electric-sql/pglite/dist/index.js');
// pglite lives in the private tool folder; where it is absent (CI) the test is skipped, not failed.
const available = await fs.access(runtime).then(() => true, () => false);
const {PGlite} = available ? await import(pathToFileURL(runtime).href) : {};
const skip = available ? false : 'pglite runtime not available (set PUBLISHER_CODE_PGLITE)';
const sql = await fs.readFile(path.join(root, 'database/contracts/corpus-sw-docketbird-read-v1.sql'), 'utf8');
const rollback = await fs.readFile(path.join(root, 'database/contracts/corpus-sw-docketbird-read-v1.rollback.sql'), 'utf8');

async function db() {
  const d = new PGlite();
  await d.exec(`create role anon; create role authenticated; create role service_role;
    create schema corpus_ingest;
    create table corpus_ingest.entities (source_system text, entity_type text, native_id text, payload_sha256 text, data jsonb, provenance jsonb, retrieved_at timestamptz, review_status text, primary key (source_system, entity_type, native_id));`);
  const ins = (s, t, id, data, prov = {}, rs = 'source_metadata') => d.query('insert into corpus_ingest.entities values ($1,$2,$3,$4,$5,$6,now(),$7)', [s, t, id, 'h-' + id, JSON.stringify(data), JSON.stringify(prov), rs]);
  await ins('docketbird-rest', 'case', 'azd-2:2023-md-03081', {id: 'azd-2:2023-md-03081', title: 'In re Bard', court_id: 'azd'}, {record_sha256: 'r1', source_sha256: 's1', retrieved_at: 't', field_map: {x: 1}, request: 'https://api.docketbird.com/cases/x'});
  for (let i = 1; i <= 3; i++) await ins('docketbird-rest', 'docket-document', `azd-2:2023-md-03081-0000${i}`, {id: `azd-2:2023-md-03081-0000${i}`, case_id: 'azd-2:2023-md-03081', title: `Doc ${i}`, restricted: i === 3}, {record_sha256: 'r', source_sha256: 's', retrieved_at: 't', field_map: {}});
  await ins('docketbird-rest', 'docket-document', 'njd-2:2024-md-03113-00001', {id: 'njd-2:2024-md-03113-00001', case_id: 'njd-2:2024-md-03113'});
  await ins('docketbird-rest', 'docket-document', 'njd-2:2024-md-03113-00002', {id: 'njd-2:2024-md-03113-00002', case_id: 'njd-2:2024-md-03113'}, {}, 'quarantined');
  await ins('docketbird-mcp', 'document_metadata', 'azd-2:2008-md-01977-00100', {native_case_id: 'azd-2:2008-md-01977', native_document_id: 'azd-2:2008-md-01977-00100', source_restricted: false, source_qualified_courtlistener_docket_ids: ['4132492']},
    {record_sha256: 'r', source_capture_file_uri: 'file:///C:/x/docketbird/portfolio-backfill-v1/a.json', source_capture_file_sha256: 'f', source_original_document_sha256: 'o', canonical_locator_sha256: 'secret-ish', firm_scope_evidence: [{x: 1}]});
  await ins('docketbird-mcp', 'document_metadata', 'azd-2:2008-md-01977-00101', {native_case_id: 'azd-2:2008-md-01977', native_document_id: 'azd-2:2008-md-01977-00101', source_restricted: false, source_qualified_courtlistener_docket_ids: ['4132492', '9']});
  await ins('courtlistener', 'dockets', '4132492', {court_id: 'azd', docket_number: '2:08-md-01977', case_name: 'In re LifeLock', blocked: false, contact: 'x'});
  await d.exec(sql);
  return d;
}
const call = async (d, kind, cases = null, after = null, limit = 500) => (await d.query('select public.corpus_sw_docketbird_read_v1($1, $2, $3, $4) as r', [kind, cases, after, limit])).rows[0].r;

test('rest kinds page by native id, filter by case, skip quarantined rows and return only the projected provenance fields', {timeout: 120000, skip}, async () => {
  const d = await db();
  const cases = await call(d, 'rest-cases');
  assert.equal(cases.rows.length, 1); assert.deepEqual(Object.keys(cases.rows[0].provenance).sort(), ['record_sha256', 'retrieved_at', 'source_sha256', 'source_tool']);
  const all = await call(d, 'rest-documents');
  assert.deepEqual(all.rows.map(r => r.native_id), ['azd-2:2023-md-03081-00001', 'azd-2:2023-md-03081-00002', 'azd-2:2023-md-03081-00003', 'njd-2:2024-md-03113-00001']);
  const one = await call(d, 'rest-documents', ['njd-2:2024-md-03113']);
  assert.deepEqual(one.rows.map(r => r.native_id), ['njd-2:2024-md-03113-00001']);
  const p1 = await call(d, 'rest-documents', null, null, 2);
  assert.equal(p1.rows.length, 2); assert.equal(p1.next, 'azd-2:2023-md-03081-00002');
  const p2 = await call(d, 'rest-documents', null, p1.next, 2);
  assert.deepEqual(p2.rows.map(r => r.native_id), ['azd-2:2023-md-03081-00003', 'njd-2:2024-md-03113-00001']);
  const p3 = await call(d, 'rest-documents', null, p2.next, 2);
  assert.equal(p3.rows.length, 0); assert.equal(p3.next, null);
  await d.close();
});

test('mcp kind attaches the lake CourtListener docket only for a single qualified id, and never returns locator or firm evidence fields', {timeout: 120000, skip}, async () => {
  const d = await db();
  const r = await call(d, 'mcp-documents');
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0].cl_docket, {id: '4132492', court_id: 'azd', docket_number: '2:08-md-01977', case_name: 'In re LifeLock'});
  assert.equal(r.rows[1].cl_docket, null);
  assert.equal(r.rows[0].provenance.source_capture_file_sha256, 'f');
  assert.doesNotMatch(JSON.stringify(r), /canonical_locator|firm_scope_evidence|secret-ish|contact/);
  await assert.rejects(call(d, 'other'), /unsupported kind/);
  await d.close();
});

test('execute is granted to service_role only, and the rollback drops the function', {timeout: 120000, skip}, async () => {
  const d = await db();
  const g = await d.query(`select has_function_privilege('anon', 'public.corpus_sw_docketbird_read_v1(text, text[], text, integer)', 'execute') a, has_function_privilege('authenticated', 'public.corpus_sw_docketbird_read_v1(text, text[], text, integer)', 'execute') b, has_function_privilege('service_role', 'public.corpus_sw_docketbird_read_v1(text, text[], text, integer)', 'execute') c`);
  assert.deepEqual(g.rows[0], {a: false, b: false, c: true});
  await d.exec(rollback);
  const left = await d.query(`select count(*)::int n from pg_proc where proname = 'corpus_sw_docketbird_read_v1'`);
  assert.equal(left.rows[0].n, 0);
  await d.close();
});
