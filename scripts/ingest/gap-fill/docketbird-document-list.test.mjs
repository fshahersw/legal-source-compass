import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalIntegerJson, sha256} from './lib.mjs';
import {parseDocumentListCsv, csvToDocument} from './docketbird-document-list.mjs';

test('parseDocumentListCsv reads entry, date, description, status, label, parties, filename', () => {
  const csv = `Document ID,Entry Number,Date,Description,Status,Label,Parties,Filename
paed-2:2012-md-02323-00001,1,2012-01-01,"Motion to seal",Downloaded,Motion,"Smith v. Acme",order.pdf
`;
  const rows = parseDocumentListCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].document_id, 'paed-2:2012-md-02323-00001');
  assert.equal(rows[0].entry_number, 1);
  assert.equal(rows[0].label, 'Motion');
  assert.equal(rows[0].filename, 'order.pdf');
});

test('inventory staging keeps record_sha256 aligned after inventory_record_sha256', () => {
  const caseId = 'paed-2:2012-md-02323';
  const receipt = {source_url: 'https://api.docketbird.com/documents/search', retrieved_at: '2026-01-01T00:00:00.000Z', http_status: 200, source_sha256: 'a'.repeat(64)};
  const row = {document_id: `${caseId}-00001`, entry_number: 1, filing_date: '2012-01-01', description: 'Motion', status: 'search_index', label: '', parties: '', filename: ''};
  const ingest = csvToDocument(caseId, row, receipt, 'search_enumeration_fallback');
  ingest.data.inventory_record_sha256 = sha256(canonicalIntegerJson(ingest.data));
  ingest.provenance.record_sha256 = sha256(canonicalIntegerJson(ingest.data));
  assert.equal(ingest.provenance.record_sha256, sha256(canonicalIntegerJson(ingest.data)));
});
