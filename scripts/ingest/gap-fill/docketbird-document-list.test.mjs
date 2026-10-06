import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDocumentListCsv} from './docketbird-document-list.mjs';

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
