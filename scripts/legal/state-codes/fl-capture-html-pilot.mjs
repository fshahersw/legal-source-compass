#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { claimFreshPrivateOutputDirectory, exactHttpSuccess, capBytes, unattemptedPlanItems } from './fl-html-capture-core.mjs';

const root = process.cwd();
const captureArg = process.argv.slice(2).find(arg => arg.startsWith('--capture-root='));
const captureRoot = captureArg ? path.resolve(captureArg.slice('--capture-root='.length)) : '';
const outputArg = process.argv.slice(2).find(arg => arg.startsWith('--output-dir='));
const inventoryArg = process.argv.slice(2).find(arg => arg.startsWith('--inventory='));
if (!captureRoot || !outputArg) throw new Error('Provide --capture-root=<completed official index directory> and a new --output-dir=private/... destination.');
const privateRoot = path.resolve('private/audit-2026-10-05/full-state-codes/florida');
const base = await claimFreshPrivateOutputDirectory(outputArg.slice('--output-dir='.length), privateRoot);
const inventoryPath = path.resolve(captureRoot, inventoryArg?.slice('--inventory='.length) || 'title-chapter-inventory.json');
const inventoryBytes = await fs.readFile(inventoryPath);
const inventory = JSON.parse(inventoryBytes.toString('utf8'));
if (inventoryArg) {
  const inventoryReceipt = JSON.parse(await fs.readFile(inventoryPath.replace(/\.json$/i, '.receipt.json'), 'utf8'));
  if (crypto.createHash('sha256').update(inventoryBytes).digest('hex') !== inventoryReceipt.outputSha256) throw new Error('Supplied inventory derivative failed its stored hash receipt.');
}
if ((inventory.publisherEditionLabel ?? inventory.editionLabelObserved) !== 'The 2026 Florida Statutes' || inventory.titleCount !== 49) throw new Error('Pilot requires the verified 2026 49-title native inventory.');

