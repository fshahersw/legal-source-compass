// Pure helpers for the quarterly CourtListener dockets bulk re-match (see .github/workflows/courtlistener-bulk-rematch.yml).
import crypto from 'node:crypto';
import fs from 'node:fs';

export const BUCKET_URL = 'https://com-courtlistener-storage.s3-us-west-2.amazonaws.com';
export const ARCHIVE_KEY = /^bulk-data\/dockets-(\d{4})-(\d{2})-(\d{2})\.csv\.bz2$/;

/** CourtListener regenerates bulk files on the last day of March, June, September and December. */
export function isQuarterEnd(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate); if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return [3, 6, 9, 12].includes(mo) && d === new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Newest quarterly dockets archive in an S3 ListObjectsV2/V1 XML page: {key, date, size, etag}. Non-quarter-end dates are ignored. */
export function newestQuarterlyArchive(xml, {date = null} = {}) {
  const items = [...xml.matchAll(/<Contents>.*?<Key>([^<]+)<\/Key>.*?<ETag>&quot;([^&<]+)&quot;<\/ETag>.*?<Size>(\d+)<\/Size>.*?<\/Contents>/gs)]
    .map(m => ({key: m[1], etag: m[2], size: Number(m[3]), match: ARCHIVE_KEY.exec(m[1])})).filter(x => x.match)
    .map(x => ({key: x.key, etag: x.etag, size: x.size, date: `${x.match[1]}-${x.match[2]}-${x.match[3]}`})).filter(x => isQuarterEnd(x.date) && (!date || x.date === date));
  return items.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

/** S3 multipart ETag: md5 of the concatenated per-part md5 digests, plus "-<parts>". Part size is derived from the part count. */
export async function multipartEtag(file, parts, partSizeCandidates = [8 * 1024 ** 2, 16 * 1024 ** 2, 5 * 1024 ** 2, 64 * 1024 ** 2, 100 * 1024 ** 2]) {
  const size = (await fs.promises.stat(file)).size;
  const partSize = partSizeCandidates.find(p => Math.ceil(size / p) === parts);
  if (!partSize) throw new Error(`ETAG_PART_SIZE_UNKNOWN size=${size} parts=${parts}`);
  const digests = []; const fd = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(partSize);
    for (let pos = 0; pos < size; pos += partSize) {
      const {bytesRead} = await fd.read(buf, 0, Math.min(partSize, size - pos), pos);
      digests.push(crypto.createHash('md5').update(buf.subarray(0, bytesRead)).digest());
    }
  } finally { await fd.close(); }
  return `${crypto.createHash('md5').update(Buffer.concat(digests)).digest('hex')}-${digests.length}`;
}

/** Fail loudly unless size and (multipart or single-part) ETag both match what S3 reports for the object. */
export async function verifyDownload(file, {size, etag}) {
  const actual = (await fs.promises.stat(file)).size;
  if (actual !== size) throw new Error(`HASH_MISMATCH size ${actual} != ${size}`);
  const m = /^[0-9a-f]{32}-(\d+)$/.exec(etag);
  const got = m ? await multipartEtag(file, Number(m[1])) : crypto.createHash('md5').update(await fs.promises.readFile(file)).digest('hex');
  if (got !== etag) throw new Error(`HASH_MISMATCH etag ${got} != ${etag}`);
  return {size: actual, etag: got};
}

export async function sha256File(file) {
  const h = crypto.createHash('sha256');
  for await (const c of fs.createReadStream(file)) h.update(c);
  return h.digest('hex');
}

/** Deterministic run id for an archive so a re-run opens the same run (a different sha256 for the same date is rejected by the database). */
export function runIdFor(snapshotDate) {
  const h = crypto.createHash('sha256').update(`courtlistener-bulk-match/2|dockets|${snapshotDate}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
