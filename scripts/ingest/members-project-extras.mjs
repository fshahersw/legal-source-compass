// Projects docket entries and parties/counsel of the registry's master dockets into the public read model (contract sw-matter-registry/1 v1.3):
//   public.corpus_records  sw_docket_entries_v1   one row per CourtListener docket entry of a master docket
//   public.corpus_records  sw_matter_parties_v1   one row per party on a master docket, with its counsel (name, firm, role)
// "Show as published" (owner decision 2026-10-03): text is published as the court record shows it, except what members-publish-rules.mjs excludes.
// The lake (corpus_ingest) is read through public.corpus_sw_registry_read_v1 (service_role), so the projection is exactly what is stored there.
// Rows are upserted by (dataset, id) and only when their content hash or ordinal changed; rows are never deleted. A dataset that is already
// ready stays ready while it is re-projected.
//
// node --use-system-ca scripts/ingest/members-project-extras.mjs --mdls=3047,3140,... --run=<registry run uuid> [--only=entries|parties] [--native-entry-ids-file=<JSON array>] [--ready=true] [--dry-run=true] [--work=<private work dir>|--staging=<private staging dir>]
import fs from 'node:fs';
import path from 'node:path';
import { rest, rpc } from './members-pgrest.mjs';
import { docketNumberFromKey, courtOfKey } from './members-registry-lib.mjs';
import { sha256, canon, excluded, hasContact, ws, clipDescription, ATTORNEY_ROLE, ROLE_SEALED, ROLE_TERMINATED, firmFromLines, entryOrdinal, partyOrdinal } from './members-publish-rules.mjs';
import { makeEntryRecord } from './members-entry-record.mjs';
import { beforeImagePayload, mergeProjectionMetadata, mergeProjectionRows } from './members-projection-metadata.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), 'true'] : [x.slice(2, i), x.slice(i + 1)]; }));
const mdls = (args.mdls ?? '').split(',').filter(Boolean).map(Number);
const run = args.run;
const dry = args['dry-run'] === 'true';
const setReady = args.ready === 'true';
const only = args.only ?? 'all';
if (!mdls.length || !/^[0-9a-f-]{36}$/.test(run ?? '')) throw new Error('--mdls and --run are required');
let nativeEntryIds = null;
if (Object.hasOwn(args, 'native-entry-ids-file')) {
  if (only !== 'entries') throw new Error('--native-entry-ids-file is valid only with --only=entries');
  const file = args['native-entry-ids-file'];
  if (!file || file === 'true') throw new Error('--native-entry-ids-file must name a JSON file');
  const values = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!Array.isArray(values) || values.length === 0 || values.some(id => typeof id !== 'string' || !/^[1-9]\d*$/.test(id))) {
    throw new Error('--native-entry-ids-file must contain a non-empty JSON array of positive numeric string IDs');
  }
  nativeEntryIds = new Set(values);
}
const work = path.resolve(args.work ?? 'C:/Users/firas/Downloads/sw-platform-ui-refined/sw-platform-ui-refined/_work/agents/mdl-members');
const staging = path.resolve(args.staging ?? path.join(work, 'registry-staging'));
const PROJECTED_AT = new Date().toISOString();
const DS_ENTRIES = 'sw_docket_entries_v1', DS_PARTIES = 'sw_matter_parties_v1';
const SCHEMA = 'sw-matter-registry-view/1';
const PRIORITY_NUM = ['courtlistener_header', 'docketbird_id', 'firm_crosswalk', 'jpml_schedule_as_printed', 'official_court_page', 'master_party_list'];
const numRank = s => { const i = PRIORITY_NUM.indexOf(s); return i < 0 ? 99 : i; };
const enc = encodeURIComponent;

