#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const base = path.join(root, 'private/audit-2026-10-05/full-state-codes/florida');
const rawDir = path.join(base, 'raw');
const receiptDir = path.join(base, 'receipts');
const pageUrl = 'https://leg.state.fl.us/Statutes/index.cfm?Mode=Statutes+Download&Submenu=7';
const pageRawPath = 'raw/Statutes-Download-page.html';
const pageReceiptPath = 'receipts/Statutes-Download-page.json';
const headReceiptPath = 'receipts/FLLawDL2026-head.json';
const discoveryPath = 'archive-discovery.json';
await fs.mkdir(rawDir, { recursive: true });
await fs.mkdir(receiptDir, { recursive: true });
for (const relativePath of [pageRawPath, pageReceiptPath, headReceiptPath, discoveryPath]) {
  const outputPath = path.join(base, relativePath);
  try { await fs.access(outputPath); throw new Error(`Refusing to make a source request because capture output already exists: ${relativePath}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function readBounded(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel('Configured capture limit reached');
        const error = new Error(`Response exceeded capture limit ${limit}`);
        error.capturedBytes = Buffer.concat(chunks);
        error.bytesSeen = length;
        throw error;
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (!error.capturedBytes) error.capturedBytes = Buffer.concat(chunks);
    error.bytesSeen ??= length;
    throw error;
  }
  return Buffer.concat(chunks, length);
}
async function waitForRequestStart() {
  const now = Date.now();
  if (lastRequestStart !== null) {
    const waitMs = Math.max(0, 1000 - (now - lastRequestStart));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  lastRequestStart = Date.now();
  return new Date(lastRequestStart).toISOString();
}
let lastRequestStart = null;
async function writePageCapture(response, bytes, startedAt, error) {
  const pageReceipt = {
    schemaVersion: 'florida-download-source-page-capture/2', requestedUrl: pageUrl,
    finalUrl: response?.url || null, requestMethod: 'GET', retrievedAt: startedAt,
    completedAt: new Date().toISOString(), httpStatus: response?.status ?? null,
    contentType: response?.headers.get('content-type') ?? null,
    contentLengthHeader: response?.headers.get('content-length') ?? null,
    bytes: bytes.length, sha256: bytes.length ? crypto.createHash('sha256').update(bytes).digest('hex') : null,
    outcome: error ? 'transport_or_size_failure' : response.ok ? 'captured' : 'http_error_body_preserved',
    rawPath: bytes.length || response ? pageRawPath : null, error,
  };
  if (bytes.length || response) await fs.writeFile(path.join(base, pageRawPath), bytes, { flag: 'wx' });
  await fs.writeFile(path.join(base, pageReceiptPath), `${JSON.stringify(pageReceipt, null, 2)}\n`, { flag: 'wx' });
  return pageReceipt;
}

const pageStart = await waitForRequestStart();
let pageResponse = null;
let pageBytes = Buffer.alloc(0);
let pageError = null;
try {
  pageResponse = await fetch(pageUrl, { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'Legal-Source-Atlas/1.0 (public Florida statutory source discovery)' }, signal: AbortSignal.timeout(30000) });
  pageBytes = await readBounded(pageResponse, 2 * 1024 * 1024);
} catch (error) {
  pageError = String(error?.message || error);
  pageBytes = error?.capturedBytes || Buffer.alloc(0);
}
const pageReceipt = await writePageCapture(pageResponse, pageBytes, pageStart, pageError);
if (pageError || !pageResponse?.ok) throw new Error(`Official download page request failed; observation and any received body were preserved: ${pageError || `HTTP ${pageResponse?.status}`}`);

const pageHtml = pageBytes.toString('utf8');
const links = [...pageHtml.matchAll(/href\s*=\s*['"]([^'"]+\.zip(?:\?[^'"]*)?)['"]/gi)].map(match => match[1]);
const archiveLink = links.find(link => /FLLawDL2026\.zip(?:$|\?)/i.test(link)) || null;
const archiveUrl = archiveLink ? new URL(archiveLink, pageResponse.url).href : null;
const pageText = pageHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
const pageStatements = pageText.match(/.{0,120}(?:current year Florida Statutes|current year Florida Laws|ZIP file|Statutes Download).{0,180}/gi) || [];
let headResponse = null;
let headStartedAt = null;
let headError = null;
let archiveHeaders = {};
if (archiveUrl) {
  headStartedAt = await waitForRequestStart();
  try {
    headResponse = await fetch(archiveUrl, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': 'Legal-Source-Atlas/1.0 (public Florida statutory source discovery)' }, signal: AbortSignal.timeout(20000) });
    archiveHeaders = Object.fromEntries(['content-type', 'content-length', 'last-modified', 'etag', 'accept-ranges', 'location'].map(name => [name, headResponse.headers.get(name)]));
  } catch (error) {
    headError = String(error?.message || error);
  }
}
const headReceipt = {
  schemaVersion: 'florida-archive-head-observation/1', requestMethod: archiveUrl ? 'HEAD' : null,
  requestedUrl: archiveUrl, finalUrl: headResponse?.url || null, startedAt: headStartedAt,
  completedAt: new Date().toISOString(), httpStatus: headResponse?.status ?? null,
  headers: archiveHeaders, error: headError,
  outcome: !archiveUrl ? 'skipped_no_verified_archive_link' : headError ? 'transport_failure' : headResponse?.ok ? 'captured' : 'http_error',
};
await fs.writeFile(path.join(base, headReceiptPath), `${JSON.stringify(headReceipt, null, 2)}\n`, { flag: 'wx' });
const discovery = {
  schemaVersion: 'florida-official-archive-discovery/2', discoveredAt: new Date().toISOString(),
  pageCapture: { receiptPath: `private/audit-2026-10-05/full-state-codes/florida/${pageReceiptPath}`, ...pageReceipt },
  linkEvidence: { linkedArchiveHref: archiveLink, resolvedArchiveUrl: archiveUrl, officialPageStatements: pageStatements },
  headCheck: archiveUrl ? {
    requestMethod: 'HEAD', requestedUrl: archiveUrl, finalUrl: headResponse?.url || null,
    startedAt: headStartedAt, completedAt: new Date().toISOString(), httpStatus: headResponse?.status ?? null,
    headers: archiveHeaders, error: headError,
    receiptPath: `private/audit-2026-10-05/full-state-codes/florida/${headReceiptPath}`,
    outcome: headError ? 'transport_failure' : headResponse?.ok ? 'captured' : 'http_error',
  } : { requestMethod: null, outcome: 'skipped_no_verified_archive_link', error: 'Expected named archive link was absent.' },
  acquisitionLimitBytes: 250 * 1024 * 1024,
  executablePolicy: 'No archive member will be executed. ZIP structure and member CRCs are inspected as data only.',
};
await fs.writeFile(path.join(base, discoveryPath), `${JSON.stringify(discovery, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ pageStatus: pageReceipt.httpStatus, pageBytes: pageReceipt.bytes, pageSha256: pageReceipt.sha256, archiveUrl, headStatus: headResponse?.status ?? null, headError, headers: archiveHeaders, pageStatements }, null, 2));
if (!archiveUrl || headError || !headResponse?.ok) throw new Error('Official archive discovery is incomplete; page, HEAD failure observation, and discovery record were preserved.');
