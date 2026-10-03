import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateEntryDates, classifyEntryDate } from './entry-date-analysis.mjs';

test('invalid native dates cannot roll into another filing month or year', () => {
  for (const value of ['2023-02-29', '2024-02-30', '1900-02-29', '2024-13-01', '2024-00-10',
    '2024-01-00', '0000-01-01', '2024-01-01T00:00:00Z', '01/02/2024', 2024]) {
    assert.equal(classifyEntryDate(value).kind, 'invalid');
  }
  assert.deepEqual(classifyEntryDate('2024-02-29'), { kind: 'dated', date: '2024-02-29', year: 2024 });
  assert.equal(classifyEntryDate('2000-02-29').kind, 'dated');
});

test('missing and nonparseable dates retain their own denominators', () => {
  const result = aggregateEntryDates([null, '', ' ', 'not dated', '2024-02-29', '2023-12-31', '2027-01-01'], '2026-10-02');
  assert.equal(result.missingDateEntries, 3);
  assert.equal(result.invalidDateEntries, 1);
  assert.equal(result.datedEntries, 3);
  assert.equal(result.afterCaptureDateEntries, 1);
  assert.deepEqual(result.filingRange, { first: '2023-12-31', last: '2027-01-01' });
  assert.deepEqual(result.filingYears, [{ year: 2023, entries: 1 }, { year: 2024, entries: 1 }, { year: 2027, entries: 1 }]);
});

test('empty eligible scopes never acquire an invented range', () => {
  assert.deepEqual(aggregateEntryDates([]).filingRange, { first: null, last: null });
});
