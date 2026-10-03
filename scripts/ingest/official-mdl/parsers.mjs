// Deterministic parsers for official court MDL pages. One parser per site family; each returns
//   { page: { title, ... }, rows: [ListedDocument] }
// A ListedDocument carries the PRINTED title / date / document number exactly as the court shows them (whitespace collapsed only), the absolute
// URL, and a locator into the raw page bytes (row span + sha256 of the row's own HTML). Nothing is paraphrased, guessed or merged.
import { createHash } from 'node:crypto';
import { parseHtml, findAll, findFirst, hasClass, textOf, collapse, decodeEntities, ancestorOf } from './html-lite.mjs';

const sha256 = x => createHash('sha256').update(x).digest('hex');
export const SEAL_PATTERN = /seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact/i; // §6.0 exclusion text of the matter-registry contract (deliberately broad)

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');
const validYmd = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const fullYear = y => (y.length === 4 ? Number(y) : Number(y) < 70 ? 2000 + Number(y) : 1900 + Number(y));

// Finds the first date in `text`. ISO is produced only when the reading is unambiguous: a month name, a numeric date whose day exceeds 12, or a
// numeric date on a page where another printed date proves month-first order (`monthFirstProven`). Otherwise iso=null (ambiguous).
export function parseDate(text, { monthFirstProven = false } = {}) {
  const s = String(text ?? '');
  let m = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(s);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()], day = Number(m[2]), year = Number(m[3]);
    return validYmd(year, month, day) ? { printed: m[0], iso: `${year}-${pad(month)}-${pad(day)}`, basis: 'month_name' } : { printed: m[0], iso: null, basis: 'invalid_calendar_date' };
  }
  m = /\b(\d{1,2})([/-])(\d{1,2})\2(\d{4}|\d{2})\b/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[3]), year = fullYear(m[4]);
    const twoDigit = m[4].length === 2;
    let month, day, basis;
    if (a > 12 && b <= 12) { month = b; day = a; basis = 'numeric_day_first_unambiguous'; }
    else if (b > 12 && a <= 12) { month = a; day = b; basis = 'numeric_month_first_unambiguous'; }
    else if (a <= 12 && b <= 12 && monthFirstProven) { month = a; day = b; basis = 'numeric_month_first_proven_by_page'; }
    else return { printed: m[0], iso: null, basis: 'numeric_ambiguous' };
    if (!validYmd(year, month, day)) return { printed: m[0], iso: null, basis: 'invalid_calendar_date' };
    return { printed: m[0], iso: `${year}-${pad(month)}-${pad(day)}`, basis: twoDigit ? basis + '+two_digit_year_pivot_70' : basis };
  }
  return null;
}
// A page proves month-first when at least one printed numeric date has a day above 12 in the second position.
export function pageProvesMonthFirst(dateTexts) {
  for (const text of dateTexts) {
    const m = /\b(\d{1,2})([/-])(\d{1,2})\2(\d{4}|\d{2})\b/.exec(String(text ?? ''));
    if (m && Number(m[3]) > 12 && Number(m[1]) <= 12) return true;
  }
  return false;
}