// ---------- matter contexts from the bundles ----------
const ctxByDocket = new Map(); // CourtListener docket id -> ctx
const ctxs = [];
for (const mdl of mdls) {
  const b = JSON.parse(fs.readFileSync(path.join(staging, `bundle-${mdl}.json`), 'utf8'));
  const master = b.dockets.find(d => d.role === 'master');
  const num = [...master.docket_numbers].sort((a, c) => numRank(a.source) - numRank(c.source))[0]?.value ?? docketNumberFromKey(master.key);
  const cl = master.provider_ids.filter(p => p.provider === 'courtlistener' && !/header_conflicts/.test(p.resolution_basis ?? ''));
  const ctx = { mdl, tier: b.seed.tier, no_registry_links: b.seed.registry_projected === false, docket_key: master.key, court_id: master.court_id, docket_number: num, cl_ids: cl.filter(p => p.blocked !== true).map(p => String(p.id)), blocked_ids: cl.filter(p => p.blocked === true).map(p => String(p.id)),
    other_case_ids: master.provider_ids.filter(p => p.provider !== 'courtlistener').map(p => ({ provider: p.provider, source_system: p.source_system, id: p.id })),
    stats: { entries: { lake: 0, projected: 0, withheld_sealed_document: 0, withheld_text: 0, truncated: 0, external: {} }, parties: { lake_associations: 0, projected: 0, name_withheld: 0, counsel_links: 0, counsel_sealed_omitted: 0, counsel_unresolved: 0 } } };
  ctxs.push(ctx);
  for (const id of ctx.cl_ids) ctxByDocket.set(id, ctx);
}
const allDocketIds = [...ctxByDocket.keys()];
const matterLink = ctx => `#record/sw_matters_v1/${enc(`sw-matter:${ctx.mdl}`)}`;
const masterLink = ctx => `#record/sw_matter_dockets_v1/${enc(`sw-md:${ctx.mdl}:${ctx.docket_key}`)}`;
const clDocketUrl = id => `https://www.courtlistener.com/docket/${id}/`;

async function* lakePages(kind, params) {
  let after = null;
  for (;;) {
    const r = await rpc('corpus_sw_registry_read_v1', { p_kind: kind, p_after: after, p_limit: 500, ...params });
    for (const row of r.rows) yield row;
    if (!r.next) break;
    after = r.next;
  }
}
const finish = rec => { const h = sha256(canon([rec.id, rec.title, rec.item, rec.detail, rec.filters, rec.text, rec.source_url])); rec.detail.provenance.projection_row_sha256 = h; return rec; };

// ---------- entries ----------
function entryRecord(row, ctx) { return makeEntryRecord(row, ctx, { run, SCHEMA, DS_ENTRIES, finish, masterLink, matterLink, clDocketUrl }); }

