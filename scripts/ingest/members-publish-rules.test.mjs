import test from 'node:test';
import assert from 'node:assert/strict';
import {partyNameHold, partyNoteShown, counselNameShown, firmFromLines, ROLE_SEALED, ATTORNEY_ROLE} from './members-publish-rules.mjs';

test('2026-10-27: party names with sealing words are shown as the court record publishes them', () => {
  // The three names the earlier keyword rule withheld on the live dataset (lake, 2026-10-27).
  for (const name of ['SEALED CONSOLIDATED 2703(D) APPLICATION', 'Clemishia Seals', 'Royal Adhesives and Sealants LLC', 'Sealed Air Corporation', 'In camera review panel', 'Ex parte movant']) assert.equal(partyNameHold(name), null, name);
});

test('a contact field still withholds a party name or note; an empty name is not recorded', () => {
  assert.equal(partyNameHold('John Roe (215) 779-6437'), 'contact_or_access_data');
  assert.equal(partyNameHold('jroe@example.com'), 'contact_or_access_data');
  assert.equal(partyNameHold('   '), 'not_recorded');
  assert.equal(partyNoteShown('TERMINATED: 01/02/2024 | filed under seal'), true);
  assert.equal(partyNoteShown('call 215-779-6437'), false);
  assert.equal(partyNoteShown(''), false);
});

test('counsel: sealing words in a name are shown; contact fields are not; the court-record "Attorney in sealed group" role stays the omission flag', () => {
  assert.equal(counselNameShown('Mary Sealey'), true);
  assert.equal(counselNameShown('mary@firm.com'), false);
  assert.equal(counselNameShown(''), false);
  assert.equal(ATTORNEY_ROLE[ROLE_SEALED], 'Attorney in sealed group');
  assert.equal(firmFromLines('Mary Sealey', ['Sealey & Partners LLP', '1 Main Street']), 'Sealey & Partners LLP');
  assert.equal(firmFromLines('Mary Sealey', ['123 Main Street, Suite 4']), null);
});
