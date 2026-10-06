import test from 'node:test';
import assert from 'node:assert/strict';
import {planDocket, planMdl, applyOps, sameJson, Patch, ARCHIVE_SHA} from './project-registry.mjs';

const baseRow = (over = {}) => ({
  id: 'sw-md:2323:cacd:2:2011-cv-08394',
  item: {cells: {filed: 'Not recorded', terminated: 'Not recorded', status: 'no_termination_date_recorded', docket_number: '2:11-08394'}, subtitle: 'MDL 2323 · filed not recorded', links: []},
  detail: {facts: [['Filed', 'Not recorded'], ['Docket header termination date', 'Not recorded'], ['Provider case ids', '']], links: [], registry: {native_case_ids: [], evidence: []}, provenance: {run_ids: ['x']}},
  filters: {year: '2011', status: 'no_termination_date_recorded', native_case_id: []}, ...over});
const g = (value, extra = {}) => ({action: 'fill', value, native_id: '8272189', source_row_ordinal: 14442769, ...extra});
const ev = new Map([['8272189', {pacer_case_id: '514383'}]]);

test('blank fills carry bulk sha256 and row ordinal, and a status follows the termination date', () => {
  const r = planDocket(baseRow(), {filed: g('2011-10-11'), terminated: g('2012-02-07'), native: g('8272189', {value: '8272189'})}, ev, 'blanks', 't');
  const c = r.patch.cols;
  assert.equal(c.item.cells.filed, '2011-10-11'); assert.equal(c.item.cells.status, 'header_terminated'); assert.equal(c.item.subtitle, 'MDL 2323 · filed 2011-10-11');
  assert.deepEqual(c.filters.native_case_id, ['8272189']);
  const gf = c.detail.provenance.gapfill; assert.equal(gf.length, 3);
  assert.ok(gf.every(x => x.archive_sha256 === ARCHIVE_SHA && Number.isInteger(x.source_row_ordinal)));
  assert.ok(c.detail.facts.some(f => f[0] === 'Filed — source' && /source row 14442769/.test(f[1])));
});

test('year mismatch and termination-before-filed are held, not written', () => {
  const a = planDocket(baseRow(), {filed: g('2012-10-11')}, ev, 'blanks', 't');
  assert.equal(a.patch.ops.length, 0); assert.match(a.held[0].reason, /year disagrees/);
  const b = planDocket(baseRow(), {filed: g('2011-10-11'), terminated: g('2011-01-01')}, ev, 'blanks', 't');
  assert.equal(b.patch.cols.item.cells.filed, 'Not recorded'); assert.equal(b.held.length, 2);
});

test('a populated filed value is never touched in the blanks phase', () => {
  const row = baseRow(); row.item.cells.filed = '2019-03-07';
  const r = planDocket(row, {filed: g('2011-10-11')}, ev, 'blanks', 't');
  assert.equal(r.patch.cols.item.cells.filed, '2019-03-07');
});

const reopenRow = () => {
  const r = baseRow({id: 'sw-md:2789:njd:2:2018-cv-05195'});
  r.item.cells.filed = '2019-03-07'; r.item.cells.terminated = '2018-08-02'; r.item.subtitle = 'MDL 2789 · filed 2019-03-07'; r.filters.year = '2019';
  r.detail.facts = [['Filed', '2019-03-07'], ['Docket header termination date', '2018-08-02']];
  r.detail.registry.evidence = [{kind: 'fjc_idb_mdl_number', locator: {idb_id: '1', origin: '13', date_filed: '2018-04-02'}}, {kind: 'fjc_idb_mdl_number', locator: {idb_id: '2', origin: '4', date_filed: '2019-03-07'}}];
  return r;
};