// ---------- entries of dockets CourtListener blocks (registry external-entry: GovInfo, official court page, DocketBird sheet) ----------
const ctxByMdl = new Map(ctxs.map(c => [String(c.mdl), c]));
const PROVIDER_LABEL = { govinfo: 'GovInfo (U.S. Government Publishing Office)', 'official-court': 'Court website', docketbird: 'DocketBird docket sheet' };
function externalEntryRecord(row, ctx) {
  const d = row.data;
  const entryNumber = Number.isInteger(d.entry_number) ? d.entry_number : null;
  const raw = ws(d.title);
  const withheld = excluded(raw) ? 'sealed_or_restricted_text' : null;
  const clip = clipDescription(raw, 500);
  const description = withheld || !raw ? null : clip.text;
  const hasPdf = !!d.pdf_url;
  const availability = hasPdf ? 'official_pdf' : d.downloadable_at_provider ? 'provider_pdf' : 'no_documents';
  const idKey = d.provider === 'official-court' ? sha256(d.provider_native_id).slice(0, 16) : d.provider_native_id;
  const id = `sw-entry:${d.provider}:${idKey}`;
  const dateFiled = d.date_filed ?? null;
  const numLabel = entryNumber != null ? `Entry ${entryNumber}` : 'Docket text';
  const title = description ? `${numLabel} — ${description.length > 110 ? description.slice(0, 109) + '…' : description}` : `${numLabel} — description ${withheld ? 'withheld' : 'not recorded'}`;
  const subtitle = `${ctx.docket_number} (${ctx.court_id}) · MDL ${ctx.mdl} · ${dateFiled ?? 'date not recorded'} · ${PROVIDER_LABEL[d.provider] ?? d.provider}`;
  const cells = {
    mdl: String(ctx.mdl), docket_key: ctx.docket_key, docket_number: ctx.docket_number, court_id: ctx.court_id, provider: d.provider, native_entry_id: String(d.provider_native_id), native_docket_id: null,
    entry_number: entryNumber, date_filed: dateFiled, time_filed: null, description, description_chars: clip.chars, description_truncated: clip.truncated && !withheld, description_withheld: withheld,
    documents: hasPdf ? 1 : 0, documents_available: hasPdf ? 1 : 0, documents_sealed: 0, availability,
    document_ids: hasPdf && !withheld ? [String(d.pdf_url)] : [], held: !!withheld, source_url: (hasPdf && !withheld ? d.pdf_url : d.url) ?? null,
  };
  const links = [...(hasPdf && !withheld ? [{ url: d.pdf_url, label: d.provider === 'govinfo' ? 'Official PDF (GovInfo)' : 'Official PDF (court website)' }] : []), ...(d.url ? [{ url: d.url, label: PROVIDER_LABEL[d.provider] ?? d.provider }] : []), { url: masterLink(ctx), label: 'Master docket in the matter registry' }, { url: matterLink(ctx), label: 'Matter' }];
  const facts = [['MDL', String(ctx.mdl)], ['Docket', `${ctx.docket_number} (${ctx.court_id})`], ['Entry number', entryNumber != null ? String(entryNumber) : 'Not recorded by this source'], ['Filed', dateFiled ?? 'Not recorded'],
    ['Description', description ?? (withheld ? 'Withheld (sealed, restricted or redacted in the court record)' : 'Not recorded')], ['Source', PROVIDER_LABEL[d.provider] ?? d.provider], ['Source id', String(d.provider_native_id)]];
  if (d.date_as_printed && d.date_as_printed !== dateFiled) facts.push(['Date as printed', d.date_as_printed]);
  if (clip.truncated && !withheld) facts.push(['Description length', `${clip.chars} characters in the record; first 499 shown`]);
  const rec = {
    dataset: DS_ENTRIES, id, category: 'sw_docket_entry', state: null, county_geoids: [], title, source_url: (hasPdf && !withheld ? d.pdf_url : d.url) ?? null, ordinal: entryOrdinal(ctx.mdl, dateFiled, entryNumber),
    item: { id, cells, links, title, badges: ['Docket entry', ...(hasPdf ? ['Official PDF'] : []), ...(withheld ? ['Description withheld'] : []), `Source: ${PROVIDER_LABEL[d.provider] ?? d.provider}`], subtitle },
    detail: { id, title, subtitle, facts, links, sections: [],
      registry: { schema: 'sw-matter-registry/1', mdl: String(ctx.mdl), docket_key: ctx.docket_key, native_case_ids: ctx.other_case_ids, entry: { provider: d.provider, native_entry_id: String(d.provider_native_id), entry_number: entryNumber, date_filed: dateFiled, time_filed: null, recap_sequence_number: null, pacer_sequence_number: null }, description_withheld: withheld, documents: hasPdf ? [{ native_document_id: String(d.provider_native_id), document_number: entryNumber != null ? String(entryNumber) : null, attachment_number: d.attachment_number ?? null, description: null, description_withheld: null, page_count: null, is_available: true, is_sealed: null }] : [], source: d.source ?? null },
      provenance: { source_system: 'sw-matter-registry', source_entity_type: 'external-entry', source_native_id: row.native_id, source_record_sha256: row.payload_sha256, retrieved_at: row.retrieved_at, run_ids: [run], projection_schema: SCHEMA },
      qualification: 'One docket entry of a docket that CourtListener blocks at the source, taken from the route that remains (GovInfo published opinions, the court’s own MDL page, or a DocketBird docket sheet). The list is partial: it holds what the source publishes, not the whole docket. Descriptions are shown as the source prints them (clipped to 500 characters) except sealed, restricted, in camera, ex parte or redacted text.' },
    text: [description ?? '', entryNumber ?? '', ctx.docket_number, `MDL ${ctx.mdl}`, dateFiled ?? '', d.provider].join(' ').replace(/\s+/g, ' ').trim(),
    filters: { _listing: 'true', native_id: String(d.provider_native_id), mdl: String(ctx.mdl), docket_key: ctx.docket_key, native_docket_id: '', provider: d.provider, year: dateFiled ? dateFiled.slice(0, 4) : '', availability, has_documents: hasPdf ? 'true' : 'false', description_withheld: withheld ? 'true' : 'false' },
  };
  return { rec: finish(rec), withheld, truncated: clip.truncated && !withheld };
}

