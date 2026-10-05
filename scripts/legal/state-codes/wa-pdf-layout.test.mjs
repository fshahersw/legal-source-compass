import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructPdfJsPage} from './wa-pdf-layout.mjs';

const item = (str, x, y, width) => ({str, transform: [1, 0, 0, 1, x, y], width});

test('inserts a word boundary where positioned text items have a visible gap', () => {
  assert.equal(reconstructPdfJsPage([item('4.16.005', 50, 675, 58), item('Commencement of actions.', 133, 675, 173)]), '4.16.005 Commencement of actions.');
});

test('reconstructs page reading order by baseline then horizontal position', () => {
  const rows = [item('second', 30, 600, 35), item('right', 130, 612, 22), item('left', 30, 612, 18)];
  assert.equal(reconstructPdfJsPage(rows), 'left right\nsecond');
});

test('preserves contiguous typographic punctuation without inventing spaces', () => {
  const rows = [item('years', 100, 500, 30), item('—', 130, 500, 12), item('Exception.', 142, 500, 54)];
  assert.equal(reconstructPdfJsPage(rows), 'years—Exception.');
});