test('date correction applies only when (a), (b), (c) hold and keeps the displaced date', () => {
  const r = planDocket(reopenRow(), {conflict: {field: 'filed', action: 'conflict', existing: '2019-03-07', incoming: '2018-04-02', native_id: '6655855', source_row_ordinal: 5}}, ev, 'dates', 't');
  const c = r.patch.cols;
  assert.equal(c.item.cells.filed, '2018-04-02'); assert.equal(c.filters.year, '2018');
  assert.match(c.item.cells.reopened_or_reinstated, /2019-03-07 \(FJC IDB origin 4\)/);
  assert.equal(c.detail.registry.reopened_or_reinstated[0].date, '2019-03-07');
  assert.equal(c.detail.provenance.gapfill[0].displaced.idb_origin, '4');
});

test('date correction is held when the header disagrees with the earliest original row, the year, or termination', () => {
  const d = c => ({conflict: {field: 'filed', action: 'conflict', existing: '2019-03-07', incoming: c, native_id: '1', source_row_ordinal: 1}});
  assert.match(planDocket(reopenRow(), d('2018-04-03'), ev, 'dates', 't').held[0].reason, /\(b\)/);
  const noReopen = reopenRow(); noReopen.detail.registry.evidence[1].locator.origin = '6';
  assert.match(planDocket(noReopen, d('2018-04-02'), ev, 'dates', 't').held[0].reason, /\(a\)/);
  const badYear = reopenRow(); badYear.id = 'sw-md:2789:njd:2:2017-cv-05195';
  assert.match(planDocket(badYear, d('2018-04-02'), ev, 'dates', 't').held[0].reason, /\(c\)/);
  const after = reopenRow(); after.item.cells.terminated = '2018-01-01';
  assert.match(planDocket(after, d('2018-04-02'), ev, 'dates', 't').held.at(-1).reason, /later than termination/);
});

test('ops revert exactly, and revert refuses to overwrite a later change', () => {
  const row = baseRow();
  const r = planDocket(row, {filed: g('2011-10-11'), native: g('8272189', {value: '8272189'})}, ev, 'blanks', 't');
  const back = applyOps(r.patch.cols, JSON.parse(JSON.stringify(r.patch.ops)), 'revert');
  assert.deepEqual(back.skipped, []);
  assert.ok(sameJson(back.cols, {item: row.item, detail: row.detail, filters: row.filters}));
  const edited = JSON.parse(JSON.stringify(r.patch.cols)); edited.item.cells.filed = '2030-01-01';
  assert.equal(applyOps(edited, r.patch.ops, 'revert').skipped.length, 1);
});

test('sameJson ignores object key order (jsonb does not preserve it)', () => {
  assert.ok(sameJson({a: 1, b: {c: 2, d: 3}}, {b: {d: 3, c: 2}, a: 1}));
  assert.ok(!sameJson({a: 1}, {a: 2}));
});

test('FJC MDL number is projected only for an exact idb join and carries the historical label', () => {
  const row = {id: 'cl:dockets:1', item: {cells: {mdl_number: null, idb_data_id: '22251429'}}, detail: {facts: []}, filters: {}};
  const r = planMdl(row, {idb_data_id: '22251429', mdl_number_raw: '0008', origin: '1'}, 't');
  assert.equal(r.patch.cols.item.cells.mdl_number, '8'); assert.equal(r.patch.cols.item.cells.mdl_number_raw, '0008');
  assert.match(r.patch.cols.item.cells.mdl_number_basis, /historical administrative association \(FJC IDB\)/);
  assert.equal(planMdl(row, {idb_data_id: '999', mdl_number_raw: '2789', origin: '1'}, 't').patch.ops.length, 0);
  assert.equal(planMdl({...row, item: {cells: {mdl_number: '2100', idb_data_id: '22251429'}}}, {idb_data_id: '22251429', mdl_number_raw: '2789'}, 't').patch.ops.length, 0);
});

import {planCaption} from './project-registry.mjs';
import {captionCandidates, mergeEvidence} from './build-caption-evidence.mjs';