// ---------- parties ----------
async function loadAttorneys(ids) {
  const map = new Map();
  const list = [...ids];
  for (let i = 0; i < list.length; i += 300) {
    for await (const row of lakePages('attorneys', { p_ids: list.slice(i, i + 300) })) map.set(row.native_id, row);
  }
  return map;
}
function partyRecords(partyRows, attorneyMap) {
  const out = [];
  for (const row of partyRows) {
    const d = row.data;
    const byDocket = new Map();
    for (const pt of d.party_types ?? []) { const k = String(pt.docket_id); if (!ctxByDocket.has(k)) continue; byDocket.set(k, [...(byDocket.get(k) ?? []), pt]); }
    for (const [clDocketId, pts] of byDocket) {
      const ctx = ctxByDocket.get(clDocketId);
      ctx.stats.parties.lake_associations++;
      const types = [...new Set(pts.map(pt => ws(pt.name)).filter(Boolean))];
      const extraRaw = [...new Set(pts.map(pt => ws(pt.extra_info)).filter(Boolean))].join(' | ');
      const nameRaw = ws(d.name);
      const nameWithheld = excluded(nameRaw) || hasContact(nameRaw) || !nameRaw;
      const extraWithheld = !!extraRaw && (excluded(extraRaw) || hasContact(extraRaw));
      const name = nameWithheld ? null : nameRaw;
      const extra = extraRaw && !extraWithheld ? extraRaw : null;
      const dateTerminated = pts.map(pt => pt.date_terminated).find(Boolean) ?? null;
      // counsel: this party's attorney associations on this docket, one entry per attorney
      const byAtty = new Map();
      for (const a of d.attorneys ?? []) {
        if (String(a.docket_id) !== clDocketId) continue;
        const k = String(a.attorney_id);
        const e = byAtty.get(k) ?? { codes: new Set() };
        e.codes.add(Number(a.role)); byAtty.set(k, e);
      }
      const counsel = []; let sealedOmitted = 0; let unresolved = 0;
      for (const [attyId, e] of byAtty) {
        if (e.codes.has(ROLE_SEALED)) { sealedOmitted++; continue; }
        const a = attorneyMap.get(attyId);
        const codes = [...e.codes].sort((x, y) => x - y);
        if (!a) { unresolved++; counsel.push({ native_attorney_id: attyId, name: null, firm: null, roles: codes.map(c => ATTORNEY_ROLE[c] ?? `Role ${c}`), role_codes: codes, terminated: codes.some(c => ROLE_TERMINATED.has(c)), note: 'attorney record not collected yet' }); continue; }
        const nm = ws(a.data.name);
        const nmOk = nm && !excluded(nm) && !hasContact(nm);
        const firm = nmOk ? firmFromLines(nm, a.data.contact_lines) : null;
        counsel.push({ native_attorney_id: attyId, name: nmOk ? nm : null, firm: firm && !excluded(firm) ? firm : null, roles: codes.map(c => ATTORNEY_ROLE[c] ?? `Role ${c}`), role_codes: codes, terminated: codes.some(c => ROLE_TERMINATED.has(c)) });
      }
      counsel.sort((x, y) => (y.role_codes.includes(2) - x.role_codes.includes(2)) || String(x.name ?? '\uffff').localeCompare(String(y.name ?? '\uffff')) || x.native_attorney_id.localeCompare(y.native_attorney_id));
      ctx.stats.parties.projected++; if (nameWithheld) ctx.stats.parties.name_withheld++;
      ctx.stats.parties.counsel_links += counsel.length; ctx.stats.parties.counsel_sealed_omitted += sealedOmitted; ctx.stats.parties.counsel_unresolved += unresolved;
      const id = `sw-party:courtlistener:${clDocketId}:${row.native_id}`;
      const typeLabel = types.join(' / ') || 'Party';
      const title = `${name ?? 'Name withheld'} \u2014 ${typeLabel}`;
      const subtitle = `${ctx.docket_number} (${ctx.court_id}) \u00b7 MDL ${ctx.mdl}`;
      const firms = [...new Set(counsel.map(c => c.firm).filter(Boolean))];
      const cells = { mdl: String(ctx.mdl), docket_key: ctx.docket_key, docket_number: ctx.docket_number, court_id: ctx.court_id, provider: 'courtlistener', native_party_id: String(row.native_id), native_docket_id: clDocketId,
        party_name: name, party_types: typeLabel, extra_info: extra, date_terminated: dateTerminated, name_withheld: nameWithheld, counsel_count: counsel.length, lead_counsel_count: counsel.filter(c => c.role_codes.includes(2)).length, counsel_sealed_omitted: sealedOmitted,
        kind: 'party', name };
      const links = [{ url: clDocketUrl(clDocketId), label: 'CourtListener docket' }, { url: masterLink(ctx), label: 'Master docket in the matter registry' }, { url: matterLink(ctx), label: 'Matter' }];
      const facts = [['MDL', String(ctx.mdl)], ['Docket', `${ctx.docket_number} (${ctx.court_id})`], ['Party', name ?? 'Withheld (sealed, restricted or redacted in the court record)'], ['Party type', typeLabel], ...(extra ? [['Court-record note', extra]] : []), ...(dateTerminated ? [['Terminated', dateTerminated]] : []), ['Counsel of record', String(counsel.length)], ['Native party id', String(row.native_id)]];
      const sections = counsel.length ? [{ heading: 'Counsel', header: ['Name', 'Firm', 'Role'], rows: counsel.map(c => [c.name ?? 'Not recorded', c.firm ?? '', c.roles.join('; ')]) }] : [];
      const rec = {
        dataset: DS_PARTIES, id, category: 'sw_matter_party', state: null, county_geoids: [], title, source_url: clDocketUrl(clDocketId), ordinal: partyOrdinal(ctx.mdl, row.native_id),
        item: { id, cells, links, title, badges: ['Party', ...(counsel.length ? [`${counsel.length} counsel`] : []), ...(nameWithheld ? ['Name withheld'] : [])], subtitle },
        detail: { id, title, subtitle, facts, links, sections,
          registry: { schema: 'sw-matter-registry/1', mdl: String(ctx.mdl), docket_key: ctx.docket_key, native_case_ids: [{ provider: 'courtlistener', source_system: 'courtlistener', id: clDocketId }], party: { provider: 'courtlistener', native_party_id: String(row.native_id), name, name_withheld: nameWithheld, party_types: types, extra_info: extra, date_terminated: dateTerminated }, counsel, counsel_sealed_omitted: sealedOmitted, counsel_unresolved: unresolved },
          provenance: { source_system: 'courtlistener', source_entity_type: 'parties', source_native_id: String(row.native_id), source_record_sha256: row.payload_sha256, counsel_record_sha256: sha256(canon(counsel.map(c => [c.native_attorney_id, attorneyMap.get(c.native_attorney_id)?.payload_sha256 ?? null]))), retrieved_at: row.retrieved_at, run_ids: [run], projection_schema: SCHEMA },
          qualification: 'One party on a master docket and its counsel, as the court record shows them (CourtListener parties and attorneys). Counsel is name, firm and role only; addresses, phones, faxes and emails are not published. Parties or counsel that are sealed, restricted or redacted in the record are withheld; counsel flagged "Attorney in sealed group" are omitted. Not legal advice.' },
        text: [name ?? '', typeLabel, extra ?? '', ...counsel.map(c => `${c.name ?? ''} ${c.firm ?? ''}`), ctx.docket_number, `MDL ${ctx.mdl}`].join(' ').replace(/\s+/g, ' ').trim(),
        filters: { _listing: 'true', native_id: String(row.native_id), mdl: String(ctx.mdl), docket_key: ctx.docket_key, native_docket_id: clDocketId, provider: 'courtlistener', kind: 'party', party_type: types.length ? types : ['Party'], has_counsel: counsel.length ? 'true' : 'false', name_withheld: nameWithheld ? 'true' : 'false', counsel_native_id: counsel.map(c => c.native_attorney_id), counsel_firm: firms },
      };
      out.push(finish(rec));
    }
  }
  return out;
}

