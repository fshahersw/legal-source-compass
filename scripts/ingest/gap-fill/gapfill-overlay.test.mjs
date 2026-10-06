import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {indexEvidence, overlayRecords} from './gapfill-overlay.mjs';
import {sameJson, ARCHIVE_SHA} from './project-registry.mjs';

const bulk = (docket_id, regs, over = {}) => ({native_id: docket_id, data: {docket_id, registry_dockets: regs, date_filed: '2018-04-02', date_terminated: '2018-08-02', key_unique_in_bulk: true, blocked: false, source_row_ordinal: 5150, pacer_case_id: '370744', ...over}});

/** What members-project builds from the registry bundle: the latest IDB row date as `filed`. */
const rebuiltReopen = () => ({dataset: 'sw_matter_dockets_v1', id: 'sw-md:2789:njd:2:2018-cv-05195',
  item: {cells: {filed: '2019-03-07', terminated: '2018-08-02', status: 'header_terminated', docket_number: '2:18-cv-05195'}, subtitle: 'MDL 2789 · filed 2019-03-07', links: []},
  detail: {facts: [['Filed', '2019-03-07'], ['Docket header termination date', '2018-08-02'], ['Provider case ids', '']], links: [], provenance: {run_ids: ['r']},
    registry: {native_case_ids: [], evidence: [{kind: 'fjc_idb_mdl_number', locator: {idb_id: '24565390', origin: '13', date_filed: '2018-04-02'}}, {kind: 'fjc_idb_mdl_number', locator: {idb_id: '25817265', origin: '4', date_filed: '2019-03-07'}}]}},
  filters: {year: '2019', status: 'header_terminated', native_case_id: []}});
const rebuiltBlank = () => ({dataset: 'sw_matter_dockets_v1', id: 'sw-md:2323:cacd:2:2011-cv-08394',
  item: {cells: {filed: 'Not recorded', terminated: 'Not recorded', status: 'no_termination_date_recorded', docket_number: '2:11-08394'}, subtitle: 'MDL 2323 · filed not recorded', links: []},
  detail: {facts: [['Filed', 'Not recorded'], ['Docket header termination date', 'Not recorded'], ['Provider case ids', '']], links: [], provenance: {run_ids: ['r']}, registry: {native_case_ids: [], evidence: []}},
  filters: {year: '2011', status: 'no_termination_date_recorded', native_case_id: []}});

const evidence = () => indexEvidence([
  bulk('6655855', ['sw-md:2789:njd:2:2018-cv-05195']),
  bulk('8272189', ['sw-md:2323:cacd:2:2011-cv-08394'], {date_filed: '2011-10-11', date_terminated: '2012-02-07', source_row_ordinal: 14442769, pacer_case_id: '514383'})]);

test('a re-projection reproduces corrected dates, the displaced reopen date and source provenance', () => {
  const out = overlayRecords([rebuiltReopen()], evidence(), 't');
  const r = out.records[0];
  assert.equal(out.changed, 1);
  assert.equal(r.item.cells.filed, '2018-04-02'); assert.equal(r.filters.year, '2018');
  assert.match(r.item.cells.reopened_or_reinstated, /2019-03-07 \(FJC IDB origin 4\)/);
  assert.equal(r.detail.registry.reopened_or_reinstated[0].date, '2019-03-07');
  assert.deepEqual(r.filters.native_case_id, ['6655855']);
  const gf = r.detail.provenance.gapfill; assert.ok(gf.length >= 2);
  assert.ok(gf.every(x => x.archive_sha256 === ARCHIVE_SHA && x.source_row_ordinal === 5150));
});

test('a re-projection reproduces blank fills with their sources', () => {
  const r = overlayRecords([rebuiltBlank()], evidence(), 't').records[0];
  assert.equal(r.item.cells.filed, '2011-10-11'); assert.equal(r.item.cells.terminated, '2012-02-07'); assert.equal(r.item.cells.status, 'header_terminated');
  assert.deepEqual(r.filters.native_case_id, ['8272189']);
  assert.ok(r.detail.facts.some(f => f[0] === 'Filed — source' && /source row 14442769/.test(f[1])));
});

test('overlay is idempotent: applying it to an already corrected record changes nothing, and two rebuilds are identical', () => {
  const once = overlayRecords([rebuiltReopen(), rebuiltBlank()], evidence(), 't');
  const twice = overlayRecords(once.records, evidence(), 't');
  assert.equal(twice.changed, 0);
  assert.ok(sameJson(twice.records, once.records));
  const again = overlayRecords([rebuiltReopen(), rebuiltBlank()], evidence(), 't');
  assert.ok(sameJson(again.records, once.records));
});

test('ambiguous or blocked bulk rows never change a record; a failing rule holds the conflict', () => {
  const amb = indexEvidence([bulk('6655855', ['sw-md:2789:njd:2:2018-cv-05195'], {key_unique_in_bulk: false})]);
  assert.equal(overlayRecords([rebuiltReopen()], amb, 't').changed, 0);
  const blocked = indexEvidence([bulk('6655855', ['sw-md:2789:njd:2:2018-cv-05195'], {blocked: true})]);
  assert.equal(overlayRecords([rebuiltReopen()], blocked, 't').changed, 0);
  const disagree = indexEvidence([bulk('6655855', ['sw-md:2789:njd:2:2018-cv-05195'], {date_filed: '2018-04-03'})]);
  const r = overlayRecords([rebuiltReopen()], disagree, 't');
  assert.equal(r.records[0].item.cells.filed, '2019-03-07'); assert.ok(r.held >= 1);
});

test('FJC MDL numbers are re-applied to cl_docket_metadata rebuilds with the historical label', () => {
  const idx = indexEvidence([], [{data: {idb_data_id: '22251429', docket_id: '12545722', mdl_number_raw: '1554', origin: '1'}}]);
  const rec = {dataset: 'cl_docket_metadata', id: 'cl:dockets:12545722', item: {cells: {mdl_number: null, idb_data_id: '22251429'}}, detail: {facts: []}, filters: {}};
  const r = overlayRecords([rec], idx, 't').records[0];
  assert.equal(r.item.cells.mdl_number, '1554'); assert.match(r.item.cells.mdl_number_basis, /historical administrative association \(FJC IDB\)/);
});

test('members-project applies the overlay and refuses to run without the evidence', () => {
  const src = fs.readFileSync(new URL('../members-project.mjs', import.meta.url), 'utf8');
  assert.match(src, /overlayRecords\(docketRecords/);
  assert.match(src, /--gapfill-evidence=<dir> is required/);
});
