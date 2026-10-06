/**
 * Federal Register continuation: pure helpers (no network, no credentials).
 *
 * Source: the official FederalRegister.gov API v1. Selection is every document
 * the API lists for a publication date (all agencies, all types), the same
 * criteria as the `federal_register_history` collection (1994-01-03 onward).
 */
import { createHash } from 'node:crypto';
import { canonicalIntegerJson } from '../../admin/local-catalog-evidence-contract.mjs';

export const SOURCE_SYSTEM = 'federalregister';
export const ENTITY_TYPE = 'documents';
export const SCHEMA_VERSION = 'federal-register-metadata/2';
export const CONTRACT = 'federal-register-intake/1';
export const DATASET = 'federal_register_history';
export const API_ORIGIN = 'https://www.federalregister.gov';

/** Superset of the `federal-register-metadata/1` fields used for regulatory_backfill. */
export const FIELDS = [
  'document_number', 'title', 'type', 'publication_date', 'effective_on', 'dates', 'citation',
  'html_url', 'pdf_url', 'raw_text_url', 'agencies', 'cfr_references', 'related_documents',
  'correction_of', 'corrections', 'regulation_id_numbers', 'docket_ids', 'start_page', 'end_page',
];

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const recordSha256 = (data) => sha256(canonicalIntegerJson(data));

export function isoDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error(`Invalid ISO date: ${date}`);
  return date;
}
export const addDays = (date, n) => new Date(Date.parse(isoDay(date)) + n * 86400000).toISOString().slice(0, 10);
export function* eachDay(from, through) {
  for (let d = isoDay(from); d <= isoDay(through); d = addDays(d, 1)) yield d;
}

export function dayUrl(day, page, perPage = 1000) {
  const u = new URL(`${API_ORIGIN}/api/v1/documents.json`);
  u.searchParams.set('per_page', String(perPage));
  u.searchParams.set('page', String(page));
  u.searchParams.set('order', 'oldest');
  u.searchParams.set('conditions[publication_date][gte]', day);
  u.searchParams.set('conditions[publication_date][lte]', day);
  for (const f of FIELDS) u.searchParams.append('fields[]', f);
  return u.href;
}

/** Keep only the retained fields, in a fixed key set, preserving the API's values exactly. */
export function pickFields(row) {
  const data = {};
  for (const f of FIELDS) data[f] = row[f] === undefined ? null : row[f];
  return data;
}

export function entityRow(row, page, asOf) {
  if (typeof row.document_number !== 'string' || !row.document_number.trim()) throw new Error('Missing native document number');
  const data = pickFields(row);
  return {
    source_system: SOURCE_SYSTEM,
    entity_type: ENTITY_TYPE,
    native_id: row.document_number,
    schema_version: SCHEMA_VERSION,
    data,
    provenance: {
      source_url: page.url,
      retrieved_at: page.retrieved_at,
      source_sha256: page.sha256,
      http_status: 200,
      record_sha256: recordSha256(data),
      record_hash_codec: 'canonical-integer-jsonb/1',
      schema_version: SCHEMA_VERSION,
      source_as_of: asOf,
    },
  };
}

/** Split into bounded groups (the intake function accepts at most 10,000 rows / 2 MiB). */
export function splitBounded(rows, maxRows = 500, maxBytes = 1500000) {
  const groups = [];
  let group = [];
  let bytes = 2;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (size + 2 > maxBytes) throw new Error('A single row exceeds the bounded intake size; hold without truncation');
    if (group.length && (group.length >= maxRows || bytes + size > maxBytes)) {
      groups.push(group);
      group = [];
      bytes = 2;
    }
    group.push(row);
    bytes += size;
  }
  if (group.length) groups.push(group);
  return groups;
}

/* ---------- projection to public.corpus_records (federal_register_history shape) ---------- */

const uniq = (xs) => [...new Set(xs)];
const names = (agencies) => uniq((agencies ?? []).map((a) => a.name ?? a.raw_name).filter(Boolean));
const cfrLabel = (r) => (r.part != null ? `${r.title} CFR ${r.part}` : r.chapter != null ? `${r.title} CFR chapter ${r.chapter}` : `${r.title} CFR`);
/** The existing collection prints at most this many docket identifiers per document. */
export const MAX_DOCKETS_PRINTED = 12;
/** Listing cell shows this many CFR parts then an ellipsis; the detail page links this many parts. */
export const MAX_CFR_CELL = 4;
export const MAX_CFR_LINKS = 6;
export const MAX_SUBTITLE_AGENCIES = 3;
export const MAX_TITLE_CHARS = 600;
const citationWithPages = (d) => {
  if (!d.citation || d.start_page == null || d.end_page == null) return d.citation;
  return `${d.citation} (pages ${d.start_page === d.end_page ? d.start_page : `${d.start_page}-${d.end_page}`})`;
};

/** Newest first: publication date, then first page, then document number, all descending. */
export function compareNewestFirst(a, b) {
  return (
    (a.publication_date < b.publication_date) - (a.publication_date > b.publication_date) ||
    (b.start_page ?? 0) - (a.start_page ?? 0) ||
    (a.document_number < b.document_number) - (a.document_number > b.document_number)
  );
}

/**
 * Per-row qualification. Same sentence form as the ledgered 2026-10-06 rewrite of the
 * historical rows: the collection is continued daily, so a row never claims that later
 * documents are absent from the collection; only its own collection date bounds it.
 */
