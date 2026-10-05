#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const out = path.join(root, 'private/audit-2026-10-05/full-state-codes/nc');
const rawDir = path.join(out, 'raw');
const chapterDir = path.join(rawDir, 'chapters-html');
const receiptsDir = path.join(out, 'receipts');
const origin = 'https://www.ncleg.gov';
const tocUrl = `${origin}/Laws/GeneralStatutesTOC`;
const supportUrls = [
  `${origin}/Laws/Modifications/Current`,
  `${origin}/Laws/GeneralStatutes#caveats`,
];
const paceMs = 1000;
const concurrency = 2;
const retrievedAt = () => new Date().toISOString();
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const safeName = value => value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-|-$/g, '');

await fs.mkdir(chapterDir, { recursive: true });
await fs.mkdir(receiptsDir, { recursive: true });

async function fetchCaptured(url, key) {
  let lastError;
  const initialStartedAt = retrievedAt();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const startedAt = retrievedAt();
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'Legal-Source-Atlas/1.0 (public statutory source capture)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(120000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const receipt = {
        captureSchema: 'nc-state-code-source-capture/1',
        requestedUrl: url,
        finalUrl: response.url,
        retrievedAt: startedAt,
        completedAt: retrievedAt(),
        httpStatus: response.status,
        contentType: response.headers.get('content-type'),
        contentLengthHeader: response.headers.get('content-length'),
        bytes: bytes.length,
        sha256: sha256(bytes),
        attempt,
        outcome: response.ok ? 'captured' : 'http_error_body_preserved',
      };
      if (response.ok) return { bytes, receipt };
      lastError = new Error(`HTTP ${response.status} for ${url}`);
      if (response.status === 401 || response.status === 403 || response.status === 429) {
        // Save the response body and receipt, then stop the chapter pass. Never
        // turn a server-directed Retry-After into an unbounded wait.
        return { bytes, receipt };
      }
      if (response.status >= 500 && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
      } else {
        return { bytes, receipt };
      }
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
  return {
    bytes: null,
    receipt: {
      captureSchema: 'nc-state-code-source-capture/1',
      requestedUrl: url,
      retrievedAt: initialStartedAt,
      completedAt: retrievedAt(),
      outcome: 'request_failed',
      error: String(lastError?.message || lastError),
    },
  };
}

async function saveCapture(key, url, directory, extension) {
  const { bytes, receipt } = await fetchCaptured(url, key);
  const prefix = safeName(key);
  if (bytes) {
    const rawPath = path.join(directory, `${prefix}.${extension}`);
    await fs.writeFile(rawPath, bytes, { flag: 'wx' });
    receipt.rawPath = path.relative(root, rawPath).replaceAll('\\', '/');
  }
  const receiptPath = path.join(receiptsDir, `${prefix}.json`);
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return receipt;
}

const toc = await saveCapture('general-statutes-toc', tocUrl, rawDir, 'html');
if (!toc.rawPath || toc.httpStatus !== 200) throw new Error('Official General Statutes TOC could not be captured; stopping before chapter requests.');
const tocHtml = await fs.readFile(path.join(root, toc.rawPath), 'utf8');
const tocText = tocHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ');
const versionBlock = tocHtml.match(/The General Statutes include changes through([\s\S]*?)<\/h5>/i)?.[1] || '';
const versionStatement = versionBlock
  ? `The General Statutes include changes through ${versionBlock.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s+\./g, '.')}`
  : null;
const chapterLinks = new Map();
const linkRegex = /<a\b[^>]*href=["']([^"']*\/EnactedLegislation\/Statutes\/HTML\/ByChapter\/Chapter_([^"']+)\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
for (const match of tocHtml.matchAll(linkRegex)) {
  const urlPath = match[1].replaceAll('&amp;', '&');
  const chapterId = match[2];
  chapterLinks.set(chapterId, { chapterId, path: urlPath, sourceUrl: new URL(urlPath, origin).href });
}
if (!chapterLinks.size) throw new Error('No official ByChapter HTML links were found in the captured TOC.');

for (const [index, url] of supportUrls.entries()) {
  await saveCapture(index === 0 ? 'law-modifications-current' : 'general-statutes-caveats', url, rawDir, 'html');
}

const chapters = [...chapterLinks.values()].sort((a, b) => a.chapterId.localeCompare(b.chapterId, undefined, { numeric: true }));
const captures = [];
let cursor = 0;
let nextAllowedAt = 0;
let reservation = Promise.resolve();
let stopReason = null;
async function reserveRequestStart() {
  let release;
  const turn = new Promise(resolve => { release = resolve; });
  const previous = reservation;
  reservation = previous.then(() => turn);
  await previous;
  try {
    if (stopReason) return false;
    const wait = Math.max(0, nextAllowedAt - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    if (stopReason) return false;
    nextAllowedAt = Date.now() + paceMs;
    return true;
  } finally {
    release();
  }
}
async function worker() {
  while (true) {
    if (stopReason) return;
    if (!await reserveRequestStart()) return;
    const index = cursor++;
    if (index >= chapters.length) return;
    const chapter = chapters[index];
    const receipt = await saveCapture(`chapter-${chapter.chapterId}`, chapter.sourceUrl, chapterDir, 'html');
    captures[index] = { ...chapter, ...receipt };
    if ([401, 403, 429].includes(receipt.httpStatus)) {
      stopReason = `Stopped after preserving HTTP ${receipt.httpStatus} response for Chapter ${chapter.chapterId}.`;
    } else if (!receipt.rawPath || receipt.httpStatus !== 200) {
      // Preserve the gap in inventory; do not silently treat it as acquired.
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const inventory = {
  schemaVersion: 'nc-general-statutes-inventory/1',
  assembledAt: retrievedAt(),
  source: {
    publisher: 'North Carolina General Assembly',
    tocUrl,
    tocCapture: toc,
    publishedVersionStatement: versionStatement,
    sourceQualification: 'The NCGA chapter and section pages state that the General Statutes published on the website are not official. They are preserved as the legislature-hosted published code pages, not asserted as the official enrolled text or as a complete statement of later uncodified/session-law changes.',
    chapterPdfAvailableAtToc: true,
    retrievalMethod: 'official NCGA chapter HTML links from captured General Statutes TOC',
    concurrency,
    minimumStartPaceMs: paceMs,
    requestStartPacing: 'Serialized reservation; target minimum interval between chapter request starts. Receipt timestamps are the evidence for actual spacing.',
    stopReason,
    rerunSafety: 'All raw captures, receipts, and the inventory use exclusive-create writes. Rerun only into a fresh output directory; existing captures are never overwritten.',
    supportCaptures: supportUrls.map((url, i) => ({ url, receiptPath: path.relative(root, path.join(receiptsDir, `${safeName(i === 0 ? 'law-modifications-current' : 'general-statutes-caveats')}.json`)).replaceAll('\\', '/') })),
  },
  counts: {
    tocChapterHtmlLinks: chapterLinks.size,
    chaptersAttempted: captures.length,
    acquiredHttp200: captures.filter(x => x.httpStatus === 200 && x.rawPath).length,
    failedOrNon200: captures.filter(x => x.httpStatus !== 200 || !x.rawPath).length,
  },
  chapters: captures,
};
const inventoryPath = path.join(out, 'inventory.json');
await fs.writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ inventoryPath: path.relative(root, inventoryPath), counts: inventory.counts }, null, 2));
