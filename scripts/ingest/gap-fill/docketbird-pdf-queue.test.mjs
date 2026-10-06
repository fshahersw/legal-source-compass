import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQueue} from './build-docketbird-pdf-queue.mjs';
import {validateQueueRow} from '../backfill-pdfs-to-supabase.mjs';
import {sha256} from './lib.mjs';

const signed = id => `https://docketbird-case-documents.s3.amazonaws.com/${encodeURIComponent(id)}.pdf?AWSAccessKeyId=K&Signature=S&Expires=${Math.floor(Date.now() / 1000) + 86400}`;
const doc = (n, extra = {}) => ({id: `x-1:2024-cv-00001-${n}`, title: 'Order', filing_date: '2024-01-01', restricted: false, primary_docket_sheet_number: 1, downloaded: 1, docketbird_document_url: signed(n), ...extra});
const body = {status: 'success', data: {case: {id: 'x-1:2024-cv-00001'}, documents: [doc(1), doc(2, {restricted: true}), doc(3, {downloaded: 0}), doc(4, {title: 'Motion to file under seal'}), doc(5), doc(6, {restricted: null}), doc(7, {docketbird_document_url: null})]}};
const raw = Buffer.from(JSON.stringify(body)), rawSha = sha256(raw);
const obs = [{source_url: 'https://api.docketbird.com/documents?case_id=x-1%3A2024-cv-00001', http_status: 200, retrieved_at: '2026-10-06T00:00:00Z', source_sha256: rawSha}];

test('only explicit restricted=false and downloaded=1 documents that are not already stored and carry no sealed wording are queued', () => {
  const {rows, stats} = buildQueue({observations: obs, rawBytes: () => raw, storedIds: new Set(['x-1:2024-cv-00001-5'])});
  assert.deepEqual(rows.map(r => r.native_document_id), ['x-1:2024-cv-00001-1']);
  assert.equal(stats.already_stored, 1); assert.equal(stats.restricted_or_unknown, 2); assert.equal(stats.not_downloaded, 1); assert.equal(stats.title_withheld, 1); assert.equal(stats.no_url, 1);
});

test('queue rows satisfy the existing transfer validator, bind the raw response and keep the signed URL out of provenance', () => {
  const {rows} = buildQueue({observations: obs, rawBytes: () => raw, storedIds: new Set()});
  assert.doesNotThrow(() => validateQueueRow(rows[0]));
  assert.equal(rows[0].origins[0].source_response_sha256, rawSha);
  assert.doesNotMatch(JSON.stringify({...rows[0], download_url: undefined}), /AWSAccessKeyId|Signature/);
});

test('an expired presigned URL is never queued', () => {
  const old = {...body, data: {...body.data, documents: [doc(9, {docketbird_document_url: 'https://docketbird-case-documents.s3.amazonaws.com/a.pdf?AWSAccessKeyId=K&Signature=S&Expires=1'})]}};
  const r = Buffer.from(JSON.stringify(old));
  const out = buildQueue({observations: [{...obs[0], source_sha256: sha256(r)}], rawBytes: () => r, storedIds: new Set()});
  assert.equal(out.rows.length, 0); assert.equal(out.stats.expired_url, 1);
});