// ---------- sync (hash-diffed upserts, ready preserved, read-back by hash) ----------
async function remoteMap(dataset) {
  const map = new Map();
  for (let off = 0; ; off += 1000) {
    const page = (await rest(`corpus_records?select=id,ordinal,filters,h:detail->provenance->>projection_row_sha256&dataset=eq.${dataset}&order=id.asc&limit=1000&offset=${off}`)).data;
    for (const r of page) map.set(r.id, { ordinal: Number(r.ordinal), h: r.h, filters: r.filters ?? {} });
    if (page.length < 1000) break;
  }
  return map;
}
async function remoteRowsByIds(dataset, ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 100) {
    const quoted = ids.slice(i, i + 100).map(id => `"${String(id).replaceAll('"', '\\"')}"`).join(',');
    const filter = encodeURIComponent(`(${quoted})`);
    const page = (await rest(`corpus_records?select=*&dataset=eq.${encodeURIComponent(dataset)}&id=in.${filter}`)).data;
    rows.push(...page);
  }
  return rows;
}
function writeBeforeImages(dataset, sourceRows) {
  if (!sourceRows.length) return null;
  const file = path.join(staging, 'before-images', `${run}-${dataset}.json`);
  const checksumFile = `${file}.sha256`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8');
    const digest = sha256(existing);
    let prior;
    try { prior = JSON.parse(existing); } catch { throw new Error(`Invalid existing before-images at ${file}`); }
    const savedIds = new Set((prior.changed_existing_rows ?? []).map(row => row.id));
    let expected;
    try { expected = fs.readFileSync(checksumFile, 'utf8').trim(); } catch { throw new Error(`Missing before-image checksum at ${checksumFile}`); }
    if (digest !== expected || prior.dataset !== dataset || prior.run !== run || sourceRows.some(row => !savedIds.has(row.id))) throw new Error(`Existing before-images do not cover or verify this projection at ${file}`);
    return { sha256: digest, rows: prior.changed_existing_rows.length, verified: true };
  }
  const payload = beforeImagePayload({ dataset, run, rows: sourceRows, capturedAt: new Date().toISOString() });
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  const digest = sha256(content);
  fs.writeFileSync(file, content, { flag: 'wx' });
  fs.writeFileSync(checksumFile, `${digest}\n`, { flag: 'wx' });
  const readBack = fs.readFileSync(file, 'utf8');
  const checksumReadBack = fs.readFileSync(checksumFile, 'utf8').trim();
  if (sha256(readBack) !== digest || checksumReadBack !== digest) throw new Error(`Before-image read-back hash mismatch at ${file}`);
  return { sha256: digest, rows: sourceRows.length, verified: true };
}
async function syncDataset(dataset, label, records, metadata) {
  const local = new Map(records.map(r => [r.id, r]));
  const before = await remoteMap(dataset);
  const todo = records.filter(r => { const x = before.get(r.id); return !x || x.h !== r.detail.provenance.projection_row_sha256 || x.ordinal !== r.ordinal; });
  const remoteOnly = [...before.keys()].filter(id => !local.has(id));
  console.log(JSON.stringify({ dataset, local: records.length, remote_before: before.size, to_upsert: todo.length, remote_only: remoteOnly.length, dry }));
  if (dry) return { upserted: 0, verified: null, remote_only: remoteOnly.length };
  const existing = (await rest(`corpus_datasets?select=id,ready,expected_records,imported_records,metadata&id=eq.${dataset}`)).data[0] ?? null;
  const projectedTotal = mergeProjectionRows([...before].map(([id, value]) => ({ id, ...value })), records).size;
  const changedExistingIds = todo.map(r => r.id).filter(id => before.has(id));
  const changedExistingRows = await remoteRowsByIds(dataset, changedExistingIds);
  const beforeImageIds = new Set(changedExistingRows.map(row => row.id));
  if (changedExistingRows.length !== changedExistingIds.length || changedExistingIds.some(id => !beforeImageIds.has(id))) throw new Error(`Could not read every changed existing ${dataset} row for its before-image`);
  const beforeImages = writeBeforeImages(dataset, changedExistingRows);
  await rest('corpus_datasets?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: [{ id: dataset, label, ...(existing ? {} : { ready: false, expected_records: projectedTotal, imported_records: projectedTotal }), updated_at: PROJECTED_AT }] });
  for (let i = 0, cur = [], bytes = 0; i <= todo.length; i++) {
    const r = todo[i];
    const size = r ? Buffer.byteLength(JSON.stringify(r)) : 0;
    if (!r || (cur.length && (bytes + size > 900_000 || cur.length >= 150))) { if (cur.length) await rest('corpus_records?on_conflict=dataset,id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: cur }); cur = []; bytes = 0; }
    if (r) { cur.push(r); bytes += size; }
  }
  const after = await remoteMap(dataset);
  const mismatched = records.filter(r => { const x = after.get(r.id); return !x || x.h !== r.detail.provenance.projection_row_sha256 || x.ordinal !== r.ordinal; }).length;
  const rowsSha = sha256([...local.keys()].sort().map(id => `${id}:${local.get(id).detail.provenance.projection_row_sha256}`).join('\n'));
  const verified = mismatched === 0 && after.size === projectedTotal;
  const projection_validation = { projected_records: records.length, remote_records: after.size, verified, validated_at: new Date().toISOString(), contract_version: SCHEMA, rows_sha256: rowsSha, before_images: beforeImages, method: 'PostgREST read-back of every projected row and exact retained catalog count' };
  const mergedRows = mergeProjectionRows([...after].map(([id, value]) => ({ id, ...value })), []);
  const mergedMetadata = mergeProjectionMetadata(existing?.metadata, metadata, mergedRows, projection_validation);
  await rest(`corpus_datasets?id=eq.${dataset}`, { method: 'PATCH', prefer: 'return=minimal', body: { expected_records: after.size, imported_records: after.size, metadata: mergedMetadata, updated_at: new Date().toISOString() } });
  if (setReady && verified) await rest(`corpus_datasets?id=eq.${dataset}`, { method: 'PATCH', prefer: 'return=minimal', body: { ready: true, updated_at: new Date().toISOString() } });
  console.log(JSON.stringify({ event: 'synced', dataset, upserted: todo.length, mismatched, verified, ready: setReady && verified ? true : (existing?.ready ?? false) }));
  return { upserted: todo.length, verified, remote_only: remoteOnly.length };
}

const opt = (counts, labeler = x => x) => Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: labeler(value), count }));
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

