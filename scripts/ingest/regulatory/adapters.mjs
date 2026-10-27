/** Official source adapters. Window completeness is source-specific, never whole-world coverage. */
import { allowedUrl, anchors, htmlText, record, requireValue, sourceDate, MonitorError, uniqueRecords, payloadHash } from './core.mjs';
import { FIELDS as FR_FIELDS } from '../federal-register/lib.mjs';
import { collectCpscRss, CPSC_RSS_QUALIFICATION } from './cpsc.mjs';

export const FDA_NOTICES = 'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts';
export const FDA_WARNINGS = 'https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/compliance-actions-and-activities/warning-letters';
export const SOURCES = {
  fda_recall_notices: { hosts: ['www.fda.gov'], hours: 6, publisher_cadence: 'Event-driven; no publication SLA', mode: 'fda', url: FDA_NOTICES, qualification: 'FDA-published recall announcements; not all FDA recalls have an announcement. Published scope and revisions are retained; no causation or liability inference.' },
  fda_warning_letters: { hosts: ['www.fda.gov'], hours: 24, publisher_cadence: 'Posted after issue; no publication SLA', mode: 'fda', url: FDA_WARNINGS, qualification: 'Published warning letters and linked responses/closeouts; issue date differs from posted date. Allegations and subsequent regulatory status require review.' },
  openfda_enforcement_drug: { hosts: ['api.fda.gov', 'www.accessdata.fda.gov'], hours: 24, publisher_cadence: 'Weekly source refresh', mode: 'openfda', category: 'drug' },
  openfda_enforcement_device: { hosts: ['api.fda.gov', 'www.accessdata.fda.gov'], hours: 24, publisher_cadence: 'Weekly source refresh', mode: 'openfda', category: 'device' },
  openfda_enforcement_food: { hosts: ['api.fda.gov', 'www.accessdata.fda.gov'], hours: 24, publisher_cadence: 'Weekly source refresh', mode: 'openfda', category: 'food' },
  cpsc_recalls: { hosts: ['www.saferproducts.gov', 'www.cpsc.gov', 'cpsc.gov'], hours: 6, publisher_cadence: 'Event-driven recent RSS; no freshness SLA', mode: 'cpsc', qualification: CPSC_RSS_QUALIFICATION },
  federal_register: { hosts: ['www.federalregister.gov', 'www.govinfo.gov'], hours: 24, publisher_cadence: 'Publication-day API; revisions can occur later', mode: 'fr', qualification: 'Official FederalRegister.gov API metadata and explicit correction links within a rolling publication window. Full document text is not captured by this adapter; older changes outside the window require reconciliation.' },
  nhtsa_recalls: { hosts: ['static.nhtsa.gov', 'www.nhtsa.gov', 'api.nhtsa.gov'], hours: 24, publisher_cadence: 'Daily bulk release', mode: 'nhtsa', qualification: 'Official post-2010 recall bulk file; campaign/product associations remain distinct. A recall is not a finding about individual injury or liability.' },
  nhtsa_investigations: { hosts: ['static.nhtsa.gov', 'www.nhtsa.gov'], hours: 24, publisher_cadence: 'Dated official bulk releases', mode: 'nhtsa', qualification: 'Official investigation bulk file; opening and closing dates differ. An investigation is not a final defect determination.' },
};
for (const s of Object.values(SOURCES)) if (s.mode === 'openfda') s.qualification = 'Weekly openFDA enforcement research enrichment, limited to records with publisher-assigned recall numbers. Unnumbered rows remain in retained raw captures and are withheld from projection. FDA says this dataset is not for current public alerts or recall lifecycle tracking; status is not continuously updated after classification.';

