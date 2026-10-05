import test from 'node:test';
import assert from 'node:assert/strict';
import { beforeImagePayload, mergeProjectionMetadata, mergeProjectionRows } from './members-projection-metadata.mjs';

const row = (id, mdl, availability, year = '2024') => ({ id, ordinal: id, filters: { mdl, availability, year } });
const record = (id, mdl, availability, year = '2025') => ({
  id,
  ordinal: id,
  filters: { mdl, availability, year },
  detail: { provenance: { projection_row_sha256: `hash-${id}` } },
});

test('partial MDL projection preserves global catalog size and facets while adding selected rows', () => {
  const existingRows = Array.from({ length: 50 }, (_, i) => row(`old-${i}`, i < 30 ? '3081' : 'other', i < 25 ? 'recap_available' : 'recap_unavailable', i < 40 ? '2024' : '2023'));
  const selected = [
    ...Array.from({ length: 18 }, (_, i) => record(`old-${i}`, '3081', i < 10 ? 'recap_available' : 'official_pdf')),
    record('new-a', '3081', 'official_pdf'),
    record('new-b', '3081', 'recap_available'),
  ];
  const after = mergeProjectionRows(existingRows, selected);
  assert.equal(after.size, 52);

  const existingMetadata = {
    source_runs: ['prior-run'],
    listing: { columns: [{ key: 'docket_number', label: 'Docket' }], filters: [
      { name: 'mdl', options: [{ value: 'other', label: 'Other MDLs', count: 20 }] },
      { name: 'availability', options: [{ value: 'recap_unavailable', label: 'No PDF', count: 25 }] },
      { name: 'year', options: [{ value: '2023', label: '2023', count: 10 }] },
    ] },
  };
  const projectedMetadata = {
    source_runs: ['run-2'],
    listing: { columns: [{ key: 'entry_number', label: 'Entry' }], filters: [
      { name: 'mdl', options: [{ value: '3081', label: 'MDL 3081', count: 20 }] },
      { name: 'availability', options: [{ value: 'official_pdf', label: 'Official PDF', count: 9 }] },
    ] },
  };
  const metadata = mergeProjectionMetadata(existingMetadata, projectedMetadata, after, { verified: true });
  const facet = name => Object.fromEntries(metadata.listing.filters.find(f => f.name === name).options.map(o => [o.value, o.count]));
  assert.deepEqual(facet('mdl'), { '3081': 32, other: 20 });
  assert.deepEqual(facet('availability'), { recap_available: 18, official_pdf: 9, recap_unavailable: 25 });
  assert.deepEqual(facet('year'), { '2024': 22, '2023': 10, '2025': 20 });
  assert.deepEqual(metadata.source_runs, ['prior-run', 'run-2']);
  assert.deepEqual(metadata.listing.columns.map(column => column.key), ['entry_number']);
});

test('before-image payload keeps complete existing source rows and stable order', () => {
  const payload = beforeImagePayload({ dataset: 'entries', run: 'run-1', capturedAt: '2026-10-05T00:00:00Z', rows: [{ id: 'b', filters: { mdl: 'x' } }, { id: 'a', detail: { raw: 'source' } }] });
  assert.equal(payload.schema_version, 'members-projection-before-images/1');
  assert.deepEqual(payload.changed_existing_rows.map(row => row.id), ['a', 'b']);
  assert.equal(payload.changed_existing_rows[0].detail.raw, 'source');
});