// Listed documents are direct PDFs and ECF (login/fee) document links. Other file types (docx, xlsx, ...) are only counted on the page record.
export const DOCUMENT_KINDS = new Set(['pdf_direct', 'ecf_login']);
const NODE_NONE = { type: 'text', raw: '', children: [] };
const SITE_BANNER = /^(united states district court|district court|united states)$/i;
export function pageTitle(root) {
  const byId = findFirst(root, n => n.attrs?.id === 'page-title');
  if (byId) return textOf(byId);
  const h1 = findAll(root, n => n.tag === 'h1').map(n => textOf(n)).find(t => t && !SITE_BANNER.test(t));
  if (h1) return h1;
  return textOf(findFirst(root, n => n.tag === 'title') ?? NODE_NONE) || null;
}
// Docket-number-like literals printed on a page (never inside the court's member-case tables), with their position in the decoded visible text.
const CASE_NUMBER = /\b\d{1,2}:\d{2}-?(?:md|cv|mc|mj)-?\d{1,6}(?:-[A-Za-z]{1,5})*(?![A-Za-z0-9])|\b\d{2}[\s-]*(?:md|cv)[\s-]*\d{3,6}\b/gi;
export function printedCaseNumbers(html) {
  const root = parseHtml(html);
  const text = textOf(root, { skip: n => n.tag === 'table' && /member/i.test(n.attrs?.id ?? '') });
  const found = new Map();
  for (const m of text.matchAll(CASE_NUMBER)) {
    const literal = m[0];
    const entry = found.get(literal) ?? { literal, count: 0, first_offset: m.index, context: text.slice(Math.max(0, m.index - 90), m.index + literal.length + 60) };
    entry.count++; found.set(literal, entry);
  }
  return { visible_text_sha256: sha256(text), visible_text_chars: text.length, case_numbers: [...found.values()] };
}
export function classifyUrl(href, pageUrl) {
  let u;
  try { u = new URL(href, pageUrl); } catch { return { url: null, kind: 'invalid' }; }
  const host = u.hostname.toLowerCase(), lowerPath = u.pathname.toLowerCase();
  // CM/ECF document links need a PACER login (and fees): listed, never fetched. Other ecf.* pages (docket index, RSS) are navigation, not documents.
  if (/^ecf\./.test(host) || /\/doc1\/\d+/.test(lowerPath) || /cgi-bin\/(show_doc|dktrpt)/.test(lowerPath)) return { url: u.href, kind: /\/doc1\/\d+|show_doc/.test(lowerPath) ? 'ecf_login' : 'ecf_page' };
  if (!/\.uscourts\.gov$/.test(host)) return { url: u.href, kind: 'external' };
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { url: u.href, kind: 'invalid' };
  if (/\.pdf$/.test(lowerPath)) return { url: u.href.replace(/^http:/, 'https:'), kind: 'pdf_direct' };
  if (/\.(docx?|xlsx?|pptx?|zip|rtf)$/.test(lowerPath)) return { url: u.href, kind: 'other_file' };
  return { url: u.href, kind: 'html_page' };
}

