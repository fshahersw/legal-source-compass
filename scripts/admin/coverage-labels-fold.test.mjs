// Static checks for database/contracts/coverage-labels-fold-v1{,.rollback,.dryrun}.sql.
// The live round trip (forward then rollback restores detail, item and filters on all 10,009 rows) was rehearsed as
// a read-only SELECT on 2026-10-27; these checks keep the three files from drifting apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (name) => fs.readFile(new URL(`../../database/contracts/${name}`, import.meta.url), 'utf8');
const strip = (sql) => sql.replace(/--[^\n]*/g, '');
const norm = (block) => strip(block).replace(/\s+/g, ' ').replace(/[\s,]+$/, '').trim();
const projections = (sql) =>
  [...sql.matchAll(/-- BEGIN PROJECTION[^\n]*\n([\s\S]*?)-- END PROJECTION/g)].map((m) => norm(m[1]));

const ADDED_LABEL_KEYS = [
  'law_body_class_confidence', 'law_body_class_basis', 'law_body_class_detail',
  'rule_set_detail', 'rule_set_basis', 'label_overlay',
];

test('the projection is identical in the contract (pre-check and update) and the dry run', async () => {
  const fwd = projections(await read('coverage-labels-fold-v1.sql'));
  const dry = projections(await read('coverage-labels-fold-v1.dryrun.sql'));
  assert.equal(fwd.length, 2);
  assert.equal(dry.length, 1);
  assert.equal(fwd[0], fwd[1]);
  assert.equal(fwd[0], dry[0]);
});

test('the contract never publishes the overlay rows and never deletes or inserts', async () => {
  const sql = strip(await read('coverage-labels-fold-v1.sql'));
  assert.doesNotMatch(sql, /ready\s*=\s*true/i);
  assert.doesNotMatch(sql, /\b(delete\s+from|insert\s+into|truncate|drop\s+(table|function|view))\b/i);
  assert.match(sql, /where id = 'coverage_labels' and ready = false/);
  assert.match(sql, /^\s*begin;/m);
  assert.match(sql, /^\s*commit;/m);
});

test('the verify query only reads and pins the before/after counts', async () => {
  const sql = strip(await read('coverage-labels-fold-v1-verify.sql'));
  assert.doesNotMatch(sql, /\b(update\s+public|insert\s+into|delete\s+from|truncate|alter\s|create\s|drop\s)/i);
  assert.match(sql, /f\.folded = 10009 and f\.folded_as_of = 1420/);
});

test('the dry run only reads', async () => {
  const sql = strip(await read('coverage-labels-fold-v1.dryrun.sql'));
  assert.doesNotMatch(sql, /\b(update\s+public|insert\s+into|delete\s+from|truncate|alter\s|create\s|drop\s)/i);
});

test('the guards pin the dry-run counts', async () => {
  const sql = await read('coverage-labels-fold-v1.sql');
  for (const n of ['10013', '10009', '1420']) assert.ok(sql.includes(n), `missing guard ${n}`);
  assert.match(sql, /already folded/);
  assert.match(sql, /e24f575c2076e2c674ae399a030f181bac32fd5f7f71bdfe1a3b215416f77daa/);
  assert.match(sql, /not found in the published text/);
});

test('the rollback removes exactly the label keys the contract adds', async () => {
  const fwd = strip(await read('coverage-labels-fold-v1.sql'));
  const back = strip(await read('coverage-labels-fold-v1.rollback.sql'));
  for (const k of ADDED_LABEL_KEYS) assert.ok(fwd.includes(`'${k}'`), `contract does not add ${k}`);
  const arr = back.match(/- array\[([^\]]+)\]/);
  assert.ok(arr, 'rollback key array missing');
  const removed = [...arr[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(removed, [...ADDED_LABEL_KEYS].sort());
});

test('the rollback resets every as-of slot and filter key the contract sets', async () => {
  const fwd = strip(await read('coverage-labels-fold-v1.sql'));
  const back = strip(await read('coverage-labels-fold-v1.rollback.sql'));
  const set = fwd.match(/jsonb_build_object\('source_as_of', n\.as_of, 'source_lo', n\.as_of, 'source_hi', n\.as_of\)/);
  assert.ok(set, 'contract filter keys changed');
  assert.ok(back.includes(`'{"source_as_of":null,"source_lo":null,"source_hi":null}'`));
  assert.ok(back.includes(`'{dates,source_as_of}', '{"basis":null,"value":null}'`));
  assert.ok(back.includes(`'{source_as_of}', 'null'::jsonb`));
  assert.ok(fwd.includes(`'source_as_of_basis', n.as_of_basis`));
  assert.ok(back.includes(`- 'source_as_of_basis'`));
  assert.ok(back.includes(`'{"source_as_of_field":null}'`));
});

test('the rollback restores the catalog row as it was before the contract', async () => {
  const fwd = strip(await read('coverage-labels-fold-v1.sql'));
  const back = strip(await read('coverage-labels-fold-v1.rollback.sql'));
  assert.match(fwd, /'qualification',/);
  assert.match(fwd, /'publication', jsonb_build_object/);
  assert.match(back, /metadata - 'qualification' - 'publication'/);
  assert.match(back, /label = 'Coverage labels'/);
  assert.match(back, /updated_at = '2026-10-03 11:03:14\.007374\+00'/);
});
