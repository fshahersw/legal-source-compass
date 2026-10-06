import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRows, crosswalkFromMdls, availabilityOf, datasetMetadata, DS} from './project-docketbird-documents.mjs';

const docRow = (n, extra = {}, caseId = 'njd-2:2024-md-03113') => ({native_id: `${caseId}-${n}`, data: {id: `${caseId}-${n}`, case_id: caseId, title: 'Letter from counsel', filing_date: '2024-06-20', restricted: false, docket_sheet_number: Number(n.slice(0, 5)) || 1,
  pacer_document_url: 'https://ecf.njd.uscourts.gov/doc1/1', court_document_url: 'https://ecf.njd.uscourts.gov/doc1/1', downloaded_by_provider: true, docketbird_object_name: `${caseId}-${n}.pdf`, ...extra}, provenance: {record_sha256: 'a'.repeat(64), source_sha256: 'b'.repeat(64), retrieved_at: 't'}});
const caseRows = [{native_id: 'njd-2:2024-md-03113', data: {id: 'njd-2:2024-md-03113', title: 'Apple Inc. Smartphone Antitrust Litigation', court_id: 'njd'}}];
const crosswalk = crosswalkFromMdls([{id: '3113', item: {mdl_number: 3113, cl_court_id: 'njd', master_docket: '2:24-md-3113', cl_docket_id: 68869775}}]);
const run = (docs, registry = {}) => buildRows({caseRows, docRows: docs, registry, crosswalk, matterIds: new Set(['3113']), partyCounts: new Map([['3113', 10]]), projectedAt: 't'});

test('the exact master docket key gives the CourtListener docket id and MDL label; nothing else does', () => {
  assert.equal(crosswalk.get('njd:2:2024-md-03113').cl_docket_id, '68869775');
  assert.equal(crosswalk.get('njd:2:2024-md-03113').mdl, '3113');
  const r = buildRows({caseRows: [{native_id: 'jpml-0:2024-md-03113', data: {title: 'x', court_id: 'jpml'}}], docRows: [docRow('00001', {}, 'jpml-0:2024-md-03113')], registry: {}, crosswalk, matterIds: new Set(), partyCounts: new Map(), projectedAt: 't'});
  assert.equal(r.rows[0].item.cells.native_docket_id, null); assert.equal(r.rows[0].item.cells.mdl, null);
});

test('stored documents carry sha256 and size from the registry; label stays not recorded', () => {
  const {rows} = run([docRow('00001')], {'njd-2:2024-md-03113': [{native_document_id: 'njd-2:2024-md-03113-00001', sha256: 'c'.repeat(64), bytes: 1234, availability: 'open'}]});
  const c = rows[0].item.cells;
  assert.equal(rows[0].dataset, DS); assert.equal(c.availability, 'stored'); assert.equal(c.sha256, 'c'.repeat(64)); assert.equal(c.bytes, 1234); assert.equal(c.label, null);
  assert.equal(c.file_name, 'njd-2:2024-md-03113-00001.pdf'); assert.equal(c.native_docket_id, '68869775'); assert.equal(c.mdl, '3113');
  assert.equal(rows[0].detail.provenance.source_record_sha256, 'a'.repeat(64)); assert.ok(rows[0].detail.provenance.projection_row_sha256);
  assert.ok(rows[0].detail.facts.some(f => f[0] === 'Parties of the matter in the registry'));
});

test('restricted, unknown-seal and sealed-wording documents get no row, only a count', () => {
  const docs = [docRow('00001'), docRow('00002', {restricted: true}), docRow('00003', {restricted: null}), docRow('00004', {title: 'Motion to seal exhibit'}), docRow('00005', {title: 'Ex parte application'}), docRow('00006', {title: 'REDACTED complaint'})];
  const {rows, stats} = run(docs);
  assert.deepEqual(rows.map(r => r.item.cells.native_document_id), ['njd-2:2024-md-03113-00001']);
  assert.equal(stats.withheld_no_row, 5); assert.equal(stats.withheld_restricted_or_unknown, 2); assert.equal(stats.withheld_sealed_wording, 3);
  assert.doesNotMatch(JSON.stringify(rows.map(r => [r.title, r.text, r.item.cells, r.detail.facts])), /seal|redact|ex parte/i);
});

test('availability: stored, provider-not-downloaded, held by the registry', () => {
  assert.equal(availabilityOf({stored: true, downloaded: true}), 'stored');
  assert.equal(availabilityOf({stored: false, downloaded: false}), 'provider_not_downloaded');
  assert.equal(availabilityOf({stored: false, downloaded: true, registryAvailability: 'held'}), 'held_by_registry');
});

test('a description with a contact field is withheld, and the metadata lists filters and withheld counts', () => {
  const {rows, stats} = run([docRow('00001', {title: 'Transcript, reporter (215-779-6437)'}), docRow('00002')]);
  assert.equal(rows[0].item.cells.description, null); assert.equal(rows[0].item.cells.description_withheld, 'contact_or_access_data'); assert.doesNotMatch(rows[0].text, /215-779/);
  const meta = datasetMetadata(rows, stats);
  assert.deepEqual(meta.listing.filters.map(f => f.name), ['case_id', 'mdl', 'year', 'availability']); assert.equal(meta.withheld_counts.not_projected, 0);
});