const capRow = () => ({id: 'sw-md:2545:ilnd:1:2016-cv-03654', title: '1:16-03654 (ilnd) — MDL member case', text: '1:16-03654 ilnd MDL 2545',
  item: {title: 'x', cells: {caption: null, caption_source: null, docket_number: '1:16-03654', court_id: 'ilnd'}}, detail: {title: 'x', facts: [['Provider case ids', 'courtlistener: 1'], ['Provider case ids — source', 's']], registry: {caption: null, captions: [], caption_withheld: true}, provenance: {}}, filters: {has_caption: 'false'}});

test('caption is filled exactly as published (whitespace only), with title, text, facts and provenance; blanks only', () => {
  const r = planCaption(capRow(), {value: '  Fabian   v. Actavis ', native_id: '13304142', source_row_ordinal: 7}, 't');
  const c = r.patch.cols;
  assert.equal(c.item.cells.caption, 'Fabian v. Actavis'); assert.equal(c.title, 'Fabian v. Actavis — 1:16-03654 (ilnd)'); assert.equal(c.filters.has_caption, 'true');
  assert.equal(c.detail.registry.caption_withheld, false); assert.match(c.text, /^Fabian v\. Actavis 1:16-03654/);
  assert.ok(c.detail.facts.some(f => f[0] === 'Caption — source' && /source row 7/.test(f[1])));
  assert.equal(c.detail.provenance.gapfill[0].archive_sha256, ARCHIVE_SHA);
  const populated = capRow(); populated.item.cells.caption = 'Existing v. Caption';
  assert.equal(planCaption(populated, {value: 'Other', native_id: '1', source_row_ordinal: 1}, 't').patch.ops.length, 0);
});

test('captions that are sealed/restricted/redacted text are held, never written', () => {
  for (const v of ['Doe v. Sealed Air Corp', 'In re Restricted Matter', 'Ex Parte Smith', 'REDACTED v. X', 'In camera Co']) {
    const r = planCaption(capRow(), {value: v, native_id: '1', source_row_ordinal: 1}, 't');
    assert.equal(r.patch.ops.length, 0); assert.match(r.held[0].reason, /exclusion/);
  }
});

test('caption candidates need a unique, unblocked bulk row; evidence rows gain fills_caption as a new payload', () => {
  const reg = [{id: 'a', docket_key: 'k1', caption: null}, {id: 'b', docket_key: 'k2', caption: ''}, {id: 'c', docket_key: 'k3', caption: null}, {id: 'd', docket_key: 'k4', caption: 'Has v. Caption'}];
  const m = (id, key, extra = {}) => ({id, docket_key: key, court_id: 'njd', docket_number: '2:18-cv-00001', case_name: 'A v. B', blocked: 'f', source_row_ordinal: 1, ...extra});
  const r = captionCandidates(reg, [m('1', 'k1'), m('2', 'k2'), m('3', 'k2'), m('4', 'k3', {blocked: 't'}), m('5', 'k4')]);
  assert.equal(r.stats.candidates, 1); assert.equal(r.stats.ambiguous, 1); assert.equal(r.stats.blocked, 1);
  const out = mergeEvidence([], r.cands, {archive_sha256: 'f'.repeat(64), snapshot_date: '2026-09-30', archive_bytes: 1, rows_scanned: 1}, 't');
  assert.equal(out.delta.length, 1); assert.ok(out.delta[0].data.purposes.includes('fills_caption')); assert.deepEqual(out.delta[0].data.registry_dockets, ['a']);
});

import {planTerminationNote, VARIANT_RULE, TERMINATION_NOTE} from './project-registry.mjs';
import {decideVariants, variantRow, RULE, normCaption, normCaptionLoose, CAPTION_BASIS} from './build-variant-evidence.mjs';

