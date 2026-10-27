// Offline tests for fetch_mdl_dockets.mjs helpers (no network). Run: node --test scripts/enrichment/judge_xwalk/fetch_mdl_dockets.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { docketCore, personId, resultRow } from './fetch_mdl_dockets.mjs';

test('docket_number_core is two-digit year plus five-digit sequence', () => {
  assert.equal(docketCore('2:04-cv-5184'), '0405184');
  assert.equal(docketCore('3:20-mn-2972'), '2002972');
  assert.equal(docketCore('not a docket'), null);
});

test('person id comes only from a CourtListener people URL', () => {
  assert.equal(personId('https://www.courtlistener.com/api/rest/v4/people/2955/'), '2955');
  assert.equal(personId(null), null);
  assert.equal(personId('https://example.com/people/1/'), null);
});

test('a header matches only when court and normalized docket number equal the master docket', () => {
  const prov = { source_url: 'https://www.courtlistener.com/api/rest/v4/dockets/1/', retrieved_at: '2026-10-27T00:00:00Z', source_sha256: 'a'.repeat(64) };
  const target = { mdl: '1663', court: 'njd', master_docket: '2:04-cv-5184' };
  const ok = resultRow(target, { id: 1, court_id: 'njd', docket_number: '2:04-cv-05184-CCC', assigned_to: 'https://www.courtlistener.com/api/rest/v4/people/576/', assigned_to_str: 'Claire C. Cecchi' }, prov, 'x');
  assert.equal(ok.identity_matches, true);
  assert.equal(ok.assigned_to, '576');
  const otherOffice = resultRow(target, { id: 2, court_id: 'njd', docket_number: '3:04-cv-05184' }, prov, 'x');
  assert.equal(otherOffice.identity_matches, false);
  const otherCourt = resultRow(target, { id: 3, court_id: 'nysd', docket_number: '2:04-cv-05184' }, prov, 'x');
  assert.equal(otherCourt.identity_matches, false);
});
