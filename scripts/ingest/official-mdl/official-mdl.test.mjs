import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml, findAll, findFirst, textOf, decodeEntities, collapse } from './html-lite.mjs';
import { parseDate, pageProvesMonthFirst, classifyUrl, orderLabel, docKind, SEAL_PATTERN, parseNjdBody, parsePaedOrders, parseIlndMdlDetails, parseMoedMdl, parseTxndDocket, parseJpmlPanelOrders, printedCaseNumbers } from './parsers.mjs';
import { parseRobots, robotsPolicy, robotsAllows, createPoliteClient, HostStopped, RobotsDisallowed } from './polite-fetch.mjs';
import { parseDocket, packageId, caseIdOf, GOVINFO_MASTERS, parsePremis, parsePackageMods } from './govinfo.mjs';
import { queueDecision, listingRecord, recordSha256 } from './build-listings.mjs';

// ---------- html-lite ----------
test('html-lite keeps source offsets, decodes entities (incl. legacy "&nbsp" without semicolon) and survives unclosed p/td/li', () => {
  const html = '<table><tr><td>Date<td>A &amp; B&nbspC</table><ul><li>one<li>two</ul><p>x<p>y<br>z<script>if (a<b) {}</script>';
  const root = parseHtml(html);
  const tds = findAll(root, n => n.tag === 'td');
  assert.deepEqual(tds.map(td => textOf(td)), ['Date', 'A & B C']);
  assert.deepEqual(findAll(root, n => n.tag === 'li').map(n => textOf(n)), ['one', 'two']);
  assert.deepEqual(findAll(root, n => n.tag === 'p').map(n => textOf(n)), ['x', 'y z']);
  assert.equal(html.slice(tds[0].start, tds[0].end).startsWith('<td>Date'), true);
  assert.equal(decodeEntities('&#8211;&#x2019;&rsquo;&bogus;'), '–’’&bogus;');
  assert.equal(decodeEntities('a&amp=1', { legacy: false }), 'a&amp=1'); // attribute context: no semicolon-less decoding
  assert.equal(collapse('  a  b\n c  '), 'a b c');
});

// ---------- dates ----------
test('dates: ISO only when unambiguous or proven month-first by the page; two-digit years pivot at 70', () => {
  assert.deepEqual(parseDate('Filed September 4, 2026'), { printed: 'September 4, 2026', iso: '2026-09-04', basis: 'month_name' });
  assert.equal(parseDate('12/23/2025').iso, '2025-12-23');
  assert.equal(parseDate('12/23/2025').basis, 'numeric_month_first_unambiguous');
  assert.equal(parseDate('02/03/2024').iso, null);
  assert.equal(parseDate('02/03/2024').basis, 'numeric_ambiguous');
  assert.equal(parseDate('02/03/2024', { monthFirstProven: true }).iso, '2024-02-03');
  assert.equal(parseDate('2/8/17', { monthFirstProven: true }).iso, '2017-02-08');
  assert.equal(parseDate('1-23-2017').iso, '2017-01-23');
  assert.equal(parseDate('13/02/2024').iso, '2024-02-13'); // day-first only because 13 cannot be a month
  assert.equal(parseDate('02/30/2024').iso, null);
  assert.equal(parseDate('no date here'), null);
  assert.equal(pageProvesMonthFirst(['02/03/2024', '12/19/2023']), true);
  assert.equal(pageProvesMonthFirst(['02/03/2024', '05/04/2024']), false);
});