test('termination note is factual: date stays Not recorded, note carries the snapshot date, nothing about open/closed', () => {
  const row = baseRow();
  const r = planTerminationNote(row, {native_id: '8272189', source_row_ordinal: 7, as_of: '2026-09-30'}, 't');
  const c = r.patch.cols;
  assert.equal(c.item.cells.terminated, 'Not recorded'); assert.equal(c.item.cells.termination_note, 'No termination recorded (CourtListener bulk 2026-09-30)');
  assert.equal(c.item.cells.termination_note, TERMINATION_NOTE('2026-09-30')); assert.equal(c.item.cells.status, 'no_termination_date_recorded');
  assert.doesNotMatch(JSON.stringify(c.item.cells), /\bopen\b/i);
  assert.ok(c.detail.facts.some(f => f[0] === 'Termination status — source' && /source row 7/.test(f[1])));
  const withDate = baseRow(); withDate.item.cells.terminated = '2012-01-01';
  assert.equal(planTerminationNote(withDate, {native_id: '1', source_row_ordinal: 1, as_of: '2026-09-30'}, 't').patch.ops.length, 0);
});

test('a later termination fill removes the note', () => {
  const noted = planTerminationNote(baseRow(), {native_id: '8272189', source_row_ordinal: 7, as_of: '2026-09-30'}, 't').patch.cols;
  const row = {id: baseRow().id, ...noted};
  const r = planDocket(row, {terminated: g('2012-02-07')}, ev, 'blanks', 't');
  assert.equal(r.patch.cols.item.cells.terminated, '2012-02-07'); assert.equal(r.patch.cols.item.cells.termination_note, undefined);
});

const reg = (id, key, extra = {}) => ({id, docket_key: key, court_id: key.split(':')[0], caption: null, native_case_ids: [], ...extra});
const bulk = (id, relaxed, type, extra = {}) => ({id, relaxed, type, docket_number: `1:18-${type}-45090`, case_name: 'A v. B', blocked: 'f', source_row_ordinal: 5, date_filed: '2018-01-01', date_terminated: null, ...extra});

test('variant rule A1: unique relaxed key, civil-series type letter, caption confirmed or registry caption blank', () => {
  const R = [reg('r1', 'ohnd:1:2018-cv-45090'), reg('r2', 'ohnd:1:2018-cv-45091', {caption: ' a  V. b '}), reg('r3', 'ohnd:1:2018-cv-45092', {caption: 'Other v. Name'}),
    reg('r4', 'ohnd:1:2018-cv-45093'), reg('r5', 'ohnd:1:2018-cv-45094'), reg('r6', 'ohnd:1:2018-cv-45095'), reg('r7', 'ohnd:1:2018-cv-45096', {native_case_ids: [{id: '123'}]})];
  const B = [bulk('1', 'ohnd:1:2018-45090', 'op'), bulk('2', 'ohnd:1:2018-45091', 'op'), bulk('3', 'ohnd:1:2018-45092', 'op'), bulk('4', 'ohnd:1:2018-45093', 'op'), bulk('5', 'ohnd:1:2018-45093', 'cv'),
    bulk('6', 'ohnd:1:2018-45094', 'cr'), bulk('7', 'ohnd:1:2018-45095', 'op', {blocked: 't'}), bulk('8', 'ohnd:1:2018-45096', 'op')];
  const {stats, accepted, held} = decideVariants(R, B, new Set());
  assert.deepEqual(accepted.map(a => a.registry.id), ['r1', 'r2']);
  assert.equal(stats.caption_mismatch_held, 1); assert.equal(stats.ambiguous_relaxed_key, 1); assert.equal(stats.type_not_civil_series, 1); assert.equal(stats.blocked, 1);
  assert.equal(normCaption('  A   V. B '), 'a v. b');
  const row = variantRow(accepted[0], {archive_sha256: 'f'.repeat(64), snapshot_date: '2026-09-30', archive_bytes: 1, rows_scanned: 1}, 't');
  assert.equal(row.data.key_match_rule, RULE); assert.equal(row.data.key_match_rule, VARIANT_RULE); assert.deepEqual(row.data.type_variant, {registry_type: 'cv', bulk_type: 'op'});
  assert.equal(held.length, 4);
});

