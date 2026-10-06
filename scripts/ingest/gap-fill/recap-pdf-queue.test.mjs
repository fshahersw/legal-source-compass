import test from 'node:test';
import assert from 'node:assert/strict';
import {queueRow} from './build-recap-pdf-queue.mjs';
import {validateQueueRow} from '../backfill-pdfs-to-supabase.mjs';
import {classify, summarize} from './plan-recap-pdfs.mjs';

const prov = {payload_sha256: 'a'.repeat(64), source_sha256: 'b'.repeat(64), retrieved_at: '2026-10-03T00:00:00Z', source_url: 'https://www.courtlistener.com/api/rest/v4/docket-entries/?docket=1'};
const cand = (extra = {}) => ({native_document_id: '9', entry_id: '5', docket_id: '123', filepath_local: 'recap/gov.uscourts.ohnd.1/gov.uscourts.ohnd.1.5.0.pdf', sha1: 'c'.repeat(40), bytes: 1000, is_sealed: false, ...extra});

test('queue rows satisfy the existing transfer validator and cite the stored response hash', () => {
  const row = queueRow(cand(), prov);
  assert.doesNotThrow(() => validateQueueRow(row));
  assert.equal(row.download_url, 'https://storage.courtlistener.com/recap/gov.uscourts.ohnd.1/gov.uscourts.ohnd.1.5.0.pdf');
  assert.equal(row.origins[0].source_response_sha256, 'b'.repeat(64)); assert.deepEqual(row.provider_flags, {is_available: true, is_sealed: false});
});

test('unknown seal is queued only as is_sealed null (private quarantine); sealed and non-recap paths never are', () => {
  const row = queueRow(cand({is_sealed: null}), prov);
  assert.equal(row.provider_flags.is_sealed, null); assert.doesNotThrow(() => validateQueueRow(row));
  assert.throws(() => queueRow(cand({is_sealed: true}), prov), /SEALED/);
  assert.throws(() => queueRow(cand({filepath_local: 'other/x.pdf'}), prov), /RECAP_PATH/);
});

test('plan classification: free needs an explicit false seal flag and a storage path; PACER-only stays out', () => {
  assert.equal(classify({is_available: true, is_sealed: false, filepath_local: 'recap/a.pdf'}), 'free');
  assert.equal(classify({is_available: true, is_sealed: null, filepath_local: 'recap/a.pdf'}), 'available_unknown_seal');
  assert.equal(classify({is_available: true, is_sealed: true, filepath_local: 'recap/a.pdf'}), 'sealed');
  assert.equal(classify({is_available: false, is_sealed: false}), 'pacer_only');
  const rows = [{native_id: '1', data: {docket: 'https://x/api/rest/v4/dockets/7/', recap_documents: [
    {id: 1, is_available: true, is_sealed: false, filepath_local: 'recap/1.pdf', file_size: 100, sha1: 's1'}, {id: 2, is_available: true, is_sealed: false, filepath_local: 'recap/2.pdf', file_size: 50, sha1: 's2'},
    {id: 3, is_available: false}, {id: 4, is_available: true, is_sealed: null, filepath_local: 'recap/4.pdf', file_size: 10, sha1: 's4'}]}}];
  const {stats, todo} = summarize(rows, new Set(['1']), new Set(['s4']));
  assert.equal(stats.tier_free_explicit_not_sealed.already_stored_by_id, 1); assert.equal(stats.tier_free_explicit_not_sealed.to_download, 1);
  assert.equal(stats.tier_available_unknown_seal_private_quarantine.already_stored_by_sha1, 1); assert.equal(todo.length, 1); assert.equal(stats.by_class.pacer_only, 1);
});
