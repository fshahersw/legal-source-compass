import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEntryRecord} from '../members-entry-record.mjs';

const env = {run: 'r', SCHEMA: 's', DS_ENTRIES: 'sw_docket_entries_v1', finish: r => r, clDocketUrl: id => `https://www.courtlistener.com/docket/${id}/`,
  masterLink: c => `#record/sw_matter_dockets_v1/${c.mdl}`, matterLink: c => `#record/sw_matters_v1/${c.mdl}`};
const ctx = (extra = {}) => ({mdl: '2913', docket_key: 'cand:3:2019-md-02913', docket_number: '3:19-md-02913', court_id: 'cand', ...extra});
const row = (description, docs = [{id: 9, is_available: true, is_sealed: false, description: 'Order', absolute_url: '/docket/16284915/5/x/'}]) =>
  ({native_id: '100', payload_sha256: 'a'.repeat(64), retrieved_at: 't', data: {docket: 'https://www.courtlistener.com/api/rest/v4/dockets/16284915/', entry_number: 5, date_filed: '2020-01-02', description, recap_documents: docs}});

test('ordinary entry is published as the court record shows it', () => {
  const {rec, withheld} = makeEntryRecord(row('ORDER granting motion.'), ctx(), env);
  assert.equal(withheld, null); assert.equal(rec.item.cells.description, 'ORDER granting motion.'); assert.deepEqual(rec.item.cells.document_ids, ['9']);
  assert.equal(rec.id, 'sw-entry:courtlistener:100'); assert.equal(rec.filters.native_id, '100');
});

test('sealed or restricted text withholds the description and the documents', () => {
  const {rec, withheld} = makeEntryRecord(row('Motion to seal the exhibit'), ctx(), env);
  assert.equal(withheld, 'sealed_or_restricted_text'); assert.equal(rec.item.cells.description, null); assert.equal(rec.item.cells.held, true); assert.deepEqual(rec.item.cells.document_ids, []);
});

test('a description carrying a contact field is withheld, but the documents stay (live rule contact_or_access_data)', () => {
  const {rec, withheld} = makeEntryRecord(row('Transcript. Court Reporter: A B (215-779-6437).'), ctx(), env);
  assert.equal(withheld, 'contact_or_access_data'); assert.equal(rec.item.cells.description, null); assert.equal(rec.item.cells.held, false);
  assert.deepEqual(rec.item.cells.document_ids, ['9']); assert.equal(rec.filters.description_withheld, 'true');
  assert.ok(rec.detail.facts.some(f => f[0] === 'Description' && /contact or hearing access data/.test(f[1])));
  assert.ok(!rec.text.includes('215-779'));
});

test('a sealed document withholds the entry; a matter outside the registry gets no dead registry links', () => {
  assert.equal(makeEntryRecord(row('Order', [{id: 1, is_sealed: true}]), ctx(), env).withheld, 'sealed_document');
  const {rec} = makeEntryRecord(row('Order'), ctx({no_registry_links: true}), env);
  assert.deepEqual(rec.item.links.map(l => l.label), ['CourtListener entry']);
  assert.ok(makeEntryRecord(row('Order'), ctx(), env).rec.item.links.length === 3);
});