// Order labels are extracted ONLY from printed text; typos in the court's wording are tolerated by the pattern but never corrected in the title.
// Anchored at the start of the printed title (optionally after the court's "MDL " prefix): a docket text that merely REFERS to an order
// ("Notice of link ... set by [172] CASE MANAGEMENT ORDER #5") is not that order.
const ORDER_LABEL = /^\s*(?:MDL\s+)?((?:amended\s+|second\s+amended\s+|revised\s+)?(?:case\s+manag\w*\s+order|cmo|pretrial\s+order|pto|common\s+benefit\s+order|scheduling\s+order)s?)\s*(?:no\.?|number|#)?\s*([0-9]+[A-Za-z]?(?:-[0-9]+)?)\b/i;
export function orderLabel(title) {
  const m = ORDER_LABEL.exec(String(title ?? ''));
  return m ? { printed: collapse(m[0]), kind: collapse(m[1]).toLowerCase(), number: m[2] } : null;
}
export function docKind(title) {
  const t = collapse(title ?? '');
  const lead = t.slice(0, 80);
  if (/^(?:MDL\s+)?(?:(?:amended|second|revised|initial)\s+)*conditional\s+transfer\s+order|^.{0,40}\bCTO[-\s]?\d/i.test(lead)) return 'jpml_conditional_transfer_order';
  if (/^(?:\w+\s+){0,2}(?:transfer|centralization)\s+order/i.test(lead)) return 'jpml_transfer_order';
  if (/^(?:MDL\s+)?(?:(?:amended|second|revised|initial)\s+)*(?:case\s+manag\w*\s+order|cmo\b)/i.test(lead)) return 'case_management_order';
  if (/^(?:MDL\s+)?(?:(?:amended|second|revised|initial)\s+)*(?:pretrial\s+order|pto\b)/i.test(lead)) return 'pretrial_order';
  if (/^(?:(?:amended|second|revised)\s+)?common\s+benefit/i.test(lead)) return 'common_benefit_order';
  if (/^(?:(?:amended|second|revised)\s+)?scheduling\s+order/i.test(lead)) return 'scheduling_order';
  if (/^minutes?\b|\bminutes of\b/i.test(lead)) return 'minutes';
  if (/\bagenda\b/i.test(lead)) return 'agenda';
  if (/short\s+form\s+complaint|master\s+complaint|^complaint/i.test(lead)) return 'pleading_or_form_complaint';
  if (/fact\s+sheet|authorization\s+form/i.test(lead)) return 'form';
  if (/^instructions/i.test(lead)) return 'instructions';
  if (/\bopinion\b|memorandum/i.test(lead)) return 'opinion_or_memorandum';
  if (/\border\b/i.test(lead)) return 'order';
  if (/^notice\b|\bnotice\b/i.test(lead)) return 'notice';
  return 'other';
}

function rowBase({ ctx, node, section, ordinal, href, label, title, dateText, docNumber, extra = {} }) {
  const { url, kind } = classifyUrl(href, ctx.pageUrl);
  const printedTitle = collapse(title ?? '') || null;
  const parsed = dateText ? parseDate(dateText, { monthFirstProven: ctx.monthFirst }) : null;
  const rowHtml = ctx.html.slice(node.start, node.end);
  const order = orderLabel(printedTitle ?? label);
  return {
    section: section ?? null, row_ordinal: ordinal,
    printed_title: printedTitle, printed_label: collapse(label ?? '') || null,
    printed_date: dateText ? collapse(dateText) : null, date_iso: parsed?.iso ?? null, date_iso_basis: parsed?.basis ?? (dateText ? 'not_parseable' : null),
    doc_number: docNumber != null && collapse(docNumber) !== '' ? collapse(docNumber) : null,
    order_label_printed: order?.printed ?? null, order_kind: order?.kind ?? null, order_number: order?.number ?? null,
    doc_kind: docKind(printedTitle ?? label),
    href_as_printed: href, url, url_kind: kind,
    row_text: collapse(textOf(node)).slice(0, 4000),
    row_span: { start: node.start, end: node.end }, row_html_sha256: sha256(rowHtml),
    ...extra,
  };
}
const ctxOf = (html, pageUrl, dateTexts) => ({ html, pageUrl, monthFirst: pageProvesMonthFirst(dateTexts) });

// ---- NJD (Drupal 7 "district" theme): body paragraphs; either <a>ORDER</a> + "Date:" + "Description:" paragraphs, or plain link lists ----
export function parseNjdBody({ html, pageUrl }) {
  const root = parseHtml(html);
  const body = findFirst(root, n => hasClass(n, 'field--name-body'));
  const page = { title: pageTitle(root), body_found: !!body };
  if (!body) return { page, rows: [] };
  page.other_file_links = findAll(body, n => n.tag === 'a' && n.attrs.href && classifyUrl(n.attrs.href, pageUrl).kind === 'other_file').map(a => ({ label: textOf(a), url: classifyUrl(a.attrs.href, pageUrl).url }));
  const paragraphs = findAll(body, n => n.tag === 'p' || n.tag === 'li');
  const dateTexts = paragraphs.map(p => /^\s*Date:\s*(.*)$/i.exec(textOf(p))?.[1]).filter(Boolean);
  const ctx = ctxOf(html, pageUrl, dateTexts);
  const rows = []; let ordinal = 0;
  const anchors = findAll(body, n => n.tag === 'a' && n.attrs.href && !/^(mailto:|tel:|#|javascript:)/i.test(n.attrs.href));
  for (const a of anchors) {
    const cls = classifyUrl(a.attrs.href, pageUrl);
    if (!DOCUMENT_KINDS.has(cls.kind)) continue; // navigation links (other court pages, ECF index, external sites) are not documents
    let paragraph = ancestorOf(a, n => n.tag === 'p' || n.tag === 'li') ?? a;
    if (findAll(paragraph, n => n.tag === 'a' && n.attrs.href && DOCUMENT_KINDS.has(classifyUrl(n.attrs.href, pageUrl).kind)).length > 1) paragraph = a; // several links in one paragraph: each row is its own link
    const label = textOf(a);
    // look ahead through the following sibling paragraphs for "Date:" and "Description:" (stop at the next paragraph that holds a link)
    let dateText = null, description = null;
    const siblings = paragraph.parent ? paragraph.parent.children.filter(c => c.type === 'element') : [];
    const at = siblings.indexOf(paragraph);
    for (let k = at + 1; k < siblings.length && k <= at + 4; k++) {
      const sib = siblings[k], text = textOf(sib);
      if (findFirst(sib, n => n.tag === 'a') && !/^\s*(Date|Description):/i.test(text)) break;
      let m = /^\s*Date:\s*(.*)$/i.exec(text); if (m && dateText === null) { dateText = m[1]; continue; }
      m = /^\s*Description:\s*(.*)$/i.exec(text); if (m && description === null) { description = m[1]; continue; }
    }
    const labelDate = !dateText ? parseDate(label, { monthFirstProven: false }) : null; // a date printed inside the link text (e.g. "Minutes of 1-23-2017")
    const title = description ?? label;
    ordinal++;
    rows.push(rowBase({ ctx, node: paragraph, section: page.title, ordinal, href: a.attrs.href, label, title, dateText: dateText ?? labelDate?.printed ?? null, docNumber: null,
      extra: { title_source: description !== null ? 'description_paragraph' : 'link_text', date_source: dateText ? 'date_paragraph' : labelDate ? 'link_text' : null } }));
  }
  return { page, rows };
}

// ---- PAED (Drupal 7 views table): Date | linked title; machine-readable date in <span content="YYYY-MM-DDT..."> ----
export function parsePaedOrders({ html, pageUrl }) {
  const root = parseHtml(html);
  const table = findFirst(root, n => n.tag === 'table' && hasClass(n, 'views-table'));
  const page = { title: pageTitle(root), table_found: !!table };
  if (!table) return { page, rows: [] };
  const trs = findAll(table, n => n.tag === 'tr' && findFirst(n, c => c.tag === 'td'));
  const dateTexts = trs.map(tr => textOf(findFirst(tr, n => n.tag === 'td')));
  const ctx = ctxOf(html, pageUrl, dateTexts);
  const rows = []; let ordinal = 0;
  for (const tr of trs) {
    const tds = findAll(tr, n => n.tag === 'td'), a = findFirst(tr, n => n.tag === 'a' && n.attrs.href);
    if (!a) continue;
    const span = findFirst(tr, n => n.tag === 'span' && n.attrs.content && /^\d{4}-\d{2}-\d{2}/.test(n.attrs.content));
    ordinal++;
    const row = rowBase({ ctx, node: tr, section: page.title, ordinal, href: a.attrs.href, label: textOf(a), title: textOf(a), dateText: textOf(tds[0]), docNumber: null });
    if (span) {
      const machine = /^(\d{4}-\d{2}-\d{2})/.exec(span.attrs.content)[1];
      row.machine_date_attribute = span.attrs.content;
      row.date_iso_cross_check = row.date_iso === null ? 'printed_date_ambiguous_machine_attribute_available' : row.date_iso === machine ? 'equal' : 'DIFFERENT';
      if (row.date_iso === null) { row.date_iso = machine; row.date_iso_basis = 'page_machine_readable_date_attribute'; }
    }
    rows.push(row);
  }
  return { page, rows };
}

// ---- ILND (ASP.NET accordion panels): tables Date Posted | Doc.# | Description and link lists (Forms) ----
const ILND_SKIP_PANEL = /frequently\s+asked|best\s+practices|court\s+contacts|lead\s+counsel|steering\s+committee|member\s+cases|upcoming\s+court/i;
export function parseIlndMdlDetails({ html, pageUrl }) {
  const root = parseHtml(html);
  const panels = findAll(root, n => n.tag === 'div' && hasClass(n, 'panel') && hasClass(n, 'panel-default'));
  const page = { title: textOf(findFirst(root, n => n.tag === 'title') ?? NODE_NONE) || null, panels: [], other_file_links: [] };
  const entries = [];
  for (const panel of panels) {
    const head = findFirst(panel, n => hasClass(n, 'panel-title'));
    const heading = head ? textOf(head) : null;
    const body = findFirst(panel, n => hasClass(n, 'panel-body'));
    const table = body ? findFirst(body, n => n.tag === 'table') : null;
    page.panels.push({ heading, skipped: !!(heading && ILND_SKIP_PANEL.test(heading)), table_id: table?.attrs.id ?? null, table_rows: table ? findAll(table, n => n.tag === 'tr').length : 0 });
    if (!body || (heading && ILND_SKIP_PANEL.test(heading))) continue;
    entries.push({ heading, body, table });
  }
  const dateTexts = [];
  for (const e of entries) if (e.table) for (const tr of findAll(e.table, n => n.tag === 'tr')) { const tds = findAll(tr, n => n.tag === 'td'); const d = tds.map(td => textOf(td)).find(t => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)); if (d) dateTexts.push(d); }
  const ctx = ctxOf(html, pageUrl, dateTexts);
  const rows = []; let ordinal = 0;
  for (const e of entries) {
    if (e.table) {
      const header = findAll(e.table, n => n.tag === 'th').map(th => textOf(th));
      const col = name => header.findIndex(h => new RegExp(name, 'i').test(h));
      const dateCol = col('Date'), docCol = col('Doc'), descCol = col('Desc');
      for (const tr of findAll(e.table, n => n.tag === 'tr')) {
        const tds = findAll(tr, n => n.tag === 'td'); if (!tds.length) continue;
        const a = findFirst(tr, n => n.tag === 'a' && n.attrs.href && n.attrs.href.trim() !== ''); if (!a) continue;
        ordinal++;
        rows.push(rowBase({ ctx, node: tr, section: e.heading, ordinal, href: a.attrs.href, label: textOf(a), title: descCol >= 0 ? textOf(tds[descCol]) : textOf(a),
          dateText: dateCol >= 0 ? textOf(tds[dateCol]) : null, docNumber: docCol >= 0 ? textOf(tds[docCol]) : null }));
      }
    } else {
      for (const a of findAll(e.body, n => n.tag === 'a' && n.attrs.href && !/^(mailto:|tel:|#|javascript:)/i.test(n.attrs.href))) {
        const cls = classifyUrl(a.attrs.href, pageUrl);
        if (cls.kind === 'other_file') page.other_file_links.push({ panel: e.heading, label: textOf(a), url: cls.url });
        if (!DOCUMENT_KINDS.has(cls.kind)) continue;
        const holder = ancestorOf(a, n => n.tag === 'p' || n.tag === 'li') ?? a;
        ordinal++;
        rows.push(rowBase({ ctx, node: holder, section: e.heading, ordinal, href: a.attrs.href, label: textOf(a), title: textOf(a), dateText: null, docNumber: null }));
      }
    }
  }
  return { page, rows };
}

// ---- MOED (Drupal 7 "mdl-orders" nodes): file link, Date Filed, Description ----
export function parseMoedMdl({ html, pageUrl }) {
  const root = parseHtml(html);
  const nodes = findAll(root, n => n.tag === 'article' && hasClass(n, 'node--mdl-orders'));
  const page = { title: pageTitle(root), documents_found: nodes.length };
  const dateTexts = nodes.map(n => textOf(findFirst(n, c => hasClass(c, 'field--name-field-mdl-date-filed')) ?? NODE_NONE).replace(/^Date Filed:\s*/i, ''));
  const ctx = ctxOf(html, pageUrl, dateTexts);
  const rows = []; let ordinal = 0;
  for (const article of nodes) {
    const fileField = findFirst(article, n => hasClass(n, 'field--name-field-mdl-file'));
    const a = fileField ? findFirst(fileField, n => n.tag === 'a' && n.attrs.href) : null; if (!a) continue;
    const dateField = findFirst(article, n => hasClass(n, 'field--name-field-mdl-date-filed')), descField = findFirst(article, n => hasClass(n, 'field--name-field-mdl-description'));
    const dateSpan = dateField ? findFirst(dateField, n => n.tag === 'span' && n.attrs.content) : null;
    const dateText = dateField ? textOf(dateField).replace(/^Date Filed:\s*/i, '') : null;
    const descItem = descField ? findFirst(descField, n => hasClass(n, 'field__items')) : null;
    const lengthMatch = /length=(\d+)/.exec(a.attrs.type ?? '');
    ordinal++;
    const row = rowBase({ ctx, node: article, section: 'Documents', ordinal, href: a.attrs.href, label: textOf(a), title: descItem ? textOf(descItem) : null, dateText, docNumber: textOf(a),
      extra: { node_page_href: findFirst(article, n => n.tag === 'h2')?.children.find(c => c.tag === 'a')?.attrs.href ?? null, page_reported_bytes: lengthMatch ? Number(lengthMatch[1]) : null, file_name_attribute: a.attrs.title ?? null } });
    if (dateSpan) {
      const machine = /^(\d{4}-\d{2}-\d{2})/.exec(dateSpan.attrs.content)?.[1] ?? null;
      row.machine_date_attribute = dateSpan.attrs.content;
      row.date_iso_cross_check = machine === null ? 'no_machine_date' : row.date_iso === null ? 'printed_date_ambiguous_machine_attribute_available' : row.date_iso === machine ? 'equal' : 'DIFFERENT';
      if (row.date_iso === null && machine) { row.date_iso = machine; row.date_iso_basis = 'page_machine_readable_date_attribute'; }
    }
    rows.push(row);
  }
  return { page, rows };
}

// ---- TXND (Drupal 7 docket-style table): Date Filed | Doc. # (link) | Docket Text (may carry "Attachments: # [n] label") ----
export function parseTxndDocket({ html, pageUrl }) {
  const root = parseHtml(html);
  const table = findAll(root, n => n.tag === 'table').find(t => { const first = findFirst(t, n => n.tag === 'tr'); return !!first && /Date Filed/i.test(textOf(first)) && /Doc\.?\s*#/i.test(textOf(first)); });
  const caption = findFirst(root, n => n.tag === 'strong' && /\bin\s+re\b/i.test(textOf(n)));
  const page = { title: caption ? textOf(caption) : pageTitle(root), table_found: !!table };
  if (!table) return { page, rows: [] };
  const trs = findAll(table, n => n.tag === 'tr' && findAll(n, c => c.tag === 'td').length >= 3 && !!findFirst(n, c => c.tag === 'a' || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(textOf(c))) && !/^Date Filed/i.test(textOf(n)));
  const ctx = ctxOf(html, pageUrl, trs.map(tr => textOf(findAll(tr, n => n.tag === 'td')[0])));
  const rows = []; let ordinal = 0;
  for (const tr of trs) {
    const tds = findAll(tr, n => n.tag === 'td');
    const main = findFirst(tds[1], n => n.tag === 'a' && n.attrs.href);
    const docketText = textOf(tds[2]);
    if (main) {
      ordinal++;
      const lead = findFirst(tds[2], n => n.tag === 'strong');
      rows.push(rowBase({ ctx, node: tr, section: 'Docket', ordinal, href: main.attrs.href, label: textOf(main), title: docketText, dateText: textOf(tds[0]), docNumber: textOf(main), extra: { attachment_of: null, printed_title_lead: lead ? textOf(lead) : null } }));
    }
    // attachments printed inside the docket text: "(Attachments: # [1](url) label # [2](url) label)"
    for (const a of findAll(tds[2], n => n.tag === 'a' && n.attrs.href)) {
      const cls = classifyUrl(a.attrs.href, pageUrl);
      if (cls.kind !== 'pdf_direct') continue;
      const after = ctx.html.slice(a.end, tds[2].innerEnd);
      const labelText = collapse(decodeEntities(after.replace(/<[^>]*>/g, ' ').split(/\s#\s|\)/)[0]));
      ordinal++;
      rows.push(rowBase({ ctx, node: tr, section: 'Docket (attachment)', ordinal, href: a.attrs.href, label: textOf(a), title: labelText || null, dateText: textOf(tds[0]), docNumber: (main ? textOf(main) : '') + '-' + textOf(a),
        extra: { attachment_of: main ? textOf(main) : null, attachment_number: textOf(a), parent_docket_text: docketText.slice(0, 600) } }));
    }
  }
  return { page, rows };
}

// ---- JPML /panel-orders: tables "MDL No. | MDL Title" (title linked to the order PDF; several links in one cell for MDLs with two orders) for the CURRENT hearing session ----
export function parseJpmlPanelOrders({ html, pageUrl }) {
  const root = parseHtml(html);
  const page = { title: pageTitle(root), session_headings: [] };
  const rows = []; let ordinal = 0;
  let session = null;
  for (const strong of findAll(root, n => n.tag === 'strong')) { const t = textOf(strong); if (/hearing session/i.test(t)) { session = t; page.session_headings.push(t); break; } }
  const ctx = ctxOf(html, pageUrl, []);
  for (const table of findAll(root, n => n.tag === 'table')) {
    // heading = the nearest preceding paragraph's bold text
    const holder = table.parent, at = holder ? holder.children.indexOf(table) : -1;
    let section = null;
    for (let k = at - 1; k >= 0 && !section; k--) { const sib = holder.children[k]; if (sib.type === 'element' && sib.tag === 'p') { const s = findFirst(sib, n => n.tag === 'strong'); const t = s ? textOf(s) : ''; if (t && !/hearing session/i.test(t)) section = t; } }
    for (const tr of findAll(table, n => n.tag === 'tr')) {
      const tds = findAll(tr, n => n.tag === 'td'); if (tds.length < 2) continue;
      const number = textOf(tds[0]); if (!/^\d{3,4}$/.test(number)) continue;
      for (const a of findAll(tds[1], n => n.tag === 'a' && n.attrs.href)) {
        ordinal++;
        const label = textOf(a);
        rows.push(rowBase({ ctx, node: tr, section: [session, section].filter(Boolean).join(' / ') || null, ordinal, href: a.attrs.href, label, title: label, dateText: null, docNumber: null,
          extra: { mdl_number_printed: number, mdl_title_printed: textOf(tds[1]), session_label_printed: session } }));
      }
    }
  }
  return { page, rows };
}

// Index pages (lists of MDLs): anchors whose text names an MDL. Used only to prove which MDL pages a court currently lists.
export function parseIndexLinks({ html, pageUrl }) {
  const root = parseHtml(html);
  const seen = new Map();
  for (const a of findAll(root, n => n.tag === 'a' && n.attrs.href)) {
    const label = textOf(a);
    if (!/\bMDL\b|\bmd[- ]?\d{3,4}\b|\d:\d{2}-md-\d{3,5}|multi[- ]?district/i.test(label)) continue;
    const { url } = classifyUrl(a.attrs.href, pageUrl); if (!url) continue;
    if (!seen.has(url + '|' + label)) seen.set(url + '|' + label, { label, url });
  }
  return { page: { title: textOf(findFirst(root, n => n.tag === 'title') ?? NODE_NONE) || null }, rows: [], index_links: [...seen.values()] };
}

export const FAMILIES = { 'njd-body': parseNjdBody, 'paed-orders-table': parsePaedOrders, 'ilnd-mdl-details': parseIlndMdlDetails, 'moed-mdl-page': parseMoedMdl, 'txnd-docket-table': parseTxndDocket, 'jpml-panel-orders': parseJpmlPanelOrders, 'index-links': parseIndexLinks };