export function drupalSettings(html) {
  const match = html.match(/<script\b[^>]*data-drupal-selector=["']drupal-settings-json["'][^>]*>([\s\S]*?)<\/script>/i);
  requireValue(match, 'FDA_SETTINGS_MISSING');
  try { return JSON.parse(match[1]); } catch { throw new MonitorError('FDA_SETTINGS_INVALID'); }
}
export function fdaTableConfig(html, source) {
  const settings = drupalSettings(html); const tables = Object.values(settings.datatables ?? {});
  const expected = source === 'fda_warning_letters' ? 'warning_letter_solr_index' : 'recall_solr_index';
  const table = tables.find((t) => t.ajax?.data?.view_name === expected);
  requireValue(table?.serverSide === true && table.ajax.type === 'GET' && table.aoColumnHeaders?.length === 8, 'FDA_TABLE_SCHEMA_CHANGED');
  requireValue(table.ajax.url === '/datatables/views/ajax' && Number.isSafeInteger(table.deferLoading), 'FDA_TABLE_SCHEMA_CHANGED');
  return table;
}
export function fdaPageUrl(table, start, length) {
  const u = new URL(table.ajax.url, 'https://www.fda.gov');
  for (const [key, value] of Object.entries(table.ajax.data)) { requireValue(['string', 'number'].includes(typeof value)); u.searchParams.set(key, String(value)); }
  for (const [key, value] of Object.entries({ draw: 1, start, length, 'order[0][column]': 0, 'order[0][dir]': 'desc' })) u.searchParams.set(key, String(value));
  return u.href;
}
export function parseFdaPage(json, source) {
  requireValue(json && Number.isSafeInteger(json.recordsFiltered) && json.recordsFiltered >= 0 && Number.isSafeInteger(json.recordsTotal) && json.recordsTotal >= json.recordsFiltered && Array.isArray(json.data), 'FDA_PAGE_SCHEMA_CHANGED');
  const warning = source === 'fda_warning_letters';
  return json.data.map((cells, index) => {
    requireValue(Array.isArray(cells) && cells.length === 8 && cells.every((c) => typeof c === 'string'), 'FDA_ROW_SCHEMA_CHANGED');
    const link = anchors(cells[warning ? 2 : 1], 'https://www.fda.gov', ['www.fda.gov']);
    requireValue(link.length === 1 && new URL(link[0].url).pathname.startsWith(warning ? '/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/' : '/safety/recalls-market-withdrawals-safety-alerts/'), 'FDA_RECORD_LINK_INVALID');
    const date = sourceDate(htmlText(cells[0])); requireValue(date, 'FDA_POSTED_DATE_MISSING');
    return { date, url: link[0].url, label: link[0].label, cells: cells.map(htmlText), links: warning ? [...anchors(cells[5], 'https://www.fda.gov', ['www.fda.gov']), ...anchors(cells[6], 'https://www.fda.gov', ['www.fda.gov'])] : [], index };
  });
}
export function fdaDetailData(html, listed, source) {
  const article = html.match(/<article\b[^>]*id=["']main-content["'][^>]*>([\s\S]*?)<\/article>/i);
  const title = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const native = drupalSettings(html).path?.currentPath;
  requireValue(article && title && /^node\/\d+$/.test(native ?? ''), 'FDA_DETAIL_SCHEMA_CHANGED');
  const text = htmlText(article[1]); requireValue(text.length > 100 && text.length <= 150000, 'FDA_DETAIL_TEXT_INVALID');
  const warning = source === 'fda_warning_letters';
  return { native_id: native, title: htmlText(title[1]), document_type: warning ? 'warning_letter' : 'recall_notice', published_on: listed.date, source_updated_on: listed.date, source_url: listed.url, agency_ids: ['fda'], agency_names: ['Food and Drug Administration'], identifiers: [native], evidence_excerpt: text.slice(0, 1800), fields: { notice_text: text, text_scope: 'Published main article, including publisher headings and qualifications; links remain in original HTML.', table_cells: listed.cells, response_closeout_links: listed.links, date_basis: warning ? 'FDA table Posted Date; source issue date separately recorded' : 'FDA announcement table Date; not occurrence date', issue_date: warning ? sourceDate(listed.cells[1]) : null, qualification: SOURCES[source].qualification } };
}
export async function collectFda(client, source, options) {
  const index = await client.capture(SOURCES[source].url, 'html'); const table = fdaTableConfig(index.text, source);
  async function scan() {
    const selected = []; let total = null; let scanned = 0; let boundary = false; let previousDate = '9999-12-31';
    for (let page = 0; page < options.maxPages; page++) {
      const captured = await client.capture(fdaPageUrl(table, page * 100, 100)); const json = captured.json;
      const rows = parseFdaPage(json, source); total ??= json.recordsFiltered;
      requireValue(total === json.recordsFiltered, 'SOURCE_COUNT_CHANGED');
      requireValue(rows.length === Math.min(100, Math.max(0, total - page * 100)), 'SOURCE_PAGE_TRUNCATED');
      for (const row of rows) {
        requireValue(row.date <= previousDate, 'SOURCE_ORDER_INVALID'); previousDate = row.date; scanned++;
        if (row.date < options.from) { boundary = true; continue; }
        if (row.date <= options.through) selected.push(row);
      }
      requireValue(selected.length <= options.maxRecords, 'SOURCE_RECORD_CAP');
      if (boundary || scanned === total) { boundary = true; break; }
    }
    requireValue(boundary, 'SOURCE_PAGE_CAP');
    uniqueRecords(selected.map((r) => ({ data: { native_id: r.url }, payload_sha256: payloadHash(r.cells) })));
    return { selected, total, scanned };
  }
  const first = await scan(); const check = await scan();
  const signature = (selected) => payloadHash(selected.map((r) => ({ url: r.url, cells: r.cells })).sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  // FDA's global cached count and tie order can differ between servers. Prove the ENTIRE
  // selected date-window set twice; changes outside that scope do not invalidate its proof.
  requireValue(signature(first.selected) === signature(check.selected), 'SOURCE_CHANGED_DURING_RUN');
  const rows = [];
  for (const selectedRow of first.selected) {
    const detail = await client.capture(selectedRow.url, 'html');
    rows.push(record(fdaDetailData(detail.text, selectedRow, source), detail, 'article#main-content'));
  }
  return { rows: uniqueRecords(rows), expected: rows.length, scope: { date_basis: 'FDA table posted/change date', selection: 'complete date-window native URL/content set verified in two independent scans', full_history: false, publisher_index_cached_total: table.deferLoading, publisher_api_totals: [first.total, check.total], scanned_records: [first.scanned, check.scanned], boundary_verified: true, publisher_total_discrepancy: table.deferLoading !== first.total || first.total !== check.total, qualification: SOURCES[source].qualification } };
}

export function normalizeEnforcement(row, category) {
  requireValue(row && typeof row.recall_number === 'string' && row.recall_number.length && typeof row.event_id === 'string' && typeof row.product_description === 'string' && typeof row.reason_for_recall === 'string', 'OPENFDA_RECORD_INVALID');
  const u = new URL(`https://api.fda.gov/${category}/enforcement.json`); u.searchParams.set('search', `recall_number:"${row.recall_number}"`);
  // No harmonized terminology is copied into application data. Original source bytes remain private.
  const fields = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'openfda'));
  const data = enforcementData(row, category, u, fields);
  // Device lot/serial lists (more_code_info) can run to 500 KB. Only an oversized record is shortened, longest field
  // first, and each cut is recorded; the complete published record stays in the private raw capture.
  const shortened = [];
  for (const key of Object.keys(fields).filter((k) => typeof fields[k] === 'string').sort((a, b) => fields[b].length - fields[a].length || (a < b ? -1 : 1))) {
    if (Buffer.byteLength(JSON.stringify(data)) <= OPENFDA_PAYLOAD_LIMIT || fields[key].length <= OPENFDA_FIELD_KEEP) break;
    shortened.push({ field: key, kept_chars: OPENFDA_FIELD_KEEP, published_chars: fields[key].length });
    fields[key] = fields[key].slice(0, OPENFDA_FIELD_KEEP);
    data.fields.shortened_publisher_fields = shortened;
  }
  return data;
}
const OPENFDA_PAYLOAD_LIMIT = 170000; // under the 180000-byte record cap in core.mjs record()
const OPENFDA_FIELD_KEEP = 20000;
function enforcementData(row, category, u, fields) {
  return { native_id: row.recall_number, title: `${row.recalling_firm || row.recall_number}: ${row.product_description}`.slice(0, 1900), document_type: 'recall_enforcement', published_on: sourceDate(row.report_date), source_updated_on: null, source_url: u.href, agency_ids: ['fda'], agency_names: ['Food and Drug Administration'], entity_refs: [{ namespace: `openfda:${category}:event`, native_id: row.event_id, label: row.event_id }], identifiers: [row.recall_number, `event:${row.event_id}`], status: row.status ?? null, evidence_excerpt: row.reason_for_recall.slice(0, 1800), fields: { publisher_record: fields, event_id: row.event_id, recall_initiation_date: sourceDate(row.recall_initiation_date), date_basis: 'FDA report date; initiation date separately retained', qualification: SOURCES[`openfda_enforcement_${category}`].qualification } };
}
export async function collectOpenFda(client, source, options) {
  const category = SOURCES[source].category; const rows = []; const withheld = []; let fetched = 0; let total = null; let release = null; let firstSignature;
  function url(skip) { const u = new URL(`https://api.fda.gov/${category}/enforcement.json`); u.searchParams.set('search', `report_date:[${options.from.replaceAll('-', '')} TO ${options.through.replaceAll('-', '')}]`); u.searchParams.set('limit', '100'); u.searchParams.set('skip', String(skip)); u.searchParams.set('sort', 'report_date:asc'); return u.href; }
  for (let page = 0; page < options.maxPages; page++) {
    requireValue(page * 100 <= 25000, 'SOURCE_PAGINATION_LIMIT');
    const c = await client.capture(url(page * 100), 'json', { acceptedStatuses: [404] }); const j = c.json;
    if (c.receipt.http_status === 404) {
      requireValue(page === 0 && j?.error?.code === 'NOT_FOUND' && j.error.message === 'No matches found!', 'OPENFDA_ERROR_RESPONSE');
      const check = await client.capture(url(0), 'json', { acceptedStatuses: [404] });
      requireValue(check.receipt.http_status === 404 && payloadHash(check.json) === payloadHash(j), 'SOURCE_CHANGED_DURING_RUN');
      return { rows: [], expected: 0, scope: { date_basis: 'report_date', selection: 'Exact bounded query returned documented No matches found response twice', full_history: false, zero_match_response_verified: true, qualification: SOURCES[source].qualification } };
    }
    requireValue(Number.isSafeInteger(j?.meta?.results?.total) && j.meta.results.total >= 0 && Array.isArray(j.results), 'OPENFDA_PAGE_INVALID');
    total ??= j.meta.results.total; release ??= j.meta.last_updated;
    requireValue(total === j.meta.results.total && release === j.meta.last_updated, 'SOURCE_COUNT_CHANGED'); requireValue(total <= options.maxRecords, 'SOURCE_RECORD_CAP');
    requireValue(j.results.length === Math.min(100, total - fetched), 'SOURCE_PAGE_TRUNCATED');
    if (page === 0) firstSignature = payloadHash(j.results);
    j.results.forEach((r, i) => {
      const published = sourceDate(r.report_date); requireValue(published >= options.from && published <= options.through, 'SOURCE_WINDOW_VIOLATION');
      if (r.recall_number === '') {
        requireValue(typeof r.event_id === 'string' && r.event_id && typeof r.product_description === 'string' && typeof r.reason_for_recall === 'string', 'OPENFDA_RECORD_INVALID');
        withheld.push({ event_id: r.event_id, raw_sha256: c.receipt.sha256, record_pointer: `/results/${i}`, reason: 'publisher_recall_number_not_assigned' });
        requireValue(withheld.length <= 50, 'UNKEYED_SOURCE_ROW_CAP');
      } else rows.push(record(normalizeEnforcement(r, category), c, `/results/${i}`));
    });
    fetched += j.results.length;
    if (fetched === total) break;
  }
  requireValue(fetched === total && rows.length + withheld.length === total, 'SOURCE_PAGE_CAP'); uniqueRecords(rows);
  const check = await client.capture(url(0)); requireValue(check.json.meta?.results?.total === total && check.json.meta?.last_updated === release && payloadHash(check.json.results) === firstSignature, 'SOURCE_CHANGED_DURING_RUN');
  return { rows, expected: rows.length, scope: { date_basis: 'report_date', selection: 'all records with publisher-assigned recall numbers within inclusive report-date window; unnumbered rows retained raw and explicitly withheld', full_history: false, source_release: release, publisher_record_count: total, eligible_record_count: rows.length, excluded_record_count: withheld.length, withheld_records: withheld, qualification: SOURCES[source].qualification } };
}

export function parseCpsc(json, captured, options) {
  requireValue(Array.isArray(json), 'CPSC_PAGE_INVALID');
  requireValue(json.length <= options.maxRecords, 'SOURCE_RECORD_CAP');
  return uniqueRecords(json.map((r, index) => {
    requireValue(Number.isSafeInteger(r.RecallID) && r.RecallID > 0 && typeof r.RecallNumber === 'string' && r.RecallNumber && typeof r.Title === 'string' && r.Title && typeof r.Description === 'string', 'CPSC_API_ERROR_OR_SCHEMA');
    const updated = sourceDate(r.LastPublishDate); requireValue(updated && updated >= options.from && updated <= options.through, 'SOURCE_WINDOW_VIOLATION');
    const url = allowedUrl(r.URL, SOURCES.cpsc_recalls.hosts); requireValue(new URL(url).pathname.toLowerCase().startsWith('/recalls/'), 'CPSC_RECORD_URL_INVALID');
    return record({ native_id: String(r.RecallID), title: r.Title, document_type: 'recall_notice', published_on: sourceDate(r.RecallDate), source_updated_on: updated, source_url: url, agency_ids: ['cpsc'], agency_names: ['Consumer Product Safety Commission'], identifiers: [r.RecallNumber], evidence_excerpt: r.Description.slice(0, 1800), fields: { publisher_record: r, qualification: SOURCES.cpsc_recalls.qualification, date_basis: 'RecallDate and LastPublishDate, not injury date' } }, captured, `/${index}`);
  }));
}
export async function collectCpsc(client, _source, options) {
  const url = new URL('https://www.saferproducts.gov/RestWebServices/Recall'); url.searchParams.set('format', 'json'); url.searchParams.set('LastPublishDateStart', options.from); url.searchParams.set('LastPublishDateEnd', options.through);
  const c = await client.capture(url.href); const rows = parseCpsc(c.json, c, options);
  // The API supplies no independent total: repeat the bounded window and compare every native payload.
  const check = await client.capture(url.href); const repeat = parseCpsc(check.json, check, options);
  requireValue(payloadHash(rows.map((r) => r.payload_sha256).sort()) === payloadHash(repeat.map((r) => r.payload_sha256).sort()), 'SOURCE_CHANGED_DURING_RUN');
  return { rows, expected: rows.length, scope: { date_basis: 'LastPublishDate', selection: 'API returned recall set for inclusive publication-change window', full_history: false, independent_publisher_count_available: false, repeated_response_verified: true, qualification: SOURCES.cpsc_recalls.qualification } };
}

export function normalizeFederalRegister(row) {
  requireValue(typeof row.document_number === 'string' && /^(?:C\d+-)?\d{4}-\d+$/.test(row.document_number) && typeof row.title === 'string' && Array.isArray(row.agencies), 'FR_RECORD_INVALID');
  const corrections = Array.isArray(row.correction_of) ? row.correction_of.map((v) => typeof v === 'string' ? v : v?.document_number).filter((v) => typeof v === 'string') : [];
  return { native_id: row.document_number, title: row.title, document_type: row.type ?? 'federal_register_document', published_on: sourceDate(row.publication_date), source_updated_on: null, source_url: allowedUrl(row.html_url, SOURCES.federal_register.hosts), agency_ids: row.agencies.map((a) => a.id).filter((v) => v !== undefined && v !== null).map(String), agency_names: row.agencies.map((a) => a.name ?? a.raw_name).filter((v) => typeof v === 'string'), entity_refs: row.agencies.filter((a) => Number.isSafeInteger(a.id) && typeof (a.name ?? a.raw_name) === 'string').map((a) => ({ namespace: 'federal_register:agency', native_id: String(a.id), label: a.name ?? a.raw_name })), identifiers: [...(row.docket_ids ?? []), ...(row.regulation_id_numbers ?? [])], correction_of: corrections, evidence_excerpt: typeof row.abstract === 'string' ? row.abstract.slice(0, 1800) : null, fields: { publisher_record: row, effective_on: row.effective_on ?? null, qualification: SOURCES.federal_register.qualification } };
}
export async function collectFederalRegister(client, _source, options) {
  const rows = []; let total = null; let firstSignature;
  const url = (page) => { const u = new URL('https://www.federalregister.gov/api/v1/documents.json'); for (const [k, v] of Object.entries({ per_page: 100, page, order: 'oldest', 'conditions[publication_date][gte]': options.from, 'conditions[publication_date][lte]': options.through })) u.searchParams.set(k, String(v)); for (const f of [...FR_FIELDS, 'abstract']) u.searchParams.append('fields[]', f); return u.href; };
  for (let page = 1; page <= options.maxPages; page++) {
    const c = await client.capture(url(page)); const j = c.json;
    requireValue(Number.isSafeInteger(j?.count) && j.count >= 0 && Array.isArray(j.results), 'FR_PAGE_INVALID'); total ??= j.count;
    requireValue(total === j.count, 'SOURCE_COUNT_CHANGED'); requireValue(total <= options.maxRecords, 'SOURCE_RECORD_CAP');
    requireValue(j.results.length === Math.min(100, total - rows.length), 'SOURCE_PAGE_TRUNCATED');
    if (page === 1) firstSignature = payloadHash(j.results);
    j.results.forEach((r, i) => { const d = normalizeFederalRegister(r); requireValue(d.published_on >= options.from && d.published_on <= options.through, 'SOURCE_WINDOW_VIOLATION'); rows.push(record(d, c, `/results/${i}`)); });
    if (rows.length === total) break;
  }
  requireValue(rows.length === total, 'SOURCE_PAGE_CAP'); uniqueRecords(rows);
  const check = await client.capture(url(1)); requireValue(check.json.count === total && payloadHash(check.json.results) === firstSignature, 'SOURCE_CHANGED_DURING_RUN');
  return { rows, expected: total, scope: { date_basis: 'publication_date', selection: 'all agencies/types in inclusive API publication window', full_history: false, qualification: SOURCES.federal_register.qualification } };
}
export const ADAPTERS = { fda: collectFda, openfda: collectOpenFda, cpsc: collectCpscRss, fr: collectFederalRegister };
