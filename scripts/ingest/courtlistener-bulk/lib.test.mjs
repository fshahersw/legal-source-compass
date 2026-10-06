import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {isQuarterEnd, newestQuarterlyArchive, multipartEtag, verifyDownload, runIdFor} from './lib.mjs';

test('quarter ends are the last day of March, June, September and December', () => {
  assert.ok(isQuarterEnd('2026-09-30') && isQuarterEnd('2026-12-31') && isQuarterEnd('2027-03-31') && isQuarterEnd('2027-06-30'));
  assert.ok(!isQuarterEnd('2025-10-09') && !isQuarterEnd('2026-09-29') && !isQuarterEnd('2026-10-31') && !isQuarterEnd('nope'));
});

const xml = ['dockets-2026-06-30', 'dockets-2026-09-30', 'dockets-2026-10-09'].map((n, i) => `<Contents><Key>bulk-data/${n}.csv.bz2</Key><LastModified>x</LastModified><ETag>&quot;ac69e7b2bf485c3605f6fc10159ba130-614&quot;</ETag><Size>${1000 + i}</Size></Contents>`).join('');
test('the newest QUARTERLY archive is chosen, ignoring off-cycle files', () => {
  const a = newestQuarterlyArchive(xml);
  assert.equal(a.date, '2026-09-30'); assert.equal(a.key, 'bulk-data/dockets-2026-09-30.csv.bz2'); assert.equal(a.etag, 'ac69e7b2bf485c3605f6fc10159ba130-614');
  assert.equal(newestQuarterlyArchive('<x/>'), null);
});

test('multipart ETag verification passes for the right bytes and fails loudly for altered ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etag-')); const f = path.join(dir, 'a.bin');
  const part = 5 * 1024 ** 2, data = crypto.randomBytes(part * 2 + 123);
  fs.writeFileSync(f, data);
  const digests = [0, 1, 2].map(i => crypto.createHash('md5').update(data.subarray(i * part, (i + 1) * part)).digest());
  const etag = `${crypto.createHash('md5').update(Buffer.concat(digests)).digest('hex')}-3`;
  assert.equal(await multipartEtag(f, 3), etag);
  assert.deepEqual(await verifyDownload(f, {size: data.length, etag}), {size: data.length, etag});
  data[10] ^= 1; fs.writeFileSync(f, data);
  await assert.rejects(verifyDownload(f, {size: data.length, etag}), /HASH_MISMATCH etag/);
  await assert.rejects(verifyDownload(f, {size: data.length + 1, etag}), /HASH_MISMATCH size/);
});

test('run ids are deterministic per snapshot date', () => {
  assert.equal(runIdFor('2026-12-31'), runIdFor('2026-12-31')); assert.notEqual(runIdFor('2026-12-31'), runIdFor('2027-03-31'));
  assert.match(runIdFor('2026-12-31'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('a requested date selects exactly that quarter-end archive', () => {
  assert.equal(newestQuarterlyArchive(xml, {date: '2026-06-30'}).date, '2026-06-30');
  assert.equal(newestQuarterlyArchive(xml, {date: '2026-10-09'}), null);
});
