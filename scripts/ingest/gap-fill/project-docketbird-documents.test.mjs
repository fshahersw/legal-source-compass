import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRows, crosswalkFromMdls, availabilityOf, datasetMetadata, DS, RULE, sourceHold, exactClDocket, mcpDocument, mergeDocuments, staleRows, verifiedTitle, sheetBody, documentOrdinal} from './project-docketbird-documents.mjs';
import {canon, sha256} from '../members-publish-rules.mjs';

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
  assert.equal(rows[0].detail.provenance.publication_rule, RULE);
  assert.ok(rows[0].detail.facts.some(f => f[0] === 'Parties of the matter in the registry'));
});

test('2026-10-27 rule: only a provider restriction holds a document; unknown seal and sealing words are published', () => {
  const docs = [docRow('00001'), docRow('00002', {restricted: true}), docRow('00003', {restricted: null}), docRow('00004', {title: 'Motion to seal exhibit'}), docRow('00005', {title: 'Ex parte application'}), docRow('00006', {title: 'REDACTED complaint'})];
  const {rows, stats} = run(docs);
  assert.deepEqual(rows.map(r => r.item.cells.native_document_id).sort(), ['00001', '00003', '00004', '00005', '00006'].map(n => `njd-2:2024-md-03113-${n}`));
  assert.equal(stats.withheld_no_row, 1); assert.equal(stats.held_source_restricted, 1); assert.equal(stats.published_unknown_seal, 1); assert.equal(stats.published_legacy_wording, 3);
  const unknown = rows.find(r => r.item.cells.native_document_id.endsWith('00003'));
  assert.equal(unknown.item.cells.restricted, null);
  assert.deepEqual(unknown.detail.facts.find(f => f[0] === 'Seal status'), ['Seal status', 'Not recorded by the provider']);
  assert.equal(rows.find(r => r.item.cells.native_document_id.endsWith('00004')).item.cells.description, 'Motion to seal exhibit');
  assert.equal(sourceHold({restricted: true}), true); assert.equal(sourceHold({restricted: null}), false); assert.equal(sourceHold({restricted: false}), false);
});

test('availability: stored, provider-not-downloaded, held by the registry', () => {
  assert.equal(availabilityOf({stored: true, downloaded: true}), 'stored');
  assert.equal(availabilityOf({stored: false, downloaded: false}), 'provider_not_downloaded');
  assert.equal(availabilityOf({stored: false, downloaded: true, registryAvailability: 'held'}), 'held_by_registry');
});

test('a description with a contact field is withheld (row kept), and the metadata merges prior cases and counts legacy holds apart', () => {
  const {rows, stats} = run([docRow('00001', {title: 'Transcript, reporter (215-779-6437)'}), docRow('00002'), docRow('00003', {restricted: true})]);
  assert.equal(rows[0].item.cells.description, null); assert.equal(rows[0].item.cells.description_withheld, 'contact_or_access_data'); assert.doesNotMatch(rows[0].text, /215-779/);
  const prior = {by_case: {'ilnd-1:2023-cv-00818': {sheet_documents: 2849, rows: 2783, withheld_no_row: 66}}};
  const meta = datasetMetadata([...rows.map(r => r.filters), {case_id: 'ilnd-1:2023-cv-00818', availability: 'stored'}], stats, prior);
  assert.deepEqual(meta.listing.filters.map(f => f.name), ['case_id', 'mdl', 'year', 'availability']);
  assert.deepEqual(meta.withheld_counts, {sheet_documents: 2852, not_projected: 67, source_restricted: 1, legacy_rule_not_projected: 66});
  assert.equal(meta.coverage.by_case['ilnd-1:2023-cv-00818'].rule, 'display-rule-2026-10-03');
  assert.equal(meta.coverage.by_case['njd-2:2024-md-03113'].rule, RULE);
  assert.deepEqual(meta.coverage.by_source, {'docketbird-rest': 3});
});

test('stale rows are only rows of the cases in this run', () => {
  const {rows} = run([docRow('00001')]);
  const remote = [{id: rows[0].id, filters: {case_id: 'njd-2:2024-md-03113'}}, {id: 'sw-doc:docketbird:njd-2:2024-md-03113-00009', filters: {case_id: 'njd-2:2024-md-03113'}}, {id: 'sw-doc:docketbird:ilnd-1:2023-cv-00818-00001', filters: {case_id: 'ilnd-1:2023-cv-00818'}}];
  assert.deepEqual(staleRows(remote, rows).map(r => r.id), ['sw-doc:docketbird:njd-2:2024-md-03113-00009']);
});

test('ordinals are a pure function of filing date and entry number', () => {
  assert.equal(documentOrdinal('2024-06-20', 5), documentOrdinal('2024-06-20', 5));
  assert.ok(documentOrdinal('2024-06-21', 1) > documentOrdinal('2024-06-20', 99));
  assert.ok(documentOrdinal(null, 1) > documentOrdinal('2099-01-01', 1));
});