// ---------- url kinds, labels, sealing wording ----------
test('url kinds: direct PDFs, ECF login links (listed, never fetched), other hosts', () => {
  assert.equal(classifyUrl('/sites/njd/files/a.pdf', 'https://www.njd.uscourts.gov/x').kind, 'pdf_direct');
  assert.equal(classifyUrl('https://ecf.ilnd.uscourts.gov/doc1/067128263841', 'https://www.ilnd.uscourts.gov/').kind, 'ecf_login');
  assert.equal(classifyUrl('https://ecf.njd.uscourts.gov/cgi-bin/ShowIndex.pl', 'https://www.njd.uscourts.gov/').kind, 'ecf_page');
  assert.equal(classifyUrl('https://example.com/a.pdf', 'https://www.njd.uscourts.gov/').kind, 'external');
  assert.equal(classifyUrl('/content/michael-shipp', 'https://www.njd.uscourts.gov/').kind, 'html_page');
});
test('order labels come only from the START of the printed title; a docket text that merely refers to an order is not that order', () => {
  assert.equal(orderLabel('MDL CASE MANAGEMENT ORDER NO. 22').number, '22');
  assert.equal(orderLabel('Case Managment Order #11').number, '11');   // the court's typo is tolerated, never corrected
  assert.equal(orderLabel('CASE MANAGEMENT ORDER #1: Prior to the initial').number, '1');
  assert.equal(orderLabel('NOTICE of live-stream link ... set by [172] CASE MANAGEMENT ORDER #5.'), null);
  assert.equal(docKind('Johnson Conditional Transfer Order (CTO-1)'), 'jpml_conditional_transfer_order');
  assert.equal(docKind('Johnson Transfer Order'), 'jpml_transfer_order');
  assert.equal(docKind('NOTICE of live-stream link for the Initial Case Management Conference set by CASE MANAGEMENT ORDER #5'), 'notice');
  assert.equal(docKind('Minutes of 1-23-2017'), 'minutes');
});
test('sealing wording is held (deliberately broad: false positives are withheld, never published)', () => {
  for (const t of ['Case Management Order No. 11 - Qualified Protective Order and Sealing Process Order', 'CMO #12 STANDING ORDER ON FILING MATERIALS UNDER SEAL', 'Order re restricted documents', 'in camera review order', 'Ex Parte Application', 'Redacted opinion'])
    assert.ok(SEAL_PATTERN.test(t), t);
  assert.ok(!SEAL_PATTERN.test('Case Management Order No. 12 - Early Discovery and Motions on Cross Cutting Issues'));
  const row = { url_kind: 'pdf_direct', printed_title: 'Order Governing Sealing', printed_label: null, row_text: '', url: 'https://www.x.uscourts.gov/a.pdf' };
  assert.deepEqual(queueDecision(row), { decision: 'held', reason: 'sealing_related_wording', matched: 'Seal' });
  assert.deepEqual(queueDecision({ ...row, printed_title: 'Order', url_kind: 'ecf_login' }), { decision: 'not_queued', reason: 'ecf_login_pacer_required' });
  assert.equal(queueDecision({ ...row, printed_title: 'Order' }).decision, 'queue');
});