const byId = new Map(inventory.titles.flatMap(title => title.chapters.map(chapter => {
  const id = chapter.nativeChapterId ?? chapter.chapter;
  return [id, { ...chapter, chapter: id, titleRoman: title.titleNumber, titleHeadingAsPrinted: title.titleHeadingAsPrinted ?? title.titleHeading }];
})));
const args = process.argv.slice(2);
const listArg = args.find(arg => arg.startsWith('--chapters='));
const nextArg = args.find(arg => arg.startsWith('--next-uncaptured='));
const excludeArg = args.find(arg => arg.startsWith('--exclude-chapters='));
const maxBodyMiB = Number(args.find(arg => arg.startsWith('--max-body-mib='))?.split('=')[1] ?? 4);
const maxTotalMiB = Number(args.find(arg => arg.startsWith('--max-total-mib='))?.split('=')[1] ?? 24);
if (!Number.isFinite(maxBodyMiB) || maxBodyMiB <= 0 || maxBodyMiB > 25 || !Number.isFinite(maxTotalMiB) || maxTotalMiB <= 0 || maxTotalMiB > 250) throw new Error('Pilot caps must be positive and no greater than 25 MiB/body and 250 MiB total.');
const orderedIds = inventory.titles.flatMap(title => title.chapters.map(chapter => chapter.nativeChapterId ?? chapter.chapter));
const excluded = new Set((excludeArg?.split('=')[1] || '').split(',').map(x => x.trim()).filter(Boolean));
let chapterIds = listArg ? listArg.split('=')[1].split(',').map(x => x.trim()).filter(Boolean) : [];
if (nextArg) {
  const count = Number(nextArg.split('=')[1]);
  if (!Number.isSafeInteger(count) || count < 1 || count > 50) throw new Error('--next-uncaptured count must be from 1 through 50.');
  chapterIds = orderedIds.filter(id => !excluded.has(id)).slice(0, count);
}
if (!chapterIds.length || chapterIds.length > 50 || new Set(chapterIds).size !== chapterIds.length) throw new Error('Supply 1–50 unique chapter IDs.');
for (const id of chapterIds) if (!byId.has(id)) throw new Error(`Pilot chapter ${id} is not present in the captured native inventory.`);
const rawDir = path.join(base, 'raw');
const receiptsDir = path.join(base, 'receipts');
await Promise.all([rawDir, receiptsDir].map(dir => fs.mkdir(dir, { recursive: true })));
const expectedPaths = ['pilot-manifest.json'];
for (const id of chapterIds) expectedPaths.push(`raw/ch${id}-contents-index.html`, `receipts/ch${id}-contents-index.json`, `raw/ch${id}-full-chapter.html`, `receipts/ch${id}-full-chapter.json`);
for (const rel of expectedPaths) {
  try { await fs.access(path.join(base, rel)); throw new Error(`Refusing overwrite of pilot output ${rel}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

const maxBytesPerBody = maxBodyMiB * 1024 * 1024;
const maxTotalBytes = maxTotalMiB * 1024 * 1024;
let totalBytes = 0;
let lastStart = null;
const captures = [];
let stop = null;

async function nextStart() {
  if (lastStart !== null) {
    const remain = 1000 - (Date.now() - lastStart);
    if (remain > 0) await new Promise(resolve => setTimeout(resolve, remain));
  }
  lastStart = Date.now();
  return new Date(lastStart).toISOString();
}
function curl(url, rawFile, maxBytes) {
  return new Promise((resolve, reject) => {
    const p = spawn('curl.exe', [
      '--silent', '--show-error', '--location', '--max-redirs', '5', '--max-time', '60',
      '--max-filesize', String(maxBytes), '--user-agent', 'Legal-Source-Atlas/1.0 (public Florida statutes source capture)',
      '--dump-header', '-', '--output', rawFile, '--write-out', '\n__FL_CAPTURE__%{http_code}\n%{url_effective}\n%{content_type}\n', url,
    ], { windowsHide: true });
    let stdout = '', stderr = '';
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stdout.on('data', x => stdout += x); p.stderr.on('data', x => stderr += x);
    p.on('error', reject); p.on('close', code => resolve({ code, stdout, stderr }));
  });
}
function parseOutput(stdout) {
  const ix = stdout.lastIndexOf('\n__FL_CAPTURE__');
  if (ix < 0) return { headers: stdout, status: null, finalUrl: null, contentType: null };
  const fields = stdout.slice(ix).trim().split('\n');
  const status = Number(fields[0].replace('__FL_CAPTURE__', '')) || null;
  return { headers: stdout.slice(0, ix), status, finalUrl: fields[1] || null, contentType: fields[2] || null };
}
async function capture(url, rawRel, receiptRel, role) {
  const startedAt = await nextStart();
  const rawAbs = path.join(base, rawRel);
  let result = null, body = Buffer.alloc(0), error = null;
  try {
    const cap = capBytes(maxBytesPerBody, maxTotalBytes, totalBytes);
    if (cap <= 0) throw new Error('Aggregate body cap reached before request.');
    result = await curl(url, rawAbs, cap);
    try { body = await fs.readFile(rawAbs); } catch { body = Buffer.alloc(0); }
    if (result.code !== 0) error = `curl exit ${result.code}: ${result.stderr.trim() || 'transport/size failure'}`;
  } catch (e) { error = String(e?.message || e); }
  const parsed = parseOutput(result?.stdout || '');
  const blocks = parsed.headers.match(/HTTP\/[^\r\n]+\r?\n(?:[^\r\n]*\r?\n)*/g) || [];
  const finalHeaders = blocks.at(-1) || '';
  const header = name => finalHeaders.match(new RegExp(`^${name}:\\s*([^\\r\\n]*)`, 'im'))?.[1] ?? null;
  const receipt = {
    schemaVersion: 'florida-online-sunshine-html-capture/1', sourceRole: role,
    requestedUrl: url, finalUrl: parsed.finalUrl, requestMethod: 'GET', startedAt,
    completedAt: new Date().toISOString(), httpStatus: parsed.status,
    contentType: parsed.contentType || header('content-type'), contentLengthHeader: header('content-length'),
    bytes: body.length, sha256: body.length ? crypto.createHash('sha256').update(body).digest('hex') : null,
    outcome: error ? 'transport_or_size_failure' : exactHttpSuccess(parsed.status) ? 'captured' : 'http_error_body_preserved',
    rawPath: body.length || parsed.status ? rawRel : null, error,
  };
  if (!result) await fs.writeFile(rawAbs, Buffer.alloc(0), { flag: 'wx' });
  await fs.writeFile(path.join(base, receiptRel), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  totalBytes += body.length;
  captures.push(receipt);
  if (error || !exactHttpSuccess(parsed.status)) {
    stop = { url, status: parsed.status, error, outcome: receipt.outcome };
  }
  return { body, receipt };
}
function entityDecode(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function stripTags(s) { return entityDecode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function chapterNumber(id) { return String(id).padStart(4, '0'); }
function sectionLinks(html, chapter) {
  const rows = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href=["']([^"']*Sections\/([^/"'?&]+)\.html(?:[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(pattern)) {
    const nativeCitation = stripTags(m[3]);
    const url = new URL(entityDecode(m[1]), 'https://www.leg.state.fl.us/statutes/').href;
    if (!/^\d+[A-Za-z]?(?:\.\d+[A-Za-z]?)*$/.test(nativeCitation)) continue;
    if (seen.has(nativeCitation)) continue;
    seen.add(nativeCitation);
    rows.push({ nativeCitationAsPrinted: nativeCitation, publisherSectionPath: decodeURIComponent(new URL(url).searchParams.get('URL') || ''), sectionUrl: url, catchlineAsPrinted: null });
  }
  const indexItem = /<div\b[^>]*class=["']IndexItem["'][^>]*>([\s\S]*?)<\/div>/gi;
  const items = [...html.matchAll(indexItem)].map(m => m[1]);
  for (const item of items) {
    const link = item.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const cite = stripTags(link[2]);
    const row = rows.find(x => x.nativeCitationAsPrinted === cite);
    if (row) row.catchlineAsPrinted = stripTags(item.slice(link.index + link[0].length));
  }
  return rows.map(row => ({ ...row, chapterNativeId: chapter }));
}
function sectionHeadingOccurrences(html) {
  const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ');
  const matches = [...visible.matchAll(/(?:^|[>\s])(?:§\s*)?(\d{1,4}(?:\.\d+[A-Za-z]?)*)\.\s+([^<\r\n]{1,250})/g)];
  return matches.map(m => ({ citationAsPrinted: m[1], headingTextAsPrinted: stripTags(m[2]) }));
}

const chapters = [];
const planned = chapterIds.flatMap(id => [
  { id: `chapter-${id}-index`, requestedUrl: byId.get(id).contentsIndexUrl, role: 'contents-index' },
  { id: `chapter-${id}-full`, requestedUrl: null, role: 'full-chapter', status: 'waiting-for-publisher-link-from-index' },
]);
const completedPlanIds = new Set();
for (const id of chapterIds) {
  if (stop) break;
  const source = byId.get(id);
  const indexPlanId = `chapter-${id}-index`;
  const fullPlanId = `chapter-${id}-full`;
  const contentIndex = await capture(source.contentsIndexUrl, `raw/ch${id}-contents-index.html`, `receipts/ch${id}-contents-index.json`, `2026-chapter-${id}-contents-index`);
  if (exactHttpSuccess(contentIndex.receipt.httpStatus) && !contentIndex.receipt.error) completedPlanIds.add(indexPlanId);
  if (stop) { chapters.push({ chapter: id, source, contentsIndexReceipt: contentIndex.receipt, status: 'stopped_after_index_capture' }); break; }
  const indexHtml = contentIndex.body.toString('utf8');
  const viewLink = [...indexHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].find(m => /View Entire Chapter/i.test(stripTags(m[2])));
  if (!viewLink) {
    chapters.push({ chapter: id, source, contentsIndexReceipt: contentIndex.receipt, status: 'no_publisher_view_entire_chapter_link', sections: sectionLinks(indexHtml, id) });
    stop = { chapter: id, error: 'Official chapter contents index did not expose a View Entire Chapter anchor; stopped rather than constructing a guessed URL.', outcome: 'publisher_link_missing' };
    break;
  }
  const fullChapterUrl = new URL(entityDecode(viewLink[1]), 'https://www.leg.state.fl.us/statutes/').href;
  planned.find(item => item.id === fullPlanId).requestedUrl = fullChapterUrl;
  planned.find(item => item.id === fullPlanId).status = 'discovered_from_captured_contents_index';
  const sectionRows = sectionLinks(indexHtml, id);
  const full = await capture(fullChapterUrl, `raw/ch${id}-full-chapter.html`, `receipts/ch${id}-full-chapter.json`, `2026-chapter-${id}-full-text`);
  if (exactHttpSuccess(full.receipt.httpStatus) && !full.receipt.error) completedPlanIds.add(fullPlanId);
  chapters.push({
    chapter: id, titleRoman: source.titleRoman, titleHeadingAsPrinted: source.titleHeadingAsPrinted,
    chapterHeadingAsPrinted: source.chapterHeadingAsPrinted, contentsIndexUrl: source.contentsIndexUrl,
    contentsIndexReceiptPath: `receipts/ch${id}-contents-index.json`, fullChapterUrl,
    fullChapterReceiptPath: `receipts/ch${id}-full-chapter.json`,
    status: full.receipt.outcome === 'captured' ? 'captured' : full.receipt.outcome,
    sectionLinkCount: sectionRows.length, sections: sectionRows,
    fullTextHeadingOccurrenceCount: sectionHeadingOccurrences(full.body.toString('utf8')).length,
    observedDistinctHeadingOccurrences: sectionHeadingOccurrences(full.body.toString('utf8')),
    currentnessNote: 'Publisher edition label observed as 2026. This capture does not classify future-effective provisions or certify legal effect.',
  });
  if (stop) break;
}
const minSpacing = captures.slice(1).reduce((min, item, i) => Math.min(min, Date.parse(item.startedAt) - Date.parse(captures[i].startedAt)), Infinity);
const manifest = {
  schemaVersion: 'florida-official-html-bounded-pilot/1', capturedAt: new Date().toISOString(),
  publisherEditionLabel: inventory.publisherEditionLabel, observedPublisherPageDate: inventory.pageDateObserved,
  inventoryPath: path.relative(root, inventoryPath).replaceAll('\\', '/'),
  inventorySha256: crypto.createHash('sha256').update(inventoryBytes).digest('hex'),
  pilotRule: nextArg ? `First ${chapterIds.length} uncaptured chapters in native title-link order, excluding ${[...excluded].join(', ')}; this bounded batch is not a completeness or legal-coverage sample.` : 'Selected chapters for a bounded parser/capture pilot; selection is not a completeness or legal-coverage sample.',
  chaptersRequested: chapterIds, chaptersCapturedOrAttempted: chapters.length,
  chapterLinkInventoryCount: chapters.reduce((sum, chapter) => sum + (chapter.sectionLinkCount || 0), 0),
  sectionRecordsArePublisherIndexLinks: true,
  totalBytesCaptured: totalBytes, minRequestStartSpacingMs: minSpacing,
  stop, plan: planned, unattempted: unattemptedPlanItems(planned, completedPlanIds),
  captures: captures.map(c => ({ sourceRole: c.sourceRole, requestedUrl: c.requestedUrl, finalUrl: c.finalUrl, startedAt: c.startedAt, status: c.httpStatus, bytes: c.bytes, sha256: c.sha256, outcome: c.outcome, rawPath: c.rawPath })),
  chapters,
};
await fs.writeFile(path.join(base, 'pilot-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ chaptersRequested: chapterIds.length, chaptersCapturedOrAttempted: chapters.length, sectionLinks: manifest.chapterLinkInventoryCount, bytes: totalBytes, minRequestStartSpacingMs: minSpacing, stop }, null, 2));
if (stop) process.exitCode = 2;
