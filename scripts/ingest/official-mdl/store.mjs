// Private run directory helpers for the official-court MDL pipeline (never inside git).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const DEFAULT_RUN_DIR = process.env.CORPUS_PRIVATE_CACHE_DEFAULT_RUN
  ?? 'C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-03/official-mdl';
export const PRIVATE_CACHE_PREFIX = (process.env.CORPUS_PRIVATE_CACHE_PREFIX ?? 'c:/users/firas/.codex/corpus-cache/').replaceAll('\\', '/').toLowerCase();

export function resolveRunDir(value) {
  const dir = path.resolve(String(value ?? DEFAULT_RUN_DIR));
  // Captured originals and receipts only ever go to the private cache, never into a repository checkout.
  if (!dir.replaceAll('\\', '/').toLowerCase().startsWith(PRIVATE_CACHE_PREFIX)) throw Error('RUN_DIR_MUST_BE_IN_PRIVATE_CACHE');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
export function parseArgs(argv) {
  return Object.fromEntries(argv.map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), true] : [x.slice(2, i), x.slice(i + 1)]; }));
}
export function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a');
  try { fs.writeSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}
export function writeFileOnce(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, bytes, { flag: 'wx' }); return true; } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
}
export const hostDir = (runDir, host) => path.join(runDir, 'captures', host);
export function extFor(contentType, url) {
  if (/html|xml/i.test(contentType ?? '')) return 'html';
  if (/pdf/i.test(contentType ?? '')) return 'pdf';
  if (/text\/plain/i.test(contentType ?? '')) return 'txt';
  return /\.pdf($|\?)/i.test(url) ? 'pdf' : 'bin';
}
// The latest successful (HTTP 200) capture per requested URL, from the append-only index.
export function latestCaptures(runDir) {
  const latest = new Map();
  for (const entry of readJsonl(path.join(runDir, 'capture-index.jsonl'))) {
    if (entry.outcome !== 'captured' || entry.role === 'robots') continue;
    const prior = latest.get(entry.url);
    if (!prior || entry.retrieved_at > prior.retrieved_at) latest.set(entry.url, entry);
  }
  return latest;
}
// Bodies stored gzip-compressed (entry.stored_encoding === 'gzip', e.g. the 25 MB GovInfo package MODS) are returned decompressed; entry.sha256 is always the hash of the UNCOMPRESSED bytes.
export const readBody = (runDir, entry) => {
  const bytes = fs.readFileSync(path.join(runDir, entry.body_file));
  return entry.stored_encoding === 'gzip' ? zlib.gunzipSync(bytes) : bytes;
};
export const gzipBytes = bytes => zlib.gzipSync(bytes, { level: 9 });