// ---------- site-family parsers (synthetic fixtures that follow each court's real structure) ----------
const NJD = `<h1 id="page-title">Orders</h1><div class="field field--name-body"><div class="field__item">
<p><a href="/sites/njd/files/CaseMO11.pdf" target="_blank">ORDER</a></p><p>Date: 6/18/18</p><p>Description: <font>Case Managment Order #11</font></p>
<p><a href="/sites/njd/files/Order9.pdf">ORDER</a></p><p>Date: 9/7/17</p><p>Description: Case Managment Order #9</p>
<p><a href="/sites/njd/files/JohnsonTransferOrder.pdf">Johnson Transfer Order</a><br /><a href="/sites/njd/files/JohnsonCTO-1.pdf">Johnson Conditional Transfer Order (CTO-1)</a></p>
<p><a href="/sites/njd/files/Minutes-1-23-2017.pdf">Minutes of 1-23-2017</a></p><p><a href="/j-j-talcum-powder-orders">Orders &amp; Opinions</a></p><p><a href="https://ecf.njd.uscourts.gov/cgi-bin/ShowIndex.pl">Log into PACER</a></p></div></div>`;
test('NJD body parser: Date/Description paragraphs, several links per paragraph, dates printed in link text, navigation links ignored', () => {
  const { rows } = parseNjdBody({ html: NJD, pageUrl: 'https://www.njd.uscourts.gov/j-j-talcum-upcoming' });
  assert.equal(rows.length, 5);
  assert.equal(rows[0].printed_title, 'Case Managment Order #11');
  assert.equal(rows[0].printed_label, 'ORDER');
  assert.equal(rows[0].printed_date, '6/18/18');
  assert.equal(rows[0].date_iso, '2018-06-18');
  assert.equal(rows[1].date_iso, '2017-09-07');                       // month-first proven by the page (6/18/18)
  assert.equal(rows[2].printed_title, 'Johnson Transfer Order');
  assert.equal(rows[3].printed_title, 'Johnson Conditional Transfer Order (CTO-1)');
  assert.equal(rows[3].doc_kind, 'jpml_conditional_transfer_order');
  assert.equal(rows[4].date_iso, '2017-01-23');                        // "Minutes of 1-23-2017"
  assert.ok(rows.every(r => r.url_kind === 'pdf_direct' && r.url.startsWith('https://www.njd.uscourts.gov/sites/njd/files/')));
  assert.equal(NJD.slice(rows[0].row_span.start, rows[0].row_span.end).startsWith('<p><a href="/sites/njd/files/CaseMO11.pdf"'), true);
});
const PAED = `<h1 id="page-title">MDL 3163 In re GLP-1</h1><table class="views-table"><thead><tr><th>Date</th><th></th></tr></thead><tbody>
<tr><td><span property="dc:date" content="2025-12-23T00:00:00-05:00">12/23/2025</span></td><td><a href="https://www.paed.uscourts.gov/sites/paed/files/mdl-orders/25md3163_cm-ord_1.pdf">Case Management Order No. 1 – Initial Case Management Conference</a></td></tr>
<tr><td><span property="dc:date" content="2026-05-04T00:00:00-05:00">05/04/2026</span></td><td><a href="https://www.paed.uscourts.gov/sites/paed/files/mdl-orders/25md3163_cm-ord_11.pdf">Case Management Order No. 11 - Qualified Protective Order and Sealing Process Order</a></td></tr></tbody></table>`;
test('PAED orders table: exact printed title (en dash kept), printed date plus the page\'s machine-readable date cross-check', () => {
  const { rows } = parsePaedOrders({ html: PAED, pageUrl: 'https://www.paed.uscourts.gov/mdl/mdl3163/orders' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].printed_title, 'Case Management Order No. 1 – Initial Case Management Conference');
  assert.equal(rows[0].date_iso, '2025-12-23');
  assert.equal(rows[0].date_iso_cross_check, 'equal');
  assert.equal(rows[0].order_number, '1');
  assert.equal(queueDecision(rows[1]).decision, 'held');            // "Sealing Process Order"
  assert.equal(queueDecision(rows[0]).decision, 'queue');
});
const ILND = `<title>Northern District of Illinois</title><div class='panel panel-default'><div class='panel-heading'><h4 class='panel-title'><a data-toggle='collapse'>&nbspForms</a></h4></div><div class='panel-body'><p><a href="https://www.ilnd.uscourts.gov/_assets/_documents/_forms/_cmecf/MDL3060/Short%20Form%20Complaint.pdf">Short Form Complaint</a></p></div></div>
<div class='panel panel-default'><div class='panel-heading'><h4 class='panel-title'><a>&nbspMember Cases</a></h4></div><div class='panel-body'><table id='membercases'><tr><td>1:23-cv-00818</td><td>Evans</td></tr></table></div></div>
<div class='panel panel-default'><div class='panel-heading'><h4 class='panel-title'><a>&nbspCase Management Orders</a></h4></div><div class='panel-body'><table id='casemanagementorders'><thead><tr><th style='display:none'>id</th><th>Date Posted</th><th>Doc.#</th><th>Description </th></tr></thead><tbody>
<tr><td style='display:none'>1</td><td>02/16/2023</td><td>3</td><td><a href='https://ecf.ilnd.uscourts.gov/doc1/067128263841'>MDL CASE MANAGEMENT ORDER NO. 1<br></a></td></tr>
<tr><td style='display:none'>8</td><td>08/03/2023</td><td>175</td><td><a href='https://www.ilnd.uscourts.gov/_assets/_documents/_forms/_cmecf/MDL3060/CMO No. 7.pdf'>MDL CASE MANAGEMENT ORDER NO. 7<br></a></td></tr></tbody></table></div></div>`;
test('ILND accordion: tables by header names (Date Posted | Doc.# | Description), ECF links listed not queued, member-case table not mixed into documents', () => {
  const { rows, page } = parseIlndMdlDetails({ html: ILND, pageUrl: 'https://www.ilnd.uscourts.gov/mdl-details.aspx?x=1' });
  assert.deepEqual(rows.map(r => [r.section, r.printed_title, r.printed_date, r.doc_number, r.url_kind]),
    [['Forms', 'Short Form Complaint', null, null, 'pdf_direct'],
     ['Case Management Orders', 'MDL CASE MANAGEMENT ORDER NO. 1', '02/16/2023', '3', 'ecf_login'],
     ['Case Management Orders', 'MDL CASE MANAGEMENT ORDER NO. 7', '08/03/2023', '175', 'pdf_direct']]);
  assert.equal(rows[2].url, 'https://www.ilnd.uscourts.gov/_assets/_documents/_forms/_cmecf/MDL3060/CMO%20No.%207.pdf');
  assert.ok(page.panels.some(p => p.heading === 'Member Cases' && p.skipped));
  assert.deepEqual(printedCaseNumbers(ILND).case_numbers, []);       // the member-case table is excluded from case-number evidence
});
const MOED = `<h1 id="page-title">4:26-md-3185</h1><article class="node node--mdl-orders"><h2 class="node__title"><a href="/426md03185-0056">426md03185-0056</a></h2>
<div class="field--name-field-mdl-file"><span class="file"><a href="https://www.moed.uscourts.gov/sites/moed/files/documents/426md03185-0056.pdf" type="application/pdf; length=164991" title="426md03185-0056.pdf">0056</a></span></div>
<div class="field--name-field-mdl-date-filed"><div class="field__label">Date Filed:&nbsp;</div><div class="field__items"><div class="field__item"><span property="dc:date" content="2026-09-18T00:00:00-05:00">09/18/2026</span></div></div></div>
<div class="field--name-field-mdl-description"><div class="field__label">Description:&nbsp;</div><div class="field__items"><div class="field__item">Centralization Order</div></div></div></article>`;
test('MOED mdl-orders nodes: description, date filed, document number from the link, page-reported size kept as a hint', () => {
  const { rows } = parseMoedMdl({ html: MOED, pageUrl: 'https://www.moed.uscourts.gov/mdl/426-md-3185' });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].printed_title, rows[0].printed_date, rows[0].date_iso, rows[0].doc_number, rows[0].page_reported_bytes, rows[0].date_iso_cross_check], ['Centralization Order', '09/18/2026', '2026-09-18', '0056', 164991, 'equal']);
  assert.equal(rows[0].doc_kind, 'jpml_transfer_order');
});
const TXND = `<p><strong>IN RE: AT&amp;T Inc Customer Data Security Breach Litigation<br />3:24-md-03114-D</strong></p><table><tbody><tr><td><strong>Date Filed</strong></td><td><strong>Doc. #</strong></td><td><strong>Docket Text</strong></td></tr>
<tr><td>08/21/2024</td><td><strong><a href="/sites/default/files/documents/24md3114-12.pdf">12</a></strong></td><td><p><strong>CASE MANAGEMENT ORDER #3:</strong> NOTICE ... (Attachments: # <a href="/sites/default/files/documents/24md3114-12attach.pdf">1</a> J Furgeson Affidavit)</p></td></tr>
<tr><td>12/09/2024</td><td><strong><a href="/sites/default/files/documents/MDL3114-Doc33.pdf">33</a></strong></td><td><p><strong>CASE MANAGEMENT ORDER #12 STANDING ORDER ON FILING MATERIALS UNDER SEAL.</strong> (Ordered by Judge)</p></td></tr></tbody></table>`;
test('TXND docket table: Doc. # link is the PDF, docket text is the printed title, attachments become their own rows, seal wording is held', () => {
  const { rows, page } = parseTxndDocket({ html: TXND, pageUrl: 'https://www.txnd.uscourts.gov/mdl-324-md-03114' });
  assert.equal(page.title, 'IN RE: AT&T Inc Customer Data Security Breach Litigation 3:24-md-03114-D');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].doc_number, '12');
  assert.equal(rows[0].printed_title_lead, 'CASE MANAGEMENT ORDER #3:');
  assert.equal(rows[1].printed_title, 'J Furgeson Affidavit');
  assert.equal(rows[1].attachment_of, '12');
  assert.equal(queueDecision(rows[2]).decision, 'held');
  assert.equal(queueDecision(rows[0]).decision, 'queue');
});
test('JPML panel-orders table: one row per linked order with the printed MDL number and session', () => {
  const html = `<strong>September 2026 Hearing Session</strong><p><strong>Motions in Previously Centralized MDLs</strong></p><table><thead><tr><td><strong>3108</strong></td><td><a href="/sites/jpml/files/MDL-3108-Transfer_Order-9-26.pdf">IN RE: Change Healthcare</a></td></tr>
  <tr><td><strong>2873</strong></td><td>IN RE: AFFF <a href="/sites/jpml/files/MDL-2873-Transfer_Order-9-26.pdf">Transfer Order</a><a href="/sites/jpml/files/MDL-2873-Order_Denying_Transfer-9-26.pdf">Order Denying Transfer</a></td></tr></thead></table>`;
  const { rows } = parseJpmlPanelOrders({ html, pageUrl: 'https://www.jpml.uscourts.gov/panel-orders' });
  assert.deepEqual(rows.map(r => [r.mdl_number_printed, r.printed_title]), [['3108', 'IN RE: Change Healthcare'], ['2873', 'Transfer Order'], ['2873', 'Order Denying Transfer']]);
  assert.equal(rows[0].session_label_printed, 'September 2026 Hearing Session');
});