// ---------- run ----------
const summary = { projected_at: PROJECTED_AT, run, matters: {} };
if (only === 'all' || only === 'entries') {
  const records = []; const seen = new Set(); const foundNativeEntryIds = new Set(); const byMdl = {}; const years = {}; const avail = {};
  for await (const row of lakePages('docket-entries', { p_docket_ids: allDocketIds })) {
    const nativeId = String(row.native_id);
    if (nativeEntryIds && !nativeEntryIds.has(nativeId)) continue;
    if (seen.has(nativeId)) continue; seen.add(nativeId);
    const clDocketId = (row.data.docket ?? '').match(/\/dockets\/(\d+)\//)?.[1];
    const ctx = ctxByDocket.get(clDocketId);
    if (!ctx) continue;
    if (nativeEntryIds) foundNativeEntryIds.add(nativeId);
    ctx.stats.entries.lake++;
    const { rec, withheld, truncated } = entryRecord(row, ctx);
    ctx.stats.entries.projected++;
    if (withheld === 'sealed_document') ctx.stats.entries.withheld_sealed_document++;
    if (withheld === 'sealed_or_restricted_text') ctx.stats.entries.withheld_text++;
    if (truncated) ctx.stats.entries.truncated++;
    bump(byMdl, rec.filters.mdl); bump(years, rec.filters.year || 'undated'); bump(avail, rec.filters.availability);
    records.push(rec);
  }
  if (nativeEntryIds) {
    const missing = [...nativeEntryIds].filter(id => !foundNativeEntryIds.has(id));
    if (missing.length) throw new Error(`Requested CourtListener docket-entry IDs were not found within the validated master docket scopes: ${missing.join(', ')}`);
  }
  // entries of CourtListener-blocked dockets from the remaining routes (registry external-entry entities)
  const seenExt = new Set();
  if (!nativeEntryIds) {
    for await (const row of lakePages('external-entries', { p_ids: mdls.map(m => `mdl:${m}`) })) {
      if (seenExt.has(row.native_id)) continue; seenExt.add(row.native_id);
      const ctx = ctxByMdl.get(String(row.data.matter).replace(/^mdl:/, ''));
      if (!ctx) continue;
      const { rec, withheld, truncated } = externalEntryRecord(row, ctx);
      ctx.stats.entries.external[row.data.provider] = (ctx.stats.entries.external[row.data.provider] ?? 0) + 1;
      ctx.stats.entries.projected++;
      if (withheld === 'sealed_or_restricted_text') ctx.stats.entries.withheld_text++;
      if (truncated) ctx.stats.entries.truncated++;
      bump(byMdl, rec.filters.mdl); bump(years, rec.filters.year || 'undated'); bump(avail, rec.filters.availability);
      records.push(rec);
    }
  }
  const metadata = {
    grain: 'One docket entry of a master docket (CourtListener docket-entries)', aliases: [DS_ENTRIES, 'sw-docket-entries'], source_system: 'sw-matter-registry', schema_version: SCHEMA, source_runs: [run],
    qualification: 'Docket entries of the registry master dockets as the court record shows them; descriptions clipped to 500 characters; entries with sealed documents or sealed/restricted/in camera/ex parte/redacted text are shown without description; blocked dockets are not projected. Collection is quota-bound, so a docket can be partial (see the matter registry entries coverage). Not legal advice.',
    privacy_policy: 'Show as published (owner decision 2026-10-03) excluding sealed, restricted, in camera, ex parte and redacted material, entries carrying a document flagged sealed, and source-blocked dockets. No contact fields.',
    listing: { columns: [{ key: 'entry_number', label: 'Entry' }, { key: 'date_filed', label: 'Filed' }, { key: 'description', label: 'Description' }, { key: 'documents', label: 'Documents' }, { key: 'availability', label: 'PDF in RECAP' }, { key: 'docket_number', label: 'Docket' }],
      filters: [{ name: 'mdl', type: 'select', label: 'MDL', options: opt(byMdl, v => `MDL ${v}`), placeholder: 'All MDLs' }, { name: 'year', type: 'select', label: 'Year filed', options: opt(years), placeholder: 'All years' }, { name: 'availability', type: 'select', label: 'PDF in RECAP', options: opt(avail), placeholder: 'Any' }] },
  };
  records.sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  const res = await syncDataset(DS_ENTRIES, 'Seeger Weiss matter registry \u2014 docket entries of master dockets', records, metadata);
  summary.entries = { records: records.length, ...res };
}
if (only === 'all' || only === 'parties') {
  const partyRows = [];
  const seen = new Set();
  for await (const row of lakePages('parties', { p_docket_ids: allDocketIds })) { if (!seen.has(row.native_id)) { seen.add(row.native_id); partyRows.push(row); } }
  const attyIds = new Set();
  for (const row of partyRows) for (const a of row.data.attorneys ?? []) if (ctxByDocket.has(String(a.docket_id))) attyIds.add(String(a.attorney_id));
  const attorneyMap = await loadAttorneys(attyIds);
  const records = partyRecords(partyRows, attorneyMap);
  const byMdl = {}; const types = {};
  for (const r of records) { bump(byMdl, r.filters.mdl); for (const t of r.filters.party_type) bump(types, t); }
  const metadata = {
    grain: 'One party on a master docket with its counsel of record (CourtListener parties and attorneys)', aliases: [DS_PARTIES, 'sw-matter-parties'], source_system: 'sw-matter-registry', schema_version: SCHEMA, source_runs: [run],
    qualification: 'Parties and counsel of the registry master dockets as the court record shows them. Counsel is name, firm and role only. Collection is quota-bound, so a docket can be partial (see the matter registry party coverage). Not legal advice.',
    privacy_policy: 'Show as published (owner decision 2026-10-03): party names are published as the court record shows them unless sealed, restricted, in camera, ex parte or redacted; counsel name + firm + role only; no addresses, phones, faxes or emails; counsel flagged "Attorney in sealed group" omitted.',
    listing: { columns: [{ key: 'party_name', label: 'Party' }, { key: 'party_types', label: 'Type' }, { key: 'counsel_count', label: 'Counsel' }, { key: 'docket_number', label: 'Docket' }, { key: 'mdl', label: 'MDL' }],
      filters: [{ name: 'mdl', type: 'select', label: 'MDL', options: opt(byMdl, v => `MDL ${v}`), placeholder: 'All MDLs' }, { name: 'party_type', type: 'select', label: 'Party type', options: opt(types), placeholder: 'All types' }, { name: 'has_counsel', type: 'select', label: 'Has counsel', options: [{ value: 'true', label: 'With counsel' }, { value: 'false', label: 'Without counsel' }], placeholder: 'Any' }] },
  };
  records.sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  const res = await syncDataset(DS_PARTIES, 'Seeger Weiss matter registry \u2014 parties and counsel of master dockets', records, metadata);
  summary.parties = { records: records.length, attorneys_read: attorneyMap.size, attorneys_asked: attyIds.size, ...res };
}
for (const c of ctxs) summary.matters[c.mdl] = { docket_key: c.docket_key, cl_docket_ids: c.cl_ids, blocked_cl_docket_ids: c.blocked_ids, ...c.stats };
const summaryFile = path.join(staging, 'extras-summary.json');
let prev = {}; try { prev = JSON.parse(fs.readFileSync(summaryFile, 'utf8')); } catch { /* first run */ }
const merged = { ...prev, ...summary, matters: { ...(prev.matters ?? {}) } };
for (const [m, s] of Object.entries(summary.matters)) {
  const old = merged.matters[m] ?? {};
  merged.matters[m] = { ...old, ...s, entries: only === 'parties' && old.entries ? old.entries : s.entries, parties: only === 'entries' && old.parties ? old.parties : s.parties };
}
if (!dry) fs.writeFileSync(summaryFile, JSON.stringify(merged, null, 1));
else for (const [m, s] of Object.entries(summary.matters)) console.log(JSON.stringify({ mdl: m, entries: s.entries, parties: s.parties }));
console.log(JSON.stringify({ event: 'extras_done', dry, only, entries: summary.entries?.records ?? null, parties: summary.parties?.records ?? null }));