// ---- DocketBird-MCP rows (lake document_metadata + verified capture titles) ----
const capDoc = {id: 'azd-2:2008-md-01977-00100', title: 'ORDER granting {{74}} Motion to Remand', filing_date: '2009-07-24', restricted: false, primary_docket_sheet_number: 100, downloaded: 1, canonical_url: 'https://www.docketbird.com/court_documents?id=x&user_id=1'};
const capture = {original_rpc_response: JSON.stringify({jsonrpc: '2.0', id: 1, result: {content: [{type: 'text', text: 'NOTE: this docket has 3 entries.\n' + JSON.stringify({documents: [capDoc]})}]}})};
const index = new Map([['f'.repeat(64), new Map(sheetBody(capture).documents.map(d => [d.id, d]))]]);
const mcpRaw = (extra = {}, prov = {}) => ({native_id: capDoc.id, payload_sha256: 'p', retrieved_at: 't', data: {native_case_id: 'azd-2:2008-md-01977', native_document_id: capDoc.id, source_filing_date: '2009-07-24', source_restricted: false, source_primary_docket_sheet_number: 100, source_provider_downloaded_indicator: 1, ...extra},
  provenance: {record_sha256: 'r'.repeat(64), source_sha256: 's'.repeat(64), retrieved_at: 't', source_capture_file_sha256: 'f'.repeat(64), source_original_document_sha256: sha256(canon(capDoc)), ...prov},
  cl_docket: {id: '4132492', court_id: 'azd', docket_number: '2:08-md-01977', case_name: 'In re LifeLock'}});

test('the capture parser skips a leading NOTE line', () => { assert.equal(sheetBody(capture).documents[0].id, capDoc.id); });

test('an MCP title is used only when the capture and document hashes match the lake', () => {
  assert.equal(verifiedTitle({source_capture_file_sha256: 'f'.repeat(64), native_document_id: capDoc.id, source_original_document_sha256: sha256(canon(capDoc))}, index).verified, true);
  assert.equal(verifiedTitle({source_capture_file_sha256: 'f'.repeat(64), native_document_id: capDoc.id, source_original_document_sha256: '0'.repeat(64)}, index).reason, 'document_hash_mismatch');
  assert.equal(verifiedTitle({source_capture_file_sha256: 'e'.repeat(64), native_document_id: capDoc.id}, index).reason, 'capture_not_available');
  const bad = mcpDocument(mcpRaw({}, {source_original_document_sha256: '0'.repeat(64)}), index);
  const {rows, stats} = buildRows({caseRows: [], docRows: [bad], registry: {}, crosswalk: new Map(), matterIds: new Set(), partyCounts: new Map(), projectedAt: 't'});
  assert.equal(rows[0].item.cells.description, null); assert.equal(stats.title_not_verified, 1);
  assert.deepEqual(rows[0].detail.facts.find(f => f[0] === 'Description'), ['Description', 'Not recorded (the source capture could not be verified)']);
});

test('an MCP row: title as published, CourtListener docket only on the same docket key, no personalized locator', () => {
  const d = mcpDocument(mcpRaw(), index);
  const {rows} = buildRows({caseRows: [], docRows: [d], registry: {}, crosswalk: new Map(), matterIds: new Set(), partyCounts: new Map(), projectedAt: 't'});
  const r = rows[0];
  assert.equal(r.item.cells.description, capDoc.title); assert.equal(r.item.cells.native_docket_id, '4132492'); assert.equal(r.item.cells.case_title, 'In re LifeLock');
  assert.equal(r.item.cells.entry_number, 100); assert.equal(r.item.cells.court_id, 'azd'); assert.equal(r.filters.source_system, 'docketbird-mcp');
  assert.equal(r.source_url, 'https://www.courtlistener.com/docket/4132492/');
  assert.doesNotMatch(JSON.stringify(r), /user_id|docketbird\.com\/court_documents/);
  assert.equal(exactClDocket('azd-2:2008-md-01977', {id: '1', court_id: 'azd', docket_number: '2:08-md-01978'}), null);
  assert.equal(exactClDocket('azd-2:2008-md-01977', {id: '1', court_id: 'nvd', docket_number: '2:08-md-01977'}), null);
});

test('a restriction from the lake or from the capture holds an MCP document; REST wins a merge but keeps either restriction', () => {
  assert.equal(mcpDocument(mcpRaw({source_restricted: true}), index).data.restricted, true);
  const capRestricted = {...capDoc, restricted: true};
  const idx2 = new Map([['f'.repeat(64), new Map([[capDoc.id, capRestricted]])]]);
  assert.equal(mcpDocument(mcpRaw({}, {source_original_document_sha256: sha256(canon(capRestricted))}), idx2).data.restricted, true);
  assert.equal(mcpDocument(mcpRaw({source_restricted: null}), index).data.restricted, null);
  const rest = {...docRow('00100', {}, 'azd-2:2008-md-01977'), native_id: capDoc.id, source: 'docketbird-rest'};
  rest.data.id = capDoc.id;
  const merged = mergeDocuments([rest], [mcpDocument(mcpRaw({source_restricted: true}), index)]);
  assert.equal(merged.length, 1); assert.equal(merged[0].source, 'docketbird-rest'); assert.equal(merged[0].data.restricted, true);
  const merged2 = mergeDocuments([rest], [mcpDocument(mcpRaw(), index)]);
  assert.equal(merged2[0].data.restricted, false); assert.equal(merged2[0].cl_docket.id, '4132492');
});
