// Shared primitives for the gap-fill runner: hashing, canonical JSON, atomic checkpoints,
// content-addressed raw retention, URL sanitising and the never-overwrite field policy.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha256 = x => crypto.createHash('sha256').update(x).digest('hex');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const isBlank = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/**
 * Same bytes as corpus_ingest.canonical_integer_jsonb_v1 (sorted keys by byte order, compact, unescaped Unicode).
 * Integers only: the database codec cannot round-trip floats, so a float is rejected rather than approximated.
 */
export function canonicalIntegerJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('CANONICAL_JSON_NON_INTEGER');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalIntegerJson).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter(k => value[k] !== undefined).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalIntegerJson(value[k])}`).join(',')}}`;
  }
  throw new Error('CANONICAL_JSON_UNSUPPORTED');
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}

/** Write-then-rename so an interrupted run never leaves a torn checkpoint. */
export async function atomicWriteJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

export async function appendJsonl(file, obj) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.appendFile(file, JSON.stringify(obj) + '\n');
}

/** Content-addressed raw bytes plus an append-only receipt per retrieval (same bytes may be retrieved twice). */
export async function archiveRaw(cacheDir, bytes, receipt) {
  const digest = sha256(bytes);
  const rawFile = path.join(cacheDir, 'raw', `${digest}.bin`);
  await fs.mkdir(path.dirname(rawFile), {recursive: true});
  try { await fs.writeFile(rawFile, bytes, {flag: 'wx'}); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (sha256(await fs.readFile(rawFile)) !== digest) throw new Error('RAW_ARCHIVE_READBACK_MISMATCH');
  const full = {...receipt, source_sha256: digest, bytes: bytes.length};
  await appendJsonl(path.join(cacheDir, 'observations.jsonl'), full);
  return full;
}

const SECRET_QUERY = /^(x-amz-.*|awsaccesskeyid|signature|expires|token|access[_-]?token|api[_-]?key|key|user[_-]?id)$/i;

/** Remove credential-bearing query parameters; return the clean URL and whether anything was removed. */
export function sanitizeUrl(value) {
  if (typeof value !== 'string' || !value) return {url: value ?? null, removed: false};
  let u;
  try { u = new URL(value); } catch { return {url: value, removed: false}; }
  let removed = false;
  for (const k of [...u.searchParams.keys()]) if (SECRET_QUERY.test(k)) { u.searchParams.delete(k); removed = true; }
  u.username = ''; u.password = '';
  return {url: u.toString(), removed};
}

/** Text the owner's display rule excludes: sealed, restricted, in camera, ex parte or redacted. */
export const WITHHELD_TEXT = /\b(sealed|under seal|restricted|in camera|ex parte|redact(?:ed|ion)?)\b/i;
export const isDisplayWithheld = ({restricted, text}) => restricted === true || restricted == null || WITHHELD_TEXT.test(text ?? '');

/** Higher is more authoritative. Equal rank never supersedes. */
export const SOURCE_RANK = {official_court: 4, jpml: 4, courtlistener: 3, docketbird: 3, fjc_idb: 2, derived: 1};
export const rankOf = source => SOURCE_RANK[String(source).split(':')[0]] ?? 0;

const norm = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').toLowerCase() : v);

/**
 * Decide what an incoming value may do to an existing field. Nothing here ever overwrites:
 * fill  = existing is blank, incoming may be written as a new versioned observation
 * confirm = same value, corroboration is recorded
 * conflict = values differ; both are retained, `proposed_supersede` only when incoming outranks existing
 */
export function decideField({field, existing, incoming}) {
  if (isBlank(incoming?.value)) return {field, action: 'skip', reason: 'incoming_blank'};
  if (isBlank(existing?.value)) return {field, action: 'fill', incoming};
  if (norm(existing.value) === norm(incoming.value)) return {field, action: 'confirm', existing, incoming};
  return {field, action: 'conflict', existing, incoming, proposed_supersede: rankOf(existing.source) > 0 && rankOf(incoming.source) > rankOf(existing.source), applied: false};
}

/** Provider-neutral docket key from the sw-matter-registry contract; used only to link, never to merge. */
export function docketKey(courtId, docketNumber) {
  const m = String(docketNumber ?? '').trim().match(/^(\d{1,2}):(\d{2}|\d{4})-?([a-z]{2,4})-?(\d{1,6})(?:-[A-Za-z]{2,5})*$/i);
  if (!m || !courtId) return null;
  let year = m[2];
  if (year.length === 2) year = (Number(year) < 70 ? '20' : '19') + year;
  return `${courtId}:${Number(m[1])}:${year}-${m[3].toLowerCase()}-${m[4].padStart(5, '0')}`;
}

/** DocketBird ids look like `<court>-<office>:<yyyy>-<type>-<seq>`. */
export function docketKeyFromDocketBirdId(id) {
  const m = String(id ?? '').match(/^([a-z0-9]+)-(\d{1,2}):(\d{4})-([a-z]{2,4})-0*(\d+)$/i);
  return m ? `${m[1]}:${Number(m[2])}:${m[3]}-${m[4].toLowerCase()}-${m[5].padStart(5, '0')}` : null;
}