test('variant native id is projected with the rule name in provenance and a distinct resolution basis', () => {
  const r = planDocket(baseRow(), {native: {native_id: '55', source_row_ordinal: 9, key_match_rule: VARIANT_RULE}}, new Map([['55', {pacer_case_id: '1'}]]), 'blanks', 't');
  const c = r.patch.cols;
  assert.equal(c.detail.registry.native_case_ids[0].resolution_basis, 'civil_series_type_variant_bulk_2026-09-30'); assert.equal(c.detail.registry.native_case_ids[0].key_match_rule, VARIANT_RULE);
  assert.equal(c.detail.provenance.gapfill[0].key_match_rule, VARIANT_RULE);
  assert.equal(c.item.cells.filed, 'Not recorded');
});

test('variant projection repairs a landed id entry whose pacer_case_id is blank, and only that field', () => {
  const landed = planDocket(baseRow(), {native: {native_id: '55', source_row_ordinal: 9, key_match_rule: VARIANT_RULE}}, new Map(), 'blanks', 't');
  assert.equal(landed.patch.cols.detail.registry.native_case_ids[0].pacer_case_id, null);
  const row = {...baseRow(), item: landed.patch.cols.item, detail: landed.patch.cols.detail, filters: landed.patch.cols.filters};
  const fix = planDocket(row, {native: {native_id: '55', source_row_ordinal: 9, key_match_rule: VARIANT_RULE}}, new Map([['55', {pacer_case_id: '238508'}]]), 'blanks', 't2');
  assert.deepEqual(fix.patch.ops.map(o => o.path.join('.')), ['detail.registry.native_case_ids']);
  assert.equal(fix.patch.cols.detail.registry.native_case_ids[0].pacer_case_id, '238508');
  assert.equal(fix.patch.cols.detail.registry.native_case_ids.length, 1);
  const again = planDocket({...row, detail: fix.patch.cols.detail}, {native: {native_id: '55', source_row_ordinal: 9, key_match_rule: VARIANT_RULE}}, new Map([['55', {pacer_case_id: '238508'}]]), 'blanks', 't3');
  assert.equal(again.patch.ops.length, 0);
});

test('looser caption rule: whitespace/case, trailing ET AL on either side of the v., punctuation; never truncation prefixes', () => {
  assert.equal(normCaptionLoose('CITY OF LORAIN v. PURDUE PHARMA L.P., ET AL'), normCaptionLoose('City of Lorain v. Purdue Pharma L.P.'));
  assert.equal(normCaptionLoose('SMITH, ET AL v. ACME, INC., ET AL.'), normCaptionLoose('Smith v. Acme Inc.'));
  assert.notEqual(normCaptionLoose('LOCAL NO. 38 IBEW HEALTH AND W v. PURDUE PHARMA L.P., ET AL'), normCaptionLoose('Local No. 38 IBEW Health and Welfare Fund v. Purdue Pharma L.P.'));
  assert.notEqual(normCaptionLoose('CUYAHOGA COUNTY OF OHIO, ET AL v. PURDUE'), normCaptionLoose('County of Cuyahoga v. Purdue'));
  const R = [reg('r1', 'ohnd:1:2018-cv-45090', {caption: 'CITY OF LORAIN v. PURDUE PHARMA L.P., ET AL'}), reg('r2', 'ohnd:1:2018-cv-45091', {caption: 'LOCAL NO. 38 IBEW HEALTH AND W v. PURDUE PHARMA L.P., ET AL'})];
  const B = [bulk('1', 'ohnd:1:2018-45090', 'op', {case_name: 'City of Lorain v. Purdue Pharma L.P.'}), bulk('2', 'ohnd:1:2018-45091', 'op', {case_name: 'Local No. 38 IBEW Health and Welfare Fund v. Purdue Pharma L.P.'})];
  const {accepted, stats} = decideVariants(R, B, new Set());
  assert.deepEqual(accepted.map(a => [a.registry.id, a.caption_basis]), [['r1', CAPTION_BASIS.loose]]); assert.equal(stats.caption_mismatch_held, 1);
});