export const GOVINFO_LABEL = 'Official GovInfo edition (not downloaded)';

/**
 * Official edition locator, only from the retained API `pdf_url` (never derived from a pattern:
 * the publisher lists no PDF for some early documents, e.g. 1994). Last entry of detail.links,
 * the position the 2026-10-06 carry-over used.
 */
export function govinfoLink(d) {
  const url = d.pdf_url;
  if (typeof url !== 'string' || !url) return null;
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  if (host !== 'www.govinfo.gov') return null;
  return { url, label: GOVINFO_LABEL };
}

export function qualification(from, through, collected) {
  return `Federal Register documents published ${from} to ${through} as listed by the federalregister.gov API and GovInfo when the index was collected on ${collected}. Later publication days are added from daily collections; each document's own "Index collected" fact gives its collection date. CFR parts, agencies, docket identifiers and RINs are the ones the API lists for each document; a correction issued after a document's collection date is not included in it. A document that cites a CFR part may propose, amend, correct or merely discuss it: read the document.`;
}

/** The sentence form the collection used before the 2026-10-06 rewrite (kept for verification and rollback only). */
export function legacyQualification(from, through, collected) {
  return `Federal Register documents published ${from} to ${through} as listed by the federalregister.gov API and GovInfo when the index was collected on ${collected}. CFR parts, agencies, docket identifiers and RINs are the ones the API lists for each document; documents published later, and any later correction, are not included. A document that cites a CFR part may propose, amend, correct or merely discuss it: read the document.`;
}

/**
 * Build the corpus_records row. `ordinal` and `id` are assigned by the caller
 * (id + ordinal is constant for the collection; lower ordinal = newer).
 */
export function projectRecord(d, { id, ordinal, collected, coverage }) {
  const num = d.document_number;
  const cfr = d.cfr_references ?? [];
  const cfrText = uniq(cfr.map(cfrLabel));
  const subtitle = names(d.agencies).slice(0, MAX_SUBTITLE_AGENCIES).join(' \u00b7 ');
  const rins = d.regulation_id_numbers ?? [];
  const dockets = (d.docket_ids ?? []).slice(0, MAX_DOCKETS_PRINTED);
  const url = `${API_ORIGIN}/d/${num}`;
  const cells = { cfr: cfrText.length > MAX_CFR_CELL ? `${cfrText.slice(0, MAX_CFR_CELL).join(', ')} \u2026` : cfrText.join(', '), type: d.type, citation: d.citation, published: d.publication_date };
  const badges = [d.type, ...rins.slice(0, 1).map((r) => `RIN ${r}`), ...(d.correction_of ? ['Correction'] : [])];
  const title = d.title.slice(0, MAX_TITLE_CHARS);
  const facts = [
    ['Document number', num],
    ['Published in the Federal Register', d.publication_date],
    ['Type', d.type],
    ['Citation', citationWithPages(d)],
  ];
  if (names(d.agencies).length) facts.push(['Agencies (as listed by the API)', names(d.agencies).join('; ')]);
  if (cfrText.length) facts.push(['CFR parts cited', cfrText.join('; ')]);
  if (rins.length) facts.push(['Regulation Identifier Numbers (RIN)', rins.join('; ')]);
  if (dockets.length) facts.push(['Docket identifiers (as printed)', dockets.join('; ')]);
  if (d.correction_of) facts.push(['Corrects document', d.correction_of]);
  if (d.corrections?.length) facts.push(['Corrected by', d.corrections.join('; ')]);
  facts.push(['Index collected', `${collected} (federalregister.gov API and GovInfo)`]);
  const links = [{ url, label: 'Open on federalregister.gov' }];
  if (d.raw_text_url) links.push({ url: d.raw_text_url, label: 'Plain text (federalregister.gov)' });
  const linked = uniq(cfr.filter((x) => x.part != null).map((x) => `${x.title}\u0000${x.part}`)).slice(0, MAX_CFR_LINKS);
  for (const key of linked) {
    const [title, part] = key.split('\u0000');
    const r = { title, part };
    links.push({ url: `#federal-register?cfr_title=${r.title}&cfr_part=${r.part}`, label: `Other documents citing ${cfrLabel(r)}` });
  }
  const qual = qualification(coverage.from, coverage.through, collected);
  // Search text is built before the GovInfo link is appended: the enriched rows (carry-over from
  // regulatory_backfill) carry that link in detail.links only, and the label is not search content.
  const text = [title, subtitle, ...facts.flat(), '', ...links.map((l) => l.label), qual].join(' ');
  const govinfo = govinfoLink(d);
  if (govinfo) links.push(govinfo);
  const item = { id, cells, links: [links[0]], title, badges, subtitle };
  const detail = { facts, links, title, sections: [], subtitle, qualification: qual };
  const filters = {
    type: [d.type],
    year: [d.publication_date.slice(0, 4)],
    agency: uniq((d.agencies ?? []).filter((a) => a.id != null).map((a) => String(a.id))),
    _listing: ['yes'],
    cfr_pair: uniq(cfr.filter((r) => r.part != null).map((r) => `${r.title}:${r.part}`)),
    cfr_title: uniq(cfr.filter((r) => r.part != null).map((r) => String(r.title))),
  };
  return {
    dataset: DATASET, id, category: DATASET, state: '', county_geoids: [], title,
    source_url: url, ordinal, item, detail, text, filters,
  };
}
