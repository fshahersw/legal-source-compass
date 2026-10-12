#!/usr/bin/env node
/** Exact, resumable publisher captures. No database writes or publication flags. */
import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { parseCaptureArgs, createRequestGate, fetchWithRetries } from './capture_transport.mjs';

const root = 'https://data.capitol.hawaii.gov/hrscurrent/';
const options = parseCaptureArgs(process.argv.slice(2));
const output = resolve(options.output);
const withSections = options.sections;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(join(output, 'raw'), { recursive: true });
await mkdir(join(output, 'receipts'), { recursive: true });
const gate = createRequestGate({ rateMs: options.rateMs });
let completed = 0;
let stopped = false;
const errors = [];
async function capture(url) {
  if (!url.startsWith(root) || new URL(url).origin !== new URL(root).origin) throw Error('Out-of-scope source');
  const receiptPath = join(output, 'receipts', digest(url) + '.json');
  try {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(receipt.sha256) || receipt.raw_file !== 'raw/' + receipt.sha256) throw Error('Invalid retained source path');
    const bytes = await readFile(join(output, 'raw', receipt.sha256));
    if (!/^[a-f0-9]{64}$/.test(receipt.sha256) || receipt.raw_file !== 'raw/' + receipt.sha256 || receipt.source_url !== url || receipt.final_url !== url || receipt.http_status !== 200 || bytes.length !== receipt.bytes || digest(bytes) !== receipt.sha256) throw Error('Retained capture mismatch');
    return { receipt, bytes };
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const started = new Date().toISOString();
    const { response, value: bytes, attempts } = await fetchWithRetries(url, { gate, consume: async response => {
      if (response.url !== url || !/text\/html/i.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel(); throw Error('Invalid source response identity/media type: ' + url);
      }
      const chunks = []; let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 10_000_000) throw Error('Source exceeds 10 MB capture bound: ' + url);
        chunks.push(chunk);
      }
      if (!length) throw Error('Empty source response: ' + url);
      return Buffer.concat(chunks, length);
    } });
    const sha256 = digest(bytes);
    const receipt = { schema_version: 'publisher-http-capture/1', source_url: url, final_url: response.url, started_at: started, retrieved_at: new Date().toISOString(), http_status: 200, bytes: bytes.length, sha256, content_type: response.headers.get('content-type'), last_modified: response.headers.get('last-modified'), etag: response.headers.get('etag'), retrieval_method: 'publisher_page', proxy: null, raw_file: 'raw/' + sha256, rate_limit_ms: options.rateMs, attempts };
    await writeFile(join(output, 'raw', sha256), bytes);
    await writeFile(receiptPath + '.tmp', JSON.stringify(receipt, null, 2) + '\n');
    await rename(receiptPath + '.tmp', receiptPath);
    completed++;
    if (completed % 100 === 0) console.log(JSON.stringify({ captured: completed, at: receipt.retrieved_at }));
    return { receipt, bytes };
}
function links(bytes, base) {
  return [...new Set([...bytes.toString('utf8').matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m => new URL(m[1].replaceAll('&amp;', '&'), base).href).filter(u => u.startsWith(root)))];
}
async function pool(items, callback) {
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (!stopped && cursor < items.length) {
      const item = items[cursor++];
      try { await callback(item); } catch (e) {
        const error = { source_url: item, error: e.message, at: new Date().toISOString() };
        errors.push(error); await appendFile(join(output, 'capture-errors.jsonl'), JSON.stringify(error) + '\n');
        if (e.stopAcquisition) { stopped = true; gate.stop(); }
      }
    }
  }));
}
const index = await capture(root);
const volumes = links(index.bytes, root).filter(u => /^Vol\d+_[^/]+\/$/.test(u.slice(root.length)));
if (volumes.length !== 14) throw Error('Expected publisher 14-volume listing');
const chapters = [];
await pool(volumes, async url => { const page = await capture(url); chapters.push(...links(page.bytes, url).filter(u => u.startsWith(url) && /\/HRS\d+[A-Z]*\/$/.test(u))); });
const pages = [];
const toc = [];
await pool([...new Set(chapters)].sort(), async url => {
  const page = await capture(url);
  const children = links(page.bytes, url).filter(u => u.startsWith(url) && /\/HRS_[^/]+\.htm$/i.test(u));
  if (!children.length) throw Error('Chapter without HRS pages');
  pages.push(...children);
  toc.push({ source_url: url, sha256: page.receipt.sha256, pages: children });
});
const uniquePages = [...new Set(pages)].sort();
const inventory = { schema_version: 'hi-publisher-directory/1', retrieved_at: new Date().toISOString(), root, volumes, chapters: toc.sort((a,b)=>a.source_url.localeCompare(b.source_url)), pages: uniquePages, errors, publication_allowed: false };
const inventoryPath = join(output, 'directory-inventory.json');
try {
  const prior = JSON.parse(await readFile(inventoryPath, 'utf8'));
  for (const key of ['schema_version', 'root', 'volumes', 'chapters', 'pages', 'errors', 'publication_allowed']) {
    if (JSON.stringify(prior[key]) !== JSON.stringify(inventory[key])) throw Error('Retained directory discovery differs; preserve this output and review before a new capture');
  }
  // Keep the original capture timestamp and byte hash on an exact resume.
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  await writeFile(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
}
if (withSections && !errors.length) await pool(uniquePages, capture);
await writeFile(join(output, 'capture-summary.json'), JSON.stringify({ captured_this_run: completed, volumes: volumes.length, chapters: toc.length, pages: uniquePages.length, sections_requested: withSections, rate_limit_ms: options.rateMs, concurrency: 4, errors, publication_allowed: false }, null, 2) + '\n');
console.log(JSON.stringify({ complete: errors.length === 0, captured: completed, chapters: toc.length, pages: uniquePages.length, errors: errors.length }));
if (errors.length) process.exitCode = 1;
