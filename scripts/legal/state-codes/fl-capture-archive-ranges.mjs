#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const base = path.join(root, 'private/audit-2026-10-05/full-state-codes/florida');
const discovery = JSON.parse(await fs.readFile(path.join(base, 'archive-discovery.json'), 'utf8'));
const url = discovery.linkEvidence.resolvedArchiveUrl;
const etag = discovery.headCheck.headers.etag;
const total = Number(discovery.headCheck.headers['content-length']);
const maxBytes = discovery.acquisitionLimitBytes;
if (url !== 'https://leg.state.fl.us/Statutes/FLLawDL2026.zip' || discovery.headCheck.httpStatus !== 200 || !etag || /^W\//i.test(etag) || !Number.isSafeInteger(total) || total <= 0 || total > maxBytes) {
  throw new Error('Refusing range capture without matching official-link discovery, strong ETag and bounded size.');
}
const rawDir = path.join(base, 'raw');
const chunksDir = path.join(base, 'receipts/chunks');
const receiptsDir = path.join(base, 'receipts');
await fs.mkdir(rawDir, { recursive: true });
await fs.mkdir(chunksDir, { recursive: true });
await fs.mkdir(receiptsDir, { recursive: true });
const archivePath = path.join(rawDir, 'FLLawDL2026.zip');
const partialPath = `${archivePath}.partial`;
const runReceiptPath = path.join(receiptsDir, 'FLLawDL2026-range-capture.json');
for (const file of [archivePath, runReceiptPath, `${runReceiptPath}.verified`]) {
  try { await fs.access(file); throw new Error(`Refusing overwrite: ${path.relative(root, file)}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const chunkBytes = 4 * 1024 * 1024;
const maxRequests = Math.ceil(total / chunkBytes);
const maxRequestsAllowed = 64;
if (maxRequests > maxRequestsAllowed) throw new Error(`Range count ${maxRequests} exceeds configured maximum ${maxRequestsAllowed}`);
const startedAt = new Date().toISOString();
const wholeHash = crypto.createHash('sha256');
let resumeOffset = 0;
const chunks = [];
const partialExists = await fs.stat(partialPath).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error));
const fileHandle = await fs.open(partialPath, partialExists ? 'r+' : 'wx+');
if (partialExists) {
  for (let index = 0, start = 0; start < total; index += 1, start += chunkBytes) {
    const receiptPath = path.join(chunksDir, `${String(index).padStart(3, '0')}.json`);
    const receipt = await fs.readFile(receiptPath, 'utf8').then(JSON.parse, error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!receipt) break;
    const end = Math.min(total - 1, start + chunkBytes - 1);
    const expectedChunkBytes = end - start + 1;
    if (receipt.outcome !== 'captured' || receipt.requestedUrl !== url || receipt.status !== 206 || receipt.etag !== etag || /^W\//i.test(receipt.etag)
      || receipt.requestedRange?.start !== start || receipt.requestedRange?.end !== end
      || receipt.contentRange !== `bytes ${start}-${end}/${total}` || receipt.bytes !== expectedChunkBytes) {
      throw new Error(`Existing range receipt ${index} is inconsistent; refusing resume.`);
    }
    const chunkBuffer = Buffer.alloc(expectedChunkBytes);
    const read = await fileHandle.read(chunkBuffer, 0, expectedChunkBytes, start);
    if (read.bytesRead !== expectedChunkBytes || crypto.createHash('sha256').update(chunkBuffer).digest('hex') !== receipt.sha256) {
      throw new Error(`Existing partial bytes do not match range receipt ${index}; refusing resume.`);
    }
    wholeHash.update(chunkBuffer);
    resumeOffset += expectedChunkBytes;
    chunks.push({ index, start, end, bytes: expectedChunkBytes, sha256: receipt.sha256, receiptPath: path.relative(root, receiptPath).replaceAll('\\', '/') });
  }
  const actualSize = (await fs.stat(partialPath)).size;
  if (actualSize !== resumeOffset) throw new Error(`Partial file size ${actualSize} does not equal receipt-verified contiguous range size ${resumeOffset}.`);
}
let written = resumeOffset;
let lastRequestAt = 0;
let stopped = null;
async function readChunkBounded(response, maximum) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Range response has no body.');
  const parts = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel('Exact range body exceeded advertised chunk length');
      throw new Error(`Range response body exceeded ${maximum} bytes.`);
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts, length);
}
async function cancelResponseBody(response) {
  try { await response?.body?.cancel('Range response failed identity/header validation'); } catch { /* preserve the primary validation failure */ }
}
try {
  for (let index = resumeOffset / chunkBytes, start = resumeOffset; start < total; index += 1, start += chunkBytes) {
    const end = Math.min(total - 1, start + chunkBytes - 1);
    const wait = Math.max(0, 1000 - (Date.now() - lastRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    const requestedAt = new Date().toISOString();
    lastRequestAt = Date.now();
    let response;
    let body = Buffer.alloc(0);
    let error = null;
    try {
      response = await fetch(url, {
        method: 'GET', redirect: 'follow',
        headers: {
          'user-agent': 'Legal-Source-Atlas/1.0 (public Florida statutory source capture)',
          range: `bytes=${start}-${end}`,
          'if-match': etag,
        },
        signal: AbortSignal.timeout(90000),
      });
      if (response.status !== 206) {
        await cancelResponseBody(response);
        throw new Error(`Expected HTTP 206, got ${response.status}; stopping without fallback or retry.`);
      }
      if (response.url !== url) {
        await cancelResponseBody(response);
        throw new Error(`Range response final URL differs from official linked URL: ${response.url}`);
      }
      const contentRange = response.headers.get('content-range');
      if (contentRange !== `bytes ${start}-${end}/${total}`) {
        await cancelResponseBody(response);
        throw new Error(`Content-Range mismatch: ${contentRange}`);
      }
      const responseEtag = response.headers.get('etag');
      if (responseEtag !== etag || /^W\//i.test(responseEtag || '')) {
        await cancelResponseBody(response);
        throw new Error(`ETag changed or is weak: ${responseEtag}`);
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (contentLength !== end - start + 1) {
        await cancelResponseBody(response);
        throw new Error(`Chunk length header mismatch: ${contentLength}`);
      }
      body = await readChunkBounded(response, contentLength);
      if (body.length !== contentLength) throw new Error(`Chunk body length mismatch: ${body.length}`);
    } catch (cause) {
      error = String(cause?.message || cause);
    }
    const chunkReceipt = {
      schemaVersion: 'florida-state-code-archive-range-capture/1',
      chunkIndex: index, requestedUrl: url, finalUrl: response?.url || null,
      method: 'GET', requestedRange: { start, end }, requestedAt, completedAt: new Date().toISOString(),
      status: response?.status ?? null, etag: response?.headers.get('etag') ?? null,
      contentRange: response?.headers.get('content-range') ?? null,
      contentLengthHeader: response?.headers.get('content-length') ?? null,
      bytes: body.length, sha256: body.length ? crypto.createHash('sha256').update(body).digest('hex') : null,
      outcome: error ? 'stopped' : 'captured', error,
    };
    const receiptPath = path.join(chunksDir, `${String(index).padStart(3, '0')}.json`);
    await fs.writeFile(receiptPath, `${JSON.stringify(chunkReceipt, null, 2)}\n`, { flag: 'wx' });
    if (error) { stopped = { chunkIndex: index, error, receiptPath: path.relative(root, receiptPath).replaceAll('\\', '/') }; break; }
    let offset = 0;
    while (offset < body.length) {
      const result = await fileHandle.write(body, offset, body.length - offset, start + offset);
      if (!result.bytesWritten) throw new Error(`No progress writing chunk ${index} to bounded private file.`);
      offset += result.bytesWritten;
    }
    wholeHash.update(body);
    written += body.length;
    chunks.push({ index, start, end, bytes: body.length, sha256: chunkReceipt.sha256, receiptPath: path.relative(root, receiptPath).replaceAll('\\', '/') });
    await fileHandle.sync();
    console.log(JSON.stringify({ chunk: index + 1, of: maxRequests, bytesWritten: written, totalBytes: total }));
  }
} catch (cause) {
  stopped = stopped || { error: String(cause?.message || cause) };
} finally {
  await fileHandle.close();
}
const wholeSha256 = written === total ? wholeHash.digest('hex') : null;
let zipMagic = null;
if (written >= 4) {
  const prefix = await fs.open(partialPath, 'r');
  const magic = Buffer.alloc(4);
  await prefix.read(magic, 0, 4, 0);
  await prefix.close();
  zipMagic = magic.toString('hex');
}
const runReceipt = {
  schemaVersion: 'florida-state-code-archive-range-run/1',
  discoveryPath: 'private/audit-2026-10-05/full-state-codes/florida/archive-discovery.json',
  sourcePageReceiptPath: 'private/audit-2026-10-05/full-state-codes/florida/receipts/Statutes-Download-page.json',
  requestedUrl: url, etag, totalBytesAdvertised: total, chunkBytes, maxRequestsAllowed,
  startedAt, completedAt: new Date().toISOString(), chunks,
  complete: written === total && !stopped, bytesWritten: written, wholeSha256,
  zipMagic,
  rawPath: path.relative(root, partialPath).replaceAll('\\', '/'), stopped,
};
await fs.writeFile(runReceiptPath, `${JSON.stringify(runReceipt, null, 2)}\n`, { flag: 'wx' });
if (runReceipt.complete) {
  const magic = Buffer.from(zipMagic, 'hex');
  if (!(magic[0] === 0x50 && magic[1] === 0x4b && [0x03, 0x05, 0x07].includes(magic[2]) && [0x04, 0x06, 0x08].includes(magic[3]))) {
    throw new Error('All ranges were acquired, but ZIP magic is invalid; partial and receipts preserved.');
  }
  await fs.rename(partialPath, archivePath);
  runReceipt.rawPath = path.relative(root, archivePath).replaceAll('\\', '/');
  runReceipt.outcome = 'captured';
  await fs.writeFile(`${runReceiptPath}.verified`, `${JSON.stringify(runReceipt, null, 2)}\n`, { flag: 'wx' });
}
console.log(JSON.stringify({ complete: runReceipt.complete, bytesWritten: written, total, sha256: wholeSha256, stopped }, null, 2));
if (!runReceipt.complete) throw new Error('Range capture stopped; successful chunks and partial response remain preserved.');