// ---------- listing record identity ----------
test('listing record hash covers only the row\'s own fields: stable across pages and retrievals, changes with the printed text', () => {
  const row = { section: 'S', row_ordinal: 1, printed_title: 'Order', printed_label: 'Order', printed_date: '1/2/20', date_iso: '2020-01-02', date_iso_basis: 'x', doc_number: null, url: 'https://www.a.uscourts.gov/a.pdf', url_kind: 'pdf_direct', row_text: 'ignored', row_span: { start: 1, end: 2 } };
  const a = listingRecord({ mdl: '1', courtId: 'a', pageUrl: 'https://www.a.uscourts.gov/p', pageRole: 'r', row });
  assert.equal(recordSha256(a), recordSha256(listingRecord({ mdl: '1', courtId: 'a', pageUrl: 'https://www.a.uscourts.gov/p', pageRole: 'r', row: { ...row, row_span: { start: 9, end: 99 }, row_text: 'other' } })));
  assert.notEqual(recordSha256(a), recordSha256(listingRecord({ mdl: '1', courtId: 'a', pageUrl: 'https://www.a.uscourts.gov/p', pageRole: 'r', row: { ...row, printed_title: 'Order No. 2' } })));
  assert.ok(!('row_text' in a) && !('row_span' in a));
});

