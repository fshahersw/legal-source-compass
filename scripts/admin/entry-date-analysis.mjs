/** Native date_filed is a calendar date; rollover and timestamp guesses are rejected. */
export function classifyEntryDate(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return { kind: 'missing' };
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return { kind: 'invalid' };
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return { kind: 'invalid' };
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > days) return { kind: 'invalid' };
  return { kind: 'dated', date: value, year };
}

export function aggregateEntryDates(values, capturedThroughDate) {
  const years = new Map(); let dated = 0, missing = 0, invalid = 0, afterCapture = 0;
  let first = null, last = null;
  for (const value of values) {
    const date = classifyEntryDate(value);
    if (date.kind === 'missing') { missing++; continue; }
    if (date.kind === 'invalid') { invalid++; continue; }
    dated++; years.set(date.year, (years.get(date.year) ?? 0) + 1);
    if (capturedThroughDate && date.date > capturedThroughDate) afterCapture++;
    if (first == null || date.date < first) first = date.date;
    if (last == null || date.date > last) last = date.date;
  }
  const filingYears = [...years].sort(([a], [b]) => a - b).map(([year, entries]) => ({ year, entries }));
  if (dated + missing + invalid !== values.length || filingYears.reduce((sum, row) => sum + row.entries, 0) !== dated) {
    throw Error('Filing-date denominator mismatch');
  }
  return { datedEntries: dated, missingDateEntries: missing, invalidDateEntries: invalid,
    afterCaptureDateEntries: afterCapture, filingRange: { first, last }, filingYears };
}
