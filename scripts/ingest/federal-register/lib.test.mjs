import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELDS, SCHEMA_VERSION, addDays, compareNewestFirst, eachDay, entityRow, pickFields, projectRecord, recordSha256, splitBounded,
} from './lib.mjs';

// Test-only documents: structure mirrors the API fields; the content is synthetic and never stored.
const doc = (over = {}) => ({
  document_number: 'T-1', title: 'Test title', type: 'Rule', publication_date: '2026-09-01', effective_on: null, dates: null,
  citation: '91 FR 100', html_url: 'https://www.federalregister.gov/documents/x', pdf_url: 'https://www.govinfo.gov/x.pdf',
  raw_text_url: 'https://www.federalregister.gov/documents/full_text/text/2026/09/01/T-1.txt',
  agencies: [{ id: 1, name: 'Agency A', raw_name: 'AGENCY A' }, { raw_name: 'Sub unit' }],
  cfr_references: [{ title: 5, part: '1', chapter: null }, { title: 5, part: '1', chapter: null }, { title: 6, part: null, chapter: 'II' }],
  related_documents: {}, correction_of: null, corrections: [], regulation_id_numbers: ['0000-AA00', '0000-AA01'], docket_ids: [],
  start_page: 100, end_page: 100, ...over,
});
const ctx = { id: '1006726', ordinal: -1, collected: '2026-10-06', coverage: { from: '1994-01-03', through: '2026-10-05' } };

test('days are inclusive and ISO validated', () => {
  assert.deepEqual([...eachDay('2026-08-30', '2026-09-01')], ['2026-08-30', '2026-08-31', '2026-09-01']);
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.throws(() => addDays('2026-8-31', 1));
});

test('entity rows keep a fixed field set and a canonical payload hash', () => {
  const row = entityRow({ ...doc(), extra: 'dropped' }, { url: 'https://www.federalregister.gov/api/v1/documents.json?x', sha256: 'a'.repeat(64), retrieved_at: '2026-10-06T00:00:00.000Z' }, '2026-10-06');
  assert.deepEqual(Object.keys(row.data), FIELDS);
  assert.equal(row.native_id, 'T-1');
  assert.equal(row.schema_version, SCHEMA_VERSION);
  assert.equal(row.provenance.record_sha256, recordSha256(pickFields(doc())));
  assert.throws(() => entityRow({ ...doc(), document_number: '' }, { url: 'u', sha256: 'a', retrieved_at: 't' }, '2026-10-06'));
});

test('projection follows the collection conventions', () => {
  const r = projectRecord(doc(), ctx);
  assert.equal(r.source_url, 'https://www.federalregister.gov/d/T-1');
  assert.equal(r.item.cells.cfr, '5 CFR 1, 6 CFR chapter II');
  assert.deepEqual(r.item.badges, ['Rule', 'RIN 0000-AA00']);
  assert.equal(r.item.subtitle, 'Agency A \u00b7 Sub unit');
  assert.deepEqual(r.filters.agency, ['1']);
  assert.deepEqual(r.filters.cfr_pair, ['5:1']);
  assert.equal(r.detail.facts.find((f) => f[0] === 'Citation')[1], '91 FR 100 (pages 100)');
  assert.equal(r.detail.links.filter((l) => l.label.startsWith('Other documents citing')).length, 1);
});

test('lists are capped like the existing rows and corrections are labelled', () => {
  const many = Array.from({ length: 30 }, (_, i) => `D-${i}`);
  const parts = Array.from({ length: 9 }, (_, i) => ({ title: 7, part: String(i), chapter: null }));
  const r = projectRecord(doc({ docket_ids: many, cfr_references: parts, title: 'x'.repeat(700), correction_of: 'https://example.invalid/c' }), ctx);
  assert.equal(r.detail.facts.find((f) => f[0].startsWith('Docket'))[1].split('; ').length, 12);
  assert.ok(r.item.cells.cfr.endsWith(' \u2026'));
  assert.equal(r.detail.links.filter((l) => l.label.startsWith('Other documents citing')).length, 6);
  assert.equal(r.title.length, 600);
  assert.ok(r.item.badges.includes('Correction'));
  assert.ok(r.detail.facts.some((f) => f[0] === 'Corrects document'));
});

test('ordering is publication date, first page, then document number, newest first', () => {
  const rows = [
    { document_number: 'A', publication_date: '2026-09-01', start_page: 5 },
    { document_number: 'B', publication_date: '2026-09-02', start_page: 1 },
    { document_number: 'C', publication_date: '2026-09-01', start_page: 5 },
    { document_number: 'D', publication_date: '2026-09-01', start_page: 9 },
  ];
  assert.deepEqual(rows.sort(compareNewestFirst).map((r) => r.document_number), ['B', 'D', 'C', 'A']);
});

test('bounded batches never exceed their limits', () => {
  const rows = Array.from({ length: 1201 }, (_, i) => ({ i, pad: 'x'.repeat(10) }));
  const groups = splitBounded(rows, 500);
  assert.deepEqual(groups.map((g) => g.length), [500, 500, 201]);
  assert.throws(() => splitBounded([{ pad: 'x'.repeat(100) }], 500, 50));
});
