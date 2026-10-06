// Builds one sw_docket_entries_v1 record from a CourtListener docket-entries lake row (contract sw-matter-registry/1 v1.3).
// Extracted unchanged from members-project-extras.mjs so every projector builds entry rows with the identical show-as-published rules
// (descriptions clipped to 500 characters; sealed documents and sealed/restricted/in camera/ex parte/redacted text withheld).
import { ws, excluded, hasContact, clipDescription, entryOrdinal } from './members-publish-rules.mjs';

/** env = {run, SCHEMA, DS_ENTRIES, finish, masterLink, matterLink, clDocketUrl} */
export function makeEntryRecord(row, ctx, env) {
  const { run, SCHEMA, DS_ENTRIES, finish, masterLink, matterLink, clDocketUrl } = env;
  const d = row.data;
  const clDocketId = (d.docket ?? '').match(/\/dockets\/(\d+)\//)?.[1] ?? null;
  const entryNumber = Number.isInteger(d.entry_number) ? d.entry_number : null;
  const docs = Array.isArray(d.recap_documents) ? d.recap_documents : [];
  const raw = ws(d.description);
  const sealedDocs = docs.filter(x => x.is_sealed === true).length;
  const textHit = excluded(raw);
  // A description carrying a contact field (phone, email) or hearing access data is withheld as published (rule observed on every live row so flagged).
  const contactHit = !textHit && hasContact(raw);
  const withheld = sealedDocs ? 'sealed_document' : textHit ? 'sealed_or_restricted_text' : contactHit ? 'contact_or_access_data' : null;
  const clip = clipDescription(raw, 500);
  const held = !!withheld && withheld !== 'contact_or_access_data';
  const description = withheld || !raw ? null : clip.text;
  const availableDocs = docs.filter(x => x.is_available === true && x.is_sealed !== true).length;
  const availability = docs.length === 0 ? 'no_documents' : sealedDocs ? 'includes_sealed' : availableDocs === docs.length ? 'recap_available' : availableDocs > 0 ? 'recap_partly_available' : docs.some(x => x.is_available == null) ? 'unknown' : 'recap_unavailable';
  const documents = withheld === 'sealed_document' ? [] : docs.map(x => ({ native_document_id: String(x.id), document_number: x.document_number ?? null, attachment_number: x.attachment_number ?? null, description: excluded(x.description) ? null : (ws(x.description) || null), description_withheld: excluded(x.description) ? 'sealed_or_restricted_text' : null, page_count: x.page_count ?? null, is_available: x.is_available ?? null, is_sealed: x.is_sealed ?? null }));
  const firstUrl = withheld === 'sealed_document' ? null : (docs.find(x => x.absolute_url)?.absolute_url ?? null);
  const entryUrl = firstUrl ? `https://www.courtlistener.com${firstUrl}` : clDocketUrl(clDocketId);
  const id = `sw-entry:courtlistener:${row.native_id}`;
  const dateFiled = d.date_filed ?? null;
  const numLabel = entryNumber != null ? `Entry ${entryNumber}` : 'Unnumbered entry';
  const title = description ? `${numLabel} \u2014 ${description.length > 110 ? description.slice(0, 109) + '\u2026' : description}` : `${numLabel} \u2014 description ${withheld ? 'withheld' : 'not recorded'}`;
  const subtitle = `${ctx.docket_number} (${ctx.court_id}) \u00b7 MDL ${ctx.mdl} \u00b7 filed ${dateFiled ?? 'not recorded'}`;
  const cells = {
    mdl: String(ctx.mdl), docket_key: ctx.docket_key, docket_number: ctx.docket_number, court_id: ctx.court_id, provider: 'courtlistener', native_entry_id: String(row.native_id), native_docket_id: clDocketId,
    entry_number: entryNumber, date_filed: dateFiled, time_filed: d.time_filed ?? null, description, description_chars: clip.chars, description_truncated: clip.truncated && !withheld, description_withheld: withheld,
    documents: docs.length, documents_available: availableDocs, documents_sealed: sealedDocs, availability,
    // v1.3 additive: exact provider document ids (CourtListener RECAP document ids; never for a held entry or a sealed document), the held flag and the entry link as a cell
    document_ids: held ? [] : docs.filter(x => x.is_sealed !== true).map(x => String(x.id)), held, source_url: entryUrl,
  };
  const badges = ['Docket entry', ...(availability === 'recap_available' ? ['Free PDF in RECAP'] : availability === 'recap_partly_available' ? ['Some PDFs in RECAP'] : docs.length ? ['Metadata only'] : []), ...(withheld ? ['Description withheld'] : [])];
  const links = [{ url: entryUrl, label: 'CourtListener entry' }, ...(ctx.no_registry_links ? [] : [{ url: masterLink(ctx), label: 'Master docket in the matter registry' }, { url: matterLink(ctx), label: 'Matter' }])];
  const facts = [['MDL', String(ctx.mdl)], ['Docket', `${ctx.docket_number} (${ctx.court_id})`], ['Entry number', entryNumber != null ? String(entryNumber) : 'Not numbered'], ['Filed', dateFiled ?? 'Not recorded'],
    ['Description', description ?? (withheld === 'contact_or_access_data' ? 'Withheld (the text carries contact or hearing access data)' : withheld ? 'Withheld (sealed, restricted or redacted in the court record)' : 'Not recorded')], ['Documents', `${docs.length}${docs.length ? ` (${availableDocs} with a PDF in RECAP)` : ''}`], ['Provider', 'CourtListener docket-entries'], ['Native entry id', String(row.native_id)]];
  if (clip.truncated && !withheld) facts.push(['Description length', `${clip.chars} characters in the record; first 499 shown`]);
  const sections = documents.length ? [{ heading: 'Documents', header: ['Number', 'Attachment', 'Description', 'Pages', 'PDF in RECAP', 'CourtListener document id'], rows: documents.map(x => [x.document_number ?? '', x.attachment_number ?? '', x.description ?? (x.description_withheld ? 'Withheld' : ''), x.page_count ?? '', x.is_available === true ? 'yes' : x.is_available === false ? 'no' : 'unknown', x.native_document_id]) }] : [];
  const rec = {
    dataset: DS_ENTRIES, id, category: 'sw_docket_entry', state: null, county_geoids: [], title, source_url: entryUrl, ordinal: entryOrdinal(ctx.mdl, dateFiled, entryNumber),
    item: { id, cells, links, title, badges, subtitle },
    detail: { id, title, subtitle, facts, links, sections,
      registry: { schema: 'sw-matter-registry/1', mdl: String(ctx.mdl), docket_key: ctx.docket_key, native_case_ids: [{ provider: 'courtlistener', source_system: 'courtlistener', id: clDocketId }], entry: { provider: 'courtlistener', native_entry_id: String(row.native_id), entry_number: entryNumber, date_filed: dateFiled, time_filed: d.time_filed ?? null, recap_sequence_number: d.recap_sequence_number ?? null, pacer_sequence_number: d.pacer_sequence_number ?? null }, description_withheld: withheld, documents },
      provenance: { source_system: 'courtlistener', source_entity_type: 'docket-entries', source_native_id: String(row.native_id), source_record_sha256: row.payload_sha256, retrieved_at: row.retrieved_at, run_ids: [run], projection_schema: SCHEMA },
      qualification: 'One docket entry as the court record shows it (CourtListener docket-entries). Descriptions are clipped to 500 characters. Entries that carry a document flagged sealed, or whose text is sealed, restricted, in camera, ex parte or redacted, are shown without description. Not legal advice; the PDF read API holds the documents.' },
    text: [description ?? '', entryNumber ?? '', ctx.docket_number, `MDL ${ctx.mdl}`, dateFiled ?? ''].join(' ').replace(/\s+/g, ' ').trim(),
    filters: { _listing: 'true', native_id: String(row.native_id), mdl: String(ctx.mdl), docket_key: ctx.docket_key, native_docket_id: clDocketId, provider: 'courtlistener', year: dateFiled ? dateFiled.slice(0, 4) : '', availability, has_documents: docs.length ? 'true' : 'false', description_withheld: withheld ? 'true' : 'false' },
  };
  return { rec: finish(rec), withheld, truncated: clip.truncated && !withheld };
}
