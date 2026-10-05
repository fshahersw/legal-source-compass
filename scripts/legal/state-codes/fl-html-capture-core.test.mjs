import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertFreshPrivateOutputDirectory,
  claimFreshPrivateOutputDirectory,
  capBytes,
  exactHttpSuccess,
  extractNativeTitleLinks,
  shouldStopAfterCapture,
  unattemptedPlanItems,
} from './fl-html-capture-core.mjs';

test('title discovery retains exact landing href text and resolves that href without reconstructing it', () => {
  const html = '<a href="index.cfm?App_mode=Display_Index&amp;Title_Request=VIII#TitleVIII">TITLE VIII</a>';
  assert.deepEqual(extractNativeTitleLinks(html, 'https://www.leg.state.fl.us/statutes/'), [{
    titleRoman: 'VIII', displayedRoman: 'VIII',
    rawHref: 'index.cfm?App_mode=Display_Index&amp;Title_Request=VIII#TitleVIII',
    resolvedUrl: 'https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Index&Title_Request=VIII#TitleVIII',
  }]);
  assert.equal(extractNativeTitleLinks(`${html}${html}`, 'https://www.leg.state.fl.us/statutes/').length, 1);
  assert.throws(() => extractNativeTitleLinks('<a href="https://evil.example/statutes/index.cfm?App_mode=Display_Index&amp;Title_Request=VIII">TITLE VIII</a>', 'https://www.leg.state.fl.us/statutes/'), /identity validation/);
  assert.throws(() => extractNativeTitleLinks(`${html}<a href="index.cfm?App_mode=Display_Index&amp;Title_Request=VIII#Other">TITLE VIII</a>`, 'https://www.leg.state.fl.us/statutes/'), /conflicting publisher hrefs/);
});

test('fresh output paths are confined to the real private tree and reject existing destinations', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fl-html-capture-'));
  const privateRoot = path.join(temp, 'private', 'florida');
  await fs.mkdir(privateRoot, { recursive: true });
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const fresh = path.join(privateRoot, 'new-run');
  assert.equal(await assertFreshPrivateOutputDirectory(fresh, privateRoot), fresh);
  assert.throws(() => assertFreshPrivateOutputDirectory(path.join(temp, 'outside'), privateRoot), /private Florida capture tree/);
  await fs.mkdir(fresh);
  await assert.rejects(assertFreshPrivateOutputDirectory(fresh, privateRoot), /already exists/);
});

test('fresh output destination is claimed by one atomic nonrecursive mkdir', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fl-html-claim-'));
  const privateRoot = path.join(temp, 'private', 'florida');
  await fs.mkdir(privateRoot, { recursive: true });
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const output = path.join(privateRoot, 'run-once');
  assert.equal(await claimFreshPrivateOutputDirectory(output, privateRoot), output);
  await assert.rejects(claimFreshPrivateOutputDirectory(output, privateRoot), /already exists/);
});

test('body and aggregate byte caps are enforced by a nonnegative remaining-byte limit', () => {
  assert.equal(capBytes(25, 100, 20), 25);
  assert.equal(capBytes(25, 100, 90), 10);
  assert.equal(capBytes(25, 100, 100), 0);
  assert.throws(() => capBytes(-1, 100, 0), /nonnegative/);
});

test('only HTTP 200 is accepted and all other status, transport, and cap outcomes stop the run', () => {
  assert.equal(exactHttpSuccess(200), true);
  for (const status of [201, 204, 301, 403, 429, 500, null]) {
    assert.equal(exactHttpSuccess(status), false, `status ${status}`);
    assert.equal(shouldStopAfterCapture({ status, transportError: null, capExceeded: false }), true, `stop ${status}`);
  }
  assert.equal(shouldStopAfterCapture({ status: 200, transportError: 'timeout', capExceeded: false }), true);
  assert.equal(shouldStopAfterCapture({ status: 200, transportError: null, capExceeded: true }), true);
  assert.equal(shouldStopAfterCapture({ status: 200, transportError: null, capExceeded: false }), false);
});

test('stop records every planned item without claiming it was fetched', () => {
  const plan = [{ id: 'landing', requestedUrl: '/statutes/' }, { id: 'title-I', requestedUrl: '/statutes/index.cfm?Title_Request=I' }, { id: 'title-II', requestedUrl: '/statutes/index.cfm?Title_Request=II' }];
  assert.deepEqual(unattemptedPlanItems(plan, new Set(['landing', 'title-I'])), [{ ...plan[2], status: 'not_attempted_after_stop', preStopStatus: null }]);
});
