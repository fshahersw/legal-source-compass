#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { claimFreshPrivateOutputDirectory, extractNativeTitleLinks, exactHttpSuccess, capBytes, shouldStopAfterCapture, unattemptedPlanItems } from './fl-html-capture-core.mjs';

const outputArg = process.argv.slice(2).find(arg => arg.startsWith('--output-dir='));
if (!outputArg) throw new Error('Pass a new immutable capture destination with --output-dir=private/audit-2026-10-05/full-state-codes/florida/<new-directory>.');
const privateRoot = path.resolve('private/audit-2026-10-05/full-state-codes/florida');
const base = await claimFreshPrivateOutputDirectory(outputArg.slice('--output-dir='.length), privateRoot);
const rawDir = path.join(base, 'raw');
const receiptDir = path.join(base, 'receipts');
const titleDir = path.join(rawDir, 'title-indexes');
const titleReceiptDir = path.join(receiptDir, 'title-indexes');
await Promise.all([rawDir, receiptDir, titleDir, titleReceiptDir].map(dir => fs.mkdir(dir, { recursive: true })));

const roman = n => {
  const values = [[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let out = '';
  for (const [value, glyph] of values) while (n >= value) { out += glyph; n -= value; }
  return out;
};
const titleNumbers = Array.from({ length: 49 }, (_, i) => i + 1);
const landingUrl = 'https://www.leg.state.fl.us/statutes/';
const titleUrlBase = 'https://www.leg.state.fl.us/statutes/';
const landingRaw = 'raw/statutes-landing.html';
const landingReceipt = 'receipts/statutes-landing.json';
const inventoryOut = 'title-chapter-inventory.json';
const runReceiptOut = 'capture-run.json';
const outPaths = [landingRaw, landingReceipt, inventoryOut, runReceiptOut];
for (const n of titleNumbers) {
  const slug = roman(n);
  outPaths.push(`raw/title-indexes/${slug}.html`, `receipts/title-indexes/${slug}.json`);
}
for (const rel of outPaths) {
  try { await fs.access(path.join(base, rel)); throw new Error(`Refusing to overwrite immutable capture: ${rel}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

const maxBodyBytes = 2 * 1024 * 1024;
const maxTotalBytes = 45 * 1024 * 1024;
let totalBytes = 0;
let lastRequestStart = null;
const observations = [];
let stopped = null;
const completedPlanIds = new Set();
const planned = [{ id: 'landing', role: '2026-statutes-landing-page', requestedUrl: landingUrl }];
for (const n of titleNumbers) planned.push({ id: `title-${roman(n)}`, role: `2026-title-index-${roman(n)}`, requestedUrl: null, status: 'not_discovered_until_landing_capture' });

async function waitStart() {
  if (lastRequestStart !== null) {
    const remaining = 1000 - (Date.now() - lastRequestStart);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  }
  lastRequestStart = Date.now();
  return new Date(lastRequestStart).toISOString();
}

function runCurl(requestedUrl, rawPath, byteLimit) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl.exe', [
      '--silent', '--show-error', '--location', '--max-redirs', '5', '--max-time', '45',
      '--max-filesize', String(byteLimit), '--user-agent', 'Legal-Source-Atlas/1.0 (public Florida statutes source capture)',
      '--dump-header', '-', '--output', rawPath, '--write-out', '\n__FL_CAPTURE__%{http_code}\n%{url_effective}\n%{content_type}\n%{size_download}\n', requestedUrl,
    ], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
function parseCurlOutput(stdout) {
  const marker = stdout.lastIndexOf('\n__FL_CAPTURE__');
  if (marker < 0) return { headersText: stdout, status: null, finalUrl: null, contentType: null };
  const fields = stdout.slice(marker).trim().split('\n');
  const status = Number(fields[0].replace('__FL_CAPTURE__', '')) || null;
  return { headersText: stdout.slice(0, marker), status, finalUrl: fields[1] || null, contentType: fields[2] || null };
}

async function requestAndSave({ requestedUrl, rawPath, receiptPath, sourceRole }) {
  const startedAt = await waitStart();
  const absoluteRawPath = path.join(base, rawPath);
  let curlResult = null;
  let body = Buffer.alloc(0);
  let errorText = null;
  try {
    const byteLimit = capBytes(maxBodyBytes, maxTotalBytes, totalBytes);
    if (byteLimit <= 0) throw new Error('Aggregate byte cap reached before request start');
    curlResult = await runCurl(requestedUrl, absoluteRawPath, byteLimit);
    try { body = await fs.readFile(absoluteRawPath); } catch { body = Buffer.alloc(0); }
    if (curlResult.code !== 0) errorText = `curl exit ${curlResult.code}: ${curlResult.stderr.trim() || 'transport/size failure'}`;
  } catch (error) {
    errorText = String(error?.message || error);
  }
  const parsed = parseCurlOutput(curlResult?.stdout || '');
  const headerBlocks = parsed.headersText.match(/HTTP\/[^\r\n]+\r?\n(?:[^\r\n]*\r?\n)*/g) || [];
  const finalHeaderBlock = headerBlocks.at(-1) || '';
  const header = name => finalHeaderBlock.match(new RegExp(`^${name}:\\s*([^\\r\\n]*)`, 'im'))?.[1] ?? null;
  const status = parsed.status;
  const receipt = {
    schemaVersion: 'florida-online-sunshine-html-capture/1', sourceRole,
    requestedUrl, finalUrl: parsed.finalUrl, requestMethod: 'GET', startedAt,
    completedAt: new Date().toISOString(), httpStatus: status,
    contentType: parsed.contentType || header('content-type'),
    contentLengthHeader: header('content-length'),
    bytes: body.length,
    sha256: body.length ? crypto.createHash('sha256').update(body).digest('hex') : null,
    outcome: errorText ? 'transport_or_size_failure' : exactHttpSuccess(status) ? 'captured' : 'http_error_body_preserved',
    rawPath: body.length || status ? rawPath : null,
    error: errorText,
  };
  if (!curlResult) await fs.writeFile(absoluteRawPath, Buffer.alloc(0), { flag: 'wx' });
  await fs.writeFile(path.join(base, receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  totalBytes += body.length;
  observations.push(receipt);
  if (errorText || !exactHttpSuccess(status)) {
    stopped = { requestedUrl, status, error: errorText, outcome: receipt.outcome };
  }
  if (sourceRole === '2026-statutes-landing-page') completedPlanIds.add('landing');
  const titlePlanItem = planned.find(item => item.role === sourceRole);
  if (titlePlanItem && exactHttpSuccess(status) && !errorText) completedPlanIds.add(titlePlanItem.id);
  if (totalBytes >= maxTotalBytes) stopped ||= { error: 'Aggregate byte cap reached', outcome: 'capture_limit' };
  return { receipt, body };
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function stripTags(s) { return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function titleMetadata(html, expectedRoman) {
  const row = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]).find(r => new RegExp(`<a[^>]+name=["']Title${expectedRoman}["']`, 'i').test(r));
  if (!row) return null;
  const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => stripTags(m[1]));
  return { titleNumber: expectedRoman, titleHeading: cells[1] || null, chapterRangeAsPrinted: cells[2] || null };
}
function chapterLinks(html) {
  const found = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href=["']([^"']*App_mode=Display_Statute[^"']*ContentsIndex\.html[^"']*)["'][^>]*>\s*Chapter\s+(\d+[A-Za-z]?)[^<]*<\/a>/gi;
  for (const m of html.matchAll(pattern)) {
    const href = decodeEntities(m[1]);
    const chapter = m[2];
    const url = new URL(href, 'https://www.leg.state.fl.us/statutes/').href;
    if (seen.has(url)) continue;
    seen.add(url);
    const before = html.slice(Math.max(0, m.index - 80), m.index);
    const after = html.slice(m.index + m[0].length, m.index + m[0].length + 180);
    const titleMatch = before.match(/<a\b[^>]*name=["']Title([IVXL]+)["']/i);
    const context = stripTags(after).replace(/^\s*/, '');
    found.push({ chapter, chapterHeadingAsPrinted: context || null, titleRoman: titleMatch?.[1] || null, contentsIndexUrl: url });
  }
  return found;
}

const landing = await requestAndSave({ requestedUrl: landingUrl, rawPath: landingRaw, receiptPath: landingReceipt, sourceRole: '2026-statutes-landing-page' });
let titleRows = [];
if (!stopped) {
  titleRows = extractNativeTitleLinks(landing.body.toString('utf8'), landingUrl).map(row => ({ ...row, roman: row.titleRoman }));
  for (const item of planned.filter(x => x.id.startsWith('title-'))) {
    const link = titleRows.find(row => row.roman === item.id.slice('title-'.length));
    if (link) { item.requestedUrl = link.resolvedUrl; item.literalRawHref = link.rawHref; item.status = 'discovered_from_landing_html'; }
    else item.status = 'missing_from_landing_html';
  }
  if (titleRows.length !== 49 || titleRows.some((row, i) => row.roman !== roman(i + 1) || row.displayedRoman !== row.roman)) {
    stopped = { error: `Landing title inventory mismatch: expected 49 ordered native title links, observed ${titleRows.length}`, outcome: 'inventory_validation_failure' };
  }
}

const titles = [];
if (!stopped) for (const row of titleRows) {
  const slug = row.roman;
  const capture = await requestAndSave({ requestedUrl: row.resolvedUrl, rawPath: `raw/title-indexes/${slug}.html`, receiptPath: `receipts/title-indexes/${slug}.json`, sourceRole: `2026-title-index-${slug}` });
  const html = capture.body.toString('utf8');
  const metadata = titleMetadata(html, slug);
  const chapters = chapterLinks(html);
  titles.push({ ...metadata, titleIndexLiteralHref: row.rawHref, titleIndexUrl: row.resolvedUrl, receiptPath: `receipts/title-indexes/${slug}.json`, chapterLinkCountObserved: chapters.length, chapters });
  if (!metadata || chapters.length === 0 && !/chapter/i.test(metadata.chapterRangeAsPrinted || '')) {
    stopped = { error: `Title index did not validate expected title row/chapter links for ${slug}`, outcome: 'inventory_validation_failure' };
  }
  if (stopped) break;
}

if (!stopped) {
  const all = titles.flatMap(t => t.chapters.map(ch => ({ ...ch, titleRoman: t.titleNumber, titleHeadingAsPrinted: t.titleHeading })));
  const byChapter = new Map();
  for (const chapter of all) {
    const existing = byChapter.get(chapter.chapter) || [];
    existing.push(chapter);
    byChapter.set(chapter.chapter, existing);
  }
  const inventory = {
    schemaVersion: 'florida-native-title-chapter-inventory/1', capturedAt: new Date().toISOString(),
    publisherEditionLabel: 'The 2026 Florida Statutes', pageDateObserved: stripTags(landing.body.toString('utf8').match(/<td[^>]*id=["']date["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || ''),
    landingUrl, landingReceiptPath: landingReceipt,
    observationMethod: 'Direct title-index links found on the official 2026 landing page; each native Display_Index title page captured and chapter ContentsIndex links parsed from the raw HTML.',
    titleCount: titles.length, chapterTitleMembershipCount: all.length,
    uniqueChapterCount: byChapter.size,
    duplicateChapterMemberships: [...byChapter.entries()].filter(([, rows]) => rows.length > 1).map(([chapter, rows]) => ({ chapter, titleRomans: rows.map(row => row.titleRoman), urls: rows.map(row => row.contentsIndexUrl) })),
    titles,
  };
  await fs.writeFile(path.join(base, inventoryOut), `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
}

const runReceipt = {
  schemaVersion: 'florida-online-sunshine-html-inventory-run/1',
  completedAt: new Date().toISOString(), landingUrl, titleIndexPagesRequested: observations.filter(x => x.sourceRole.startsWith('2026-title-index-')).length,
  expectedTitleIndexPages: 49, totalBytesCaptured: totalBytes, minRequestStartSpacingMs: observations.slice(1).reduce((min, current, i) => {
    const previous = Date.parse(observations[i].startedAt), thisStart = Date.parse(current.startedAt);
    return Math.min(min, thisStart - previous);
  }, Infinity), stop: stopped,
  plan: planned,
  unattempted: unattemptedPlanItems(planned, completedPlanIds),
  captures: observations.map(({ sourceRole, requestedUrl, startedAt, httpStatus, bytes, sha256, outcome }) => ({ sourceRole, requestedUrl, startedAt, httpStatus, bytes, sha256, outcome })),
};
await fs.writeFile(path.join(base, runReceiptOut), `${JSON.stringify(runReceipt, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ titleLinksOnLanding: titleRows.length, titlePagesCaptured: runReceipt.titleIndexPagesRequested, totalBytes, inventoryCreated: !stopped, stop: stopped, minRequestStartSpacingMs: runReceipt.minRequestStartSpacingMs }, null, 2));
if (stopped) process.exitCode = 2;
