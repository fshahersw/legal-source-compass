import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMasterEntryFacets } from './master-entry-facets.mjs';
import { reviewEntryPrivacy } from './master-entry-privacy.mjs';

test('facet frequencies and weighted association sum reconcile independently', () => {
  const result = buildMasterEntryFacets([
    { nativeEntryId: '1', nativeDocketId: '20', sourceUnsealedDocumentCount: 0 },
    { nativeEntryId: '2', nativeDocketId: '20', sourceUnsealedDocumentCount: 1 },
    { nativeEntryId: '3', nativeDocketId: '10', sourceUnsealedDocumentCount: 2 },
  ]);
  assert.equal(result.eligibleEntries, 3);
  assert.equal(result.unsealedDocumentAssociations, 3);
  assert.deepEqual(result.filters[0].options.map(({ value, count }) => [value, count]), [['10', 1], ['20', 2]]);
  assert.deepEqual(result.filters[1].options.map(({ value, count }) => [value, count]), [['0', 1], ['1', 1], ['2', 1]]);
});

test('zero explicitly unsealed documents preserves an eligible row with unknown flags', () => {
  const privacy = reviewEntryPrivacy({ recap_documents: [{ id: 9, is_sealed: null }] }, { blocked: false });
  assert.equal(privacy.eligible, true);
  const result = buildMasterEntryFacets([{ nativeEntryId: '1', nativeDocketId: '2',
    sourceUnsealedDocumentCount: privacy.explicitUnsealedIds.length }]);
  assert.equal(result.filters[1].options[0].value, '0');
  assert.equal(result.unsealedDocumentAssociations, 0);
});

test('duplicate native IDs and invalid association counts cannot inflate facets', () => {
  const entry = { nativeEntryId: '1', nativeDocketId: '2', sourceUnsealedDocumentCount: 1 };
  assert.throws(() => buildMasterEntryFacets([entry, entry]), /Duplicate/);
  assert.throws(() => buildMasterEntryFacets([{ ...entry, sourceUnsealedDocumentCount: -1 }]), /Invalid/);
  assert.throws(() => buildMasterEntryFacets([{ ...entry, nativeDocketId: 'case name' }]), /Invalid/);
});
