#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInflateRaw } from 'node:zlib';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = process.cwd();
const base = path.join(root, 'private/audit-2026-10-05/full-state-codes/florida');
const archivePath = path.join(base, 'raw/FLLawDL2026.zip');
const outputPath = path.join(base, 'archive-inventory.json');
try { await fs.access(outputPath); throw new Error('Refusing to repeat whole-ZIP hashing/CRC work because archive-inventory.json already exists.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const runReceipt = JSON.parse(await fs.readFile(path.join(base, 'receipts/FLLawDL2026-range-capture.json.verified'), 'utf8'));
const stat = await fs.stat(archivePath);
if (stat.size !== runReceipt.totalBytesAdvertised || stat.size !== runReceipt.bytesWritten) throw new Error('ZIP size differs from verified range receipt.');
const sha = crypto.createHash('sha256');
for await (const chunk of createReadStream(archivePath)) sha.update(chunk);
const archiveSha256 = sha.digest('hex');
if (archiveSha256 !== runReceipt.wholeSha256) throw new Error('ZIP whole-file SHA-256 differs from verified range receipt.');
const archiveHandle = await fs.open(archivePath, 'r');
async function readAt(offset, length) {
  if (length < 0 || length > 64 * 1024 * 1024 || offset < 0 || offset + length > stat.size) throw new Error(`Invalid/bounded archive read: ${offset}+${length}`);
  const buffer = Buffer.alloc(length);
  const result = await archiveHandle.read(buffer, 0, length, offset);
  if (result.bytesRead !== length) throw new Error('Short read inside ZIP structure.');
  return buffer;
}
const tailLength = Math.min(stat.size, 65_557);
const tailOffset = stat.size - tailLength;
const tail = await readAt(tailOffset, tailLength);
let eocdLocal = -1;
for (let index = tail.length - 22; index >= 0; index -= 1) {
  if (tail.readUInt32LE(index) === 0x06054b50) { eocdLocal = index; break; }
}
if (eocdLocal < 0) throw new Error('ZIP end-of-central-directory record not found.');
const eocd = tail.subarray(eocdLocal);
const diskNumber = eocd.readUInt16LE(4);
const centralDisk = eocd.readUInt16LE(6);
const entriesOnDisk = eocd.readUInt16LE(8);
const entryCount = eocd.readUInt16LE(10);
const centralSize = eocd.readUInt32LE(12);
const centralOffset = eocd.readUInt32LE(16);
const commentLength = eocd.readUInt16LE(20);
if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
  throw new Error('Multidisk or ZIP64 archive unsupported by this bounded inventory parser; raw ZIP and receipts retained.');
}
if (eocd.length !== 22 + commentLength || entryCount > 100_000 || centralSize > 64 * 1024 * 1024) throw new Error('Invalid or oversized ZIP directory metadata.');
const central = await readAt(centralOffset, centralSize);
const decodeName = (bytes, utf8) => utf8 ? bytes.toString('utf8') : new TextDecoder('windows-1252').decode(bytes);
const entries = [];
let cursor = 0;
let expectedUncompressedTotal = 0;
for (let index = 0; index < entryCount; index += 1) {
  if (central.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`Invalid central-directory signature at entry ${index}`);
  const flags = central.readUInt16LE(cursor + 8);
  const method = central.readUInt16LE(cursor + 10);
  const crc32Expected = central.readUInt32LE(cursor + 16);
  const compressedSize = central.readUInt32LE(cursor + 20);
  const uncompressedSize = central.readUInt32LE(cursor + 24);
  const filenameLength = central.readUInt16LE(cursor + 28);
  const extraLength = central.readUInt16LE(cursor + 30);
  const entryCommentLength = central.readUInt16LE(cursor + 32);
  const diskStart = central.readUInt16LE(cursor + 34);
  const externalAttributes = central.readUInt32LE(cursor + 38);
  const localHeaderOffset = central.readUInt32LE(cursor + 42);
  const variableEnd = cursor + 46 + filenameLength + extraLength + entryCommentLength;
  if (variableEnd > central.length) throw new Error(`Truncated central-directory entry ${index}`);
  const nameBytes = central.subarray(cursor + 46, cursor + 46 + filenameLength);
  const filename = decodeName(nameBytes, (flags & 0x0800) !== 0);
  const extra = central.subarray(cursor + 46 + filenameLength, cursor + 46 + filenameLength + extraLength);
  const zip64 = compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff || diskStart === 0xffff;
  let zip64Values = null;
  if (zip64) {
    let extraCursor = 0;
    while (extraCursor + 4 <= extra.length) {
      const id = extra.readUInt16LE(extraCursor);
      const len = extra.readUInt16LE(extraCursor + 2);
      if (extraCursor + 4 + len > extra.length) break;
      if (id === 0x0001) { zip64Values = extra.subarray(extraCursor + 4, extraCursor + 4 + len); break; }
      extraCursor += 4 + len;
    }
  }
  const entry = {
    index, filename, flags, method, crc32Expected: crc32Expected.toString(16).padStart(8, '0'),
    compressedSize, uncompressedSize, localHeaderOffset, diskStart, externalAttributes,
    encrypted: (flags & 1) !== 0, zip64, zip64ExtraPresent: Boolean(zip64Values),
    crcStatus: 'not_checked', sha256: null,
  };
  if (zip64) {
    entry.crcStatus = 'not_checked_zip64_sizes';
  } else if (!entry.encrypted && [0, 8].includes(method)) {
    const localHeader = await readAt(localHeaderOffset, 30);
    if (localHeader.readUInt32LE(0) !== 0x04034b50) throw new Error(`Bad local file header for ${filename}`);
    const localNameLength = localHeader.readUInt16LE(26);
    const localExtraLength = localHeader.readUInt16LE(28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataOffset < localHeaderOffset || dataEnd > centralOffset) throw new Error(`Entry data outside archive body: ${filename}`);
    const crcTable = makeCrcTable();
    let crc = 0xffffffff;
    let uncompressedCount = 0;
    const hash = crypto.createHash('sha256');
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        uncompressedCount += chunk.length;
        expectedUncompressedTotal += chunk.length;
        if (uncompressedCount > 2 * 1024 * 1024 * 1024 || expectedUncompressedTotal > 4 * 1024 * 1024 * 1024) {
          callback(new Error('Uncompressed archive safety limit exceeded.'));
          return;
        }
        crc = updateCrc(crc, chunk, crcTable);
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    try {
      if (compressedSize > 0) {
        const source = createReadStream(archivePath, { start: dataOffset, end: dataEnd - 1 });
        if (method === 8) await pipeline(source, createInflateRaw(), meter, sink);
        else await pipeline(source, meter, sink);
      }
      const crcActual = (crc ^ 0xffffffff) >>> 0;
      entry.crcStatus = crcActual === crc32Expected && uncompressedCount === uncompressedSize ? 'verified' : 'mismatch';
      entry.crc32Actual = crcActual.toString(16).padStart(8, '0');
      entry.uncompressedBytesActual = uncompressedCount;
      entry.sha256 = hash.digest('hex');
    } catch (error) {
      entry.crcStatus = 'verification_error';
      entry.verificationError = String(error?.message || error);
    }
  } else {
    entry.crcStatus = entry.encrypted ? 'not_checked_encrypted' : `not_checked_method_${method}`;
  }
  entries.push(entry);
  cursor = variableEnd;
}
await archiveHandle.close();
if (cursor !== central.length) throw new Error('Central directory has unparsed trailing bytes.');
const crcFailures = entries.filter(entry => entry.crcStatus === 'mismatch' || entry.crcStatus === 'verification_error');
const inventory = {
  schemaVersion: 'florida-zip-member-inventory/1', inspectedAt: new Date().toISOString(),
  archivePath: 'private/audit-2026-10-05/full-state-codes/florida/raw/FLLawDL2026.zip',
  archiveBytes: stat.size, archiveSha256, rangeReceiptPath: 'private/audit-2026-10-05/full-state-codes/florida/receipts/FLLawDL2026-range-capture.json.verified',
  zip: { diskNumber, entryCount, centralSize, centralOffset, commentLength, zip64Unsupported: false },
  verification: {
    entriesWithCRCVerified: entries.filter(entry => entry.crcStatus === 'verified').length,
    entriesNotChecked: entries.filter(entry => entry.crcStatus.startsWith('not_checked')).length,
    crcFailureCount: crcFailures.length, crcFailures,
    totalVerifiedUncompressedBytes: entries.filter(entry => entry.crcStatus === 'verified').reduce((sum, entry) => sum + entry.uncompressedBytesActual, 0),
  },
  executablePolicy: 'No member was executed or installed. Inventory and member stream integrity were inspected as data only.',
  entries,
};
await fs.writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ entryCount, verified: inventory.verification.entriesWithCRCVerified, notChecked: inventory.verification.entriesNotChecked, crcFailureCount: inventory.verification.crcFailureCount, totalVerifiedUncompressedBytes: inventory.verification.totalVerifiedUncompressedBytes, extensions: countByExtension(entries) }, null, 2));
if (crcFailures.length) throw new Error('One or more ZIP members failed integrity checks; inventory preserved.');

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
function updateCrc(crc, chunk, table) {
  let current = crc;
  for (const byte of chunk) current = table[(current ^ byte) & 0xff] ^ (current >>> 8);
  return current >>> 0;
}
function countByExtension(rows) {
  const counts = {};
  for (const row of rows) {
    const extension = path.posix.extname(row.filename).toLowerCase() || '[none]';
    counts[extension] = (counts[extension] || 0) + 1;
  }
  return counts;
}
