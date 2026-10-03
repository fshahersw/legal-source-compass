import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewEntryPrivacy } from './master-entry-privacy.mjs';
const open = { blocked: false, date_blocked: null };

test('blocked, missing and dated-blocked dockets are ineligible', () => {
  for (const docket of [undefined, { blocked: true }, { blocked: false, date_blocked: '2025-07-09' }])
    assert.equal(reviewEntryPrivacy({ recap_documents: [] }, docket).eligible, false);
});

test('an explicitly sealed document excludes the complete mixed entry', () => {
  const result = reviewEntryPrivacy({ recap_documents: [{ id: 1, is_sealed: false }, { id: 2, is_sealed: true }] }, open);
  assert.equal(result.eligible, false);
  assert.equal(result.explicitlySealed, true);
});

test('unknown seal flags preserve minimal entry metadata but never public document IDs', () => {
  const result = reviewEntryPrivacy({ description: 'private caption sentinel', recap_documents: [
    { id: 1, is_sealed: null }, { id: 2 }, { id: 3, is_sealed: 'false' },
    { id: 4, is_sealed: false }, { id: 4, is_sealed: false },
  ] }, open);
  assert.equal(result.eligible, true);
  assert.equal(result.unknownDocumentSeal, true);
  assert.deepEqual(result.explicitUnsealedIds, ['4']);
  assert.equal(JSON.stringify(result).includes('private caption sentinel'), false);
});

test('invalid document identities fail rather than inventing a public locator', () => {
  assert.throws(() => reviewEntryPrivacy({ recap_documents: [{ id: null, is_sealed: false }] }, open), /Invalid native document ID/);
});