// ---------- robots + polite client ----------
const ROBOTS = `User-agent: *\nCrawl-delay: 10\nAllow: /misc/*.css$\nDisallow: /misc/\nDisallow: /search/\nDisallow: /*/media/oembed\n\nUser-agent: AhrefsBot\nDisallow: /\n`;
test('robots.txt: group selection, longest match wins and Allow beats Disallow on ties, wildcards, Crawl-delay', () => {
  const policy = robotsPolicy(parseRobots(ROBOTS));
  assert.equal(policy.crawlDelay, 10);
  assert.equal(robotsAllows(policy, '/sites/njd/files/a.pdf').allowed, true);
  assert.equal(robotsAllows(policy, '/search/node?q=x').allowed, false);
  assert.equal(robotsAllows(policy, '/misc/x.js').allowed, false);
  assert.equal(robotsAllows(policy, '/misc/x.css').allowed, true);       // Allow /misc/*.css$ is longer than Disallow /misc/
  assert.equal(robotsAllows(policy, '/en/media/oembed').allowed, false);
  assert.equal(robotsAllows(robotsPolicy(parseRobots('')), '/anything').allowed, true);
  assert.equal(robotsAllows(robotsPolicy(parseRobots('User-agent: *\nDisallow:\n')), '/x').allowed, true);
});
function fakeNet(routes) {
  let time = 1_000_000;
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), at: time, ua: init.headers['User-Agent'], method: init.method }); const r = routes(String(url), calls.length); return r instanceof Response ? r : new Response(r.body ?? '', { status: r.status ?? 200, headers: r.headers ?? {} }); };
  return { calls, fetchImpl, now: () => time, pause: async ms => { time += ms; } };
}
test('polite client: robots fetched first, >= 10.5 s between requests when robots says Crawl-delay 10, plain UA, stays on permitted hosts', async () => {
  const net = fakeNet(url => url.endsWith('/robots.txt') ? { body: ROBOTS } : { body: '<html>ok</html>', headers: { 'content-type': 'text/html' } });
  const client = createPoliteClient({ ...net });
  const a = await client.get('https://www.njd.uscourts.gov/page-a');
  const b = await client.get('https://www.njd.uscourts.gov/page-b');
  assert.equal(a.status, 200);
  assert.equal(a.robots.crawl_delay_s, 10);
  const gaps = net.calls.slice(1).map((c, i) => c.at - net.calls[i].at);
  assert.ok(gaps.every(g => g >= 2500), 'robots request, page a, page b are spaced');
  assert.ok(net.calls[2].at - net.calls[1].at >= 10500, 'Crawl-delay honoured between the two pages');
  assert.ok(net.calls.every(c => /LegalSourceCompassCorpusBot/.test(c.ua) && !/@/.test(c.ua)), 'plain UA, no personal data');
  await assert.rejects(client.get('https://ecf.njd.uscourts.gov/doc1/123'), /URL_NOT_PERMITTED/);
  await assert.rejects(client.get('https://www.courtlistener.com/docket/1/'), /URL_NOT_PERMITTED/);
  await assert.rejects(client.get('http://www.njd.uscourts.gov/x'), /URL_NOT_PERMITTED/);
  await assert.rejects(client.get('https://www.njd.uscourts.gov:8443/x'), /URL_NOT_PERMITTED/);
  assert.equal(createPoliteClient({ ...net }).get('https://www.govinfo.gov/metadata/pkg/x/premis.xml') instanceof Promise, true);
});
test('polite client: disallowed paths are not requested; 403 stops the host (no retry, no other route); 429 Retry-After is honoured', async () => {
  const net = fakeNet((url, n) => url.endsWith('/robots.txt') ? { body: 'User-agent: *\nDisallow: /Judges/\n' } : url.includes('/blocked') ? { status: 403 } : url.includes('/limited') && n < 4 ? { status: 429, headers: { 'retry-after': '7' } } : { body: 'ok' });
  const client = createPoliteClient({ ...net });
  await assert.rejects(client.get('https://www.casd.uscourts.gov/Judges/Ohta/x'), e => e instanceof RobotsDisallowed && /Disallow \/Judges\//.test(e.rule));
  assert.equal(net.calls.filter(c => c.url.includes('/Judges/')).length, 0);
  const limited = await client.get('https://www.casd.uscourts.gov/limited');
  assert.equal(limited.status, 200);
  assert.ok(net.calls.filter(c => c.url.includes('/limited')).length >= 2);
  const waits = net.calls.filter(c => c.url.includes('/limited'));
  assert.ok(waits[1].at - waits[0].at >= 7000, 'Retry-After 7 s honoured');
  const forbidden = await client.get('https://www.casd.uscourts.gov/blocked');
  assert.equal(forbidden.status, 403);
  await assert.rejects(client.get('https://www.casd.uscourts.gov/another'), HostStopped);
});

// ---------- GovInfo ----------
test('GovInfo package ids from the registry master dockets (printed forms like 3:25md3140 included)', () => {
  assert.deepEqual(parseDocket('3:25md3140'), { office: '3', yy: '25', type: 'md', seq5: '03140' });
  assert.deepEqual(parseDocket('2:23-md-3080'), { office: '2', yy: '23', type: 'md', seq5: '03080' });
  assert.equal(parseDocket('not a docket'), null);
  const m = mdl => GOVINFO_MASTERS.find(x => x.mdl === mdl);
  assert.equal(packageId(m('2738')), 'USCOURTS-njd-3_16-md-02738');
  assert.equal(packageId(m('3140')), 'USCOURTS-flnd-3_25-md-03140');
  assert.equal(packageId(m('3060')), 'USCOURTS-ilnd-1_23-cv-00818');
  assert.equal(packageId(m('2873')), 'USCOURTS-scd-2_18-mn-02873');
  assert.equal(packageId(m('3108')), 'USCOURTS-mnd-0_24-md-03108');
  assert.equal(caseIdOf(m('3140')), '3:25md3140');                    // the matter's official-court id is reused
  assert.equal(caseIdOf(m('3047')), '4:22-md-03047');                 // else the registry docket number
});
const PKG = 'USCOURTS-njd-3_16-md-02738';
test('GovInfo PREMIS: only granule PDFs with their GPO SHA-256 fixity and size; MODS constituents give docket text and date, party list is never read', () => {
  const premis = `<premis><object xsi:type="file"><objectIdentifier><objectIdentifierValue>D1</objectIdentifierValue></objectIdentifier><objectCharacteristics><compositionLevel>0</compositionLevel></objectCharacteristics></object>
  <object xsi:type="file"><objectIdentifier><objectIdentifierValue>D2</objectIdentifierValue></objectIdentifier><objectCharacteristics><fixity><messageDigestAlgorithm>SHA-256</messageDigestAlgorithm><messageDigest>${'a'.repeat(64)}</messageDigest></fixity><size>241281</size></objectCharacteristics><originalName>${PKG}-1.pdf</originalName></object>
  <object xsi:type="file"><objectIdentifier><objectIdentifierValue>D3</objectIdentifierValue></objectIdentifier><objectCharacteristics><fixity><messageDigestAlgorithm>SHA-256</messageDigestAlgorithm><messageDigest>${'b'.repeat(64)}</messageDigest></fixity><size>99</size></objectCharacteristics><originalName>${PKG}.pdf</originalName></object></premis>`;
  assert.deepEqual(parsePremis(premis, PKG).map(f => [f.granule_id, f.sha256, f.bytes]), [[PKG + '-1', 'a'.repeat(64), 241281]]);
  const mods = `<mods><extension><party firstName="A" lastName="B" role="Plaintiff"></party></extension><titleInfo><title>JOHNSON &amp; JOHNSON TALCUM</title><partNumber>3:16-md-02738</partNumber></titleInfo>
  <relatedItem type="constituent" ID="id-${PKG}-1" xlink:href="x"><titleInfo><title>JOHNSON &amp; JOHNSON TALCUM</title><subTitle>OPINION and ORDER No. 17 (Granting). Signed on 1/9/2024. (kht)</subTitle><partNumber>1</partNumber></titleInfo><originInfo><dateIssued>2024-01-10</dateIssued></originInfo>
  <location><url access="raw object" displayLabel="PDF rendition">https://www.govinfo.gov/content/pkg/${PKG}/pdf/${PKG}-1.pdf</url></location>
  <extension><searchTitle>USCOURTS 3:16-md-02738; JOHNSON &amp; JOHNSON TALCUM; </searchTitle><courtName>United States District Court District of New Jersey</courtName><accessId>${PKG}-1</accessId><docketText>OPINION and ORDER No. 17 (Granting). Signed on 1/9/2024. (kht)</docketText></extension></relatedItem></mods>`;
  const parsed = parsePackageMods(mods, PKG);
  assert.equal(parsed.package_title.docket_number_published, '3:16-md-02738');
  assert.equal(parsed.constituents.length, 1);
  const g = parsed.constituents[0];
  assert.deepEqual([g.granule_id, g.date_issued, g.docket_text, g.docket_number_published, g.pdf_url], [PKG + '-1', '2024-01-10', 'OPINION and ORDER No. 17 (Granting). Signed on 1/9/2024. (kht)', '3:16-md-02738', `https://www.govinfo.gov/content/pkg/${PKG}/pdf/${PKG}-1.pdf`]);
  assert.ok(!JSON.stringify(parsed).includes('lastName'));
});

// ---------- GovInfo queue rows ----------
import { buildRows as buildGovinfoRows } from './build-govinfo-queue.mjs';
test('GovInfo queue rows: granule id is the identity, printed case number is the case id, sealing wording is held, already-registered rows are skipped, provenance names the PREMIS and MODS captures', () => {
  const pkg = 'USCOURTS-njd-3_16-md-02738';
  const premis = { status: 200, sha256: 'c'.repeat(64), bytes: 9000, retrieved_at: '2026-10-03T17:11:25.052Z', body_file: 'captures/www.govinfo.gov/p.xml' };
  const mods = { status: 200, sha256: 'd'.repeat(64), bytes: 1e6, retrieved_at: '2026-10-03T17:11:28.971Z', body_file: 'captures/www.govinfo.gov/m.xml.gz' };
  const summary = { package_id: pkg, package_title: { case_title: 'JOHNSON & JOHNSON TALCUM', docket_number_published: '3:16-md-02738' }, premis, mods };
  const granule = (part, text, date) => ({ mdl: '2738', court: 'njd', package_id: pkg, native_case_id: '3:16-md-02738', granule_id: pkg + '-' + part, part, problems: [],
    premis: { sha256: String(part).repeat(64).slice(0, 64), bytes: 1000 + part, fdsys_id: 'D' + part, original_name: pkg + '-' + part + '.pdf', file: premis },
    mods: { docket_text: text, date_issued: date, case_title: 'JOHNSON & JOHNSON TALCUM', docket_number_published: '3:16-md-02738', court_name: 'United States District Court District of New Jersey', pdf_url: `https://www.govinfo.gov/content/pkg/${pkg}/pdf/${pkg}-${part}.pdf` },
    pdf_url: `https://www.govinfo.gov/content/pkg/${pkg}/pdf/${pkg}-${part}.pdf` });
  const granules = [granule(1, 'OPINION and ORDER No. 17 (Granting). Signed on 1/9/2024. (kht)', '2024-01-10'), granule(2, 'ORDER sealing Exhibit A (Filed Under Seal).', '2024-02-01'), granule(3, 'ORDER No. 18.', '2024-03-01')];
  const first = buildGovinfoRows({ runDir: 'C:/run', key: '2738', rows: granules, summary });
  assert.equal(first.rows.length, 2);
  assert.deepEqual(first.held.map(h => [h.granule_id, h.reason]), [[pkg + '-2', 'sealing_related_wording']]);
  const row = first.rows[0];
  assert.deepEqual([row.provider, row.native_document_id, row.native_case_id, row.expected_bytes, row.provider_flags.sealing_related_locator_held], ['govinfo', pkg + '-1', '3:16-md-02738', 1001, false]);
  assert.equal(row.download_url, `https://www.govinfo.gov/content/pkg/${pkg}/pdf/${pkg}-1.pdf`);
  assert.equal(row.title, 'OPINION and ORDER No. 17 (Granting). Signed on 1/9/2024. (kht)');
  assert.equal(row.origins[0].listing.date_iso_basis, 'govinfo_mods_dateIssued');
  assert.equal(row.origins[0].govinfo.premis_url, `https://www.govinfo.gov/metadata/pkg/${pkg}/premis.xml`);
  assert.equal(row.origins[0].govinfo.provider_fixity_sha256, granules[0].premis.sha256);
  assert.equal(row.origins[0].source_url, `https://www.govinfo.gov/metadata/pkg/${pkg}/mods.xml`);
  assert.ok(!/lastName|firstName|"parties"|"party"\s*:/i.test(JSON.stringify(row)), 'no party data is carried');
  const again = buildGovinfoRows({ runDir: 'C:/run', key: '2738', rows: granules, summary, registered: new Set(['govinfo|' + pkg + '-1|3:16-md-02738|' + row.selected_source_record_sha256]) });
  assert.deepEqual([again.rows.length, again.skipped.length, again.held.length], [1, 1, 1]);
});
