/**
 * Exact TypeScript port of scripts/semantic/chunking.py (the semantic index's structural chunker). Pure functions, web APIs
 * only (TextEncoder, crypto.subtle), so the same file runs in Node (vitest, scripts) and in the Supabase edge runtime (Deno).
 *
 * Parity contract with the Python module (checked by src/lib/semantic/chunking.test.ts against the golden fixture that
 * scripts/semantic/make_chunk_fixtures.py writes with the Python chunker, and by scripts/semantic/test_chunk_parity.py):
 *   * offsets, lengths and limits count Unicode code points, as Python's str does (JavaScript strings count UTF-16 units);
 *   * "whitespace" is Python's str.isspace() / re `\s` set (it includes U+001C..U+001F and U+0085, and excludes U+FEFF);
 *   * `\d` is Python's Unicode decimal-digit set (Unicode 15.1, Python 3.13), fixed here so the JavaScript engine's own
 *     Unicode tables never change a cut;
 *   * str.strip(), str.split(), rfind, rstrip and slicing are reproduced with those rules.
 * The same input and parameters give the same passages, offsets, embed strings and hashes as the Python chunker.
 */

export const CHUNKER_VERSION = "chunk-1";
export const MAX_CHARS = 2800;
export const MAX_EMBED_CHARS = 3000;
export const SNIPPET_CHARS = 280;
export const MARK = "\x1e";

// ------------------------------------------------------------------------------------------------ Python character classes
/** Python str.isspace() (and re `\s`): exactly these 29 code points. */
const SPACE_CLASS =
  "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

export function isPySpaceCode(c: number): boolean {
  return (
    (c >= 9 && c <= 13) ||
    (c >= 0x1c && c <= 0x20) ||
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** Python 3.13 (Unicode 15.1) decimal digits below U+10000, as a regex class body. */
const BMP_DIGIT_CLASS =
  "\\u0030-\\u0039\\u0660-\\u0669\\u06f0-\\u06f9\\u07c0-\\u07c9\\u0966-\\u096f\\u09e6-\\u09ef\\u0a66-\\u0a6f" +
  "\\u0ae6-\\u0aef\\u0b66-\\u0b6f\\u0be6-\\u0bef\\u0c66-\\u0c6f\\u0ce6-\\u0cef\\u0d66-\\u0d6f\\u0de6-\\u0def" +
  "\\u0e50-\\u0e59\\u0ed0-\\u0ed9\\u0f20-\\u0f29\\u1040-\\u1049\\u1090-\\u1099\\u17e0-\\u17e9\\u1810-\\u1819" +
  "\\u1946-\\u194f\\u19d0-\\u19d9\\u1a80-\\u1a89\\u1a90-\\u1a99\\u1b50-\\u1b59\\u1bb0-\\u1bb9\\u1c40-\\u1c49" +
  "\\u1c50-\\u1c59\\ua620-\\ua629\\ua8d0-\\ua8d9\\ua900-\\ua909\\ua9d0-\\ua9d9\\ua9f0-\\ua9f9\\uaa50-\\uaa59" +
  "\\uabf0-\\uabf9\\uff10-\\uff19";

/** Python 3.13 decimal digits at or above U+10000 (inclusive ranges). */
const ASTRAL_DIGITS: readonly (readonly [number, number])[] = [
  [0x104a0, 0x104a9],
  [0x10d30, 0x10d39],
  [0x11066, 0x1106f],
  [0x110f0, 0x110f9],
  [0x11136, 0x1113f],
  [0x111d0, 0x111d9],
  [0x112f0, 0x112f9],
  [0x11450, 0x11459],
  [0x114d0, 0x114d9],
  [0x11650, 0x11659],
  [0x116c0, 0x116c9],
  [0x11730, 0x11739],
  [0x118e0, 0x118e9],
  [0x11950, 0x11959],
  [0x11c50, 0x11c59],
  [0x11d50, 0x11d59],
  [0x11da0, 0x11da9],
  [0x11f50, 0x11f59],
  [0x16a60, 0x16a69],
  [0x16ac0, 0x16ac9],
  [0x16b50, 0x16b59],
  [0x1d7ce, 0x1d7ff],
  [0x1e140, 0x1e149],
  [0x1e2f0, 0x1e2f9],
  [0x1e4f0, 0x1e4f9],
  [0x1e950, 0x1e959],
  [0x1fbf0, 0x1fbf9],
];

function isAstralDigit(cp: number): boolean {
  return ASTRAL_DIGITS.some(([a, b]) => cp >= a && cp <= b);
}

/** Every code point Python's `\d` matches, as [start, end] ranges (exported for the parity test). */
export function pyDigitRanges(): [number, number][] {
  const out: [number, number][] = [];
  for (const m of BMP_DIGIT_CLASS.matchAll(/\\u([0-9a-f]{4})-\\u([0-9a-f]{4})/g))
    out.push([parseInt(m[1]!, 16), parseInt(m[2]!, 16)]);
  for (const [a, b] of ASTRAL_DIGITS) out.push([a, b]);
  return out;
}

const SURROGATE = /[\uD800-\uDFFF]/;

/** Length in code points (Python len()). */
export function cpLen(s: string): number {
  if (!SURROGATE.test(s)) return s.length;
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** s[start:end] by code points (non-negative indices, Python clamping). */
export function cpSlice(s: string, start: number, end?: number): string {
  if (!SURROGATE.test(s)) return s.slice(start, end);
  return Array.from(s).slice(start, end).join("");
}

/**
 * A string with one UTF-16 unit per code point of `s` and the same character classes for every pattern the chunker uses:
 * astral decimal digits become "0", every other astral character a private-use letter. Offsets into it are code-point
 * offsets into `s`.
 */
function codePointProxy(s: string): string {
  if (!SURROGATE.test(s)) return s;
  let out = "";
  for (const ch of s) {
    if (ch.length === 1) out += ch;
    else out += isAstralDigit(ch.codePointAt(0)!) ? "0" : "";
  }
  return out;
}

/** Python str.strip() with no arguments. */
export function pyStrip(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && isPySpaceCode(s.charCodeAt(a))) a++;
  while (b > a && isPySpaceCode(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

/** Python str.split() with no arguments. */
export function pySplit(s: string): string[] {
  return s.split(new RegExp(`[${SPACE_CLASS}]+`)).filter((x) => x.length > 0);
}

function hasNonSpace(s: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) if (!isPySpaceCode(s.charCodeAt(i))) return true;
  return false;
}

// ------------------------------------------------------------------------------------------------------------ hashing
const encoder = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function utf8Length(value: string): number {
  return encoder.encode(value).length;
}

// ------------------------------------------------------------------------------------------------------------- spans
export type Span = { start: number; end: number };

const LOWER = new RegExp(`^\\(([a-z]{1,2})\\)(?=[${SPACE_CLASS}]|$)`);
const DIGIT = new RegExp(`^\\(([${BMP_DIGIT_CLASS}]{1,3})\\)(?=[${SPACE_CLASS}]|$)`);
const UPPER = new RegExp(`^\\(([A-Z]{1,2})\\)(?=[${SPACE_CLASS}]|$)`);
const SENTENCE = new RegExp(`(?<=[.;:?!])[${SPACE_CLASS}]+(?=[A-Z(“"0-9])`, "g");

/** Structural level of one line: 0 top-level subsection, 1 paragraph, 2 sub-paragraph, 3 any other line. */
export function lineLevel(line: string): number {
  const p = codePointProxy(line);
  let tabs = 0;
  while (tabs < p.length && p.charCodeAt(tabs) === 9) tabs++;
  const rest = p.slice(tabs);
  if (rest.startsWith(MARK)) return Math.min(tabs, 2);
  if (tabs === 0) {
    if (LOWER.test(rest)) return 0;
    if (DIGIT.test(rest)) return 1;
    if (UPPER.test(rest)) return 2;
  }
  return 3;
}

function trimSpan(text: string, start: number, end: number): Span | null {
  while (start < end && isPySpaceCode(text.charCodeAt(start))) start++;
  while (end > start && isPySpaceCode(text.charCodeAt(end - 1))) end--;
  return end > start ? { start, end } : null;
}

function linesOf(text: string, start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  let pos = start;
  while (pos < end) {
    const nl = text.indexOf("\n", pos);
    const stop = nl === -1 || nl >= end ? end : nl;
    out.push([pos, stop]);
    pos = stop + 1;
  }
  return out;
}

function cutPoints(text: string, start: number, end: number, depth: number): number[] {
  const points: number[] = [];
  for (const [s, e] of linesOf(text, start, end)) {
    if (s > start && hasNonSpace(text, s, e) && lineLevel(text.slice(s, e)) <= depth)
      points.push(s);
  }
  return points;
}

function sentenceCuts(text: string, start: number, end: number): number[] {
  const slice = text.slice(start, end);
  const out: number[] = [];
  SENTENCE.lastIndex = 0;
  for (let m = SENTENCE.exec(slice); m; m = SENTENCE.exec(slice)) {
    const at = start + m.index + m[0].length;
    if (at < end) out.push(at);
  }
  return out;
}

function wordSplit(text: string, start: number, end: number, limit: number): [number, number][] {
  const pieces: [number, number][] = [];
  let pos = start;
  while (end - pos > limit) {
    const windowEnd = pos + limit;
    let cut = -1;
    for (let i = windowEnd; i > pos; i--) {
      if (isPySpaceCode(text.charCodeAt(i - 1))) {
        cut = i;
        break;
      }
    }
    if (cut <= pos) cut = windowEnd;
    pieces.push([pos, cut]);
    pos = cut;
  }
  pieces.push([pos, end]);
  return pieces;
}

function split(
  text: string,
  start: number,
  end: number,
  depth: number,
  limit: number,
): [number, number][] {
  if (end - start <= limit) return [[start, end]];
  if (depth <= 3) {
    const points = cutPoints(text, start, end, depth);
    if (points.length) {
      const bounds = [start, ...points, end];
      const out: [number, number][] = [];
      for (let i = 0; i + 1 < bounds.length; i++)
        out.push(...split(text, bounds[i]!, bounds[i + 1]!, depth + 1, limit));
      return out;
    }
    return split(text, start, end, depth + 1, limit);
  }
  if (depth === 4) {
    const cuts = sentenceCuts(text, start, end);
    if (cuts.length) {
      const bounds = [start, ...cuts, end];
      const out: [number, number][] = [];
      for (let i = 0; i + 1 < bounds.length; i++)
        out.push(...split(text, bounds[i]!, bounds[i + 1]!, 5, limit));
      return out;
    }
    return split(text, start, end, 5, limit);
  }
  return wordSplit(text, start, end, limit);
}

/** Passages of `text` as trimmed, ordered, non-overlapping code-point spans (chunking.py split_spans). */
export function splitSpans(text: string, maxChars: number = MAX_CHARS): Span[] {
  const p = codePointProxy(text);
  if (!p || !hasNonSpace(p, 0, p.length)) return [];
  const pieces: Span[] = [];
  for (const [a, b] of split(p, 0, p.length, 0, maxChars)) {
    const s = trimSpan(p, a, b);
    if (s) pieces.push(s);
  }
  const merged: Span[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last && piece.end - last.start <= maxChars)
      merged[merged.length - 1] = { start: last.start, end: piece.end };
    else merged.push(piece);
  }
  return merged;
}

// ------------------------------------------------------------------------------------------------- embed strings, snippets
// eslint-disable-next-line no-control-regex -- the corpus keeps U+001E/U+001F marks before heading lines
const STRIP_MARKS = /[\x1e\x1f]/g;
const INDENT = /\n[\t ]+/g;
const RUNS = /[\t ]{2,}/g;
const BLANKS = /\n{3,}/g;

/** Remove the corpus's heading marks and indentation noise; wording and line breaks are kept. */
export function cleanForEmbedding(body: string): string {
  let s = body.replace(STRIP_MARKS, "");
  s = s.replace(INDENT, "\n");
  s = s.replaceAll("\t", " ");
  s = s.replace(RUNS, " ");
  return pyStrip(s.replace(BLANKS, "\n\n"));
}

const SNIPPET_TAIL = new Set([" ", ",", ";", ":", ".", "-"]);

/** The first words of a passage on one line, cut at a word boundary. */
export function snippetOf(body: string, limit: number = SNIPPET_CHARS): string {
  const flat = pySplit(cleanForEmbedding(body)).join(" ");
  if (cpLen(flat) <= limit) return flat;
  const cps = Array.from(flat);
  let cut = -1;
  for (let i = Math.min(limit, cps.length) - 1; i >= 0; i--) {
    if (cps[i] === " ") {
      cut = i;
      break;
    }
  }
  let n = cut > Math.floor(limit / 2) ? cut : limit;
  while (n > 0 && SNIPPET_TAIL.has(cps[n - 1]!)) n--;
  return cps.slice(0, n).join("") + "…";
}

/** The exact string that is embedded: the heading path, a blank line, then the passage. */
export function embeddingText(heading: string, body: string): string {
  const cleaned = cleanForEmbedding(body);
  return heading ? `${heading}\n\n${cleaned}` : cleaned;
}

// -------------------------------------------------------------------------------------------------------- documents
export type Doc = {
  dataset: string;
  record_id: string;
  title: string;
  heading: string;
  text: string;
  href: string;
  source_url: string | null;
  max_chunks: number;
};

export type Chunk = {
  dataset: string;
  record_id: string;
  chunk_no: number;
  /** Passages the record has in all (more than were kept when the record is capped). */
  chunk_total: number;
  start: number;
  end: number;
  body: string;
  heading: string;
  title: string;
  href: string;
  source_url: string | null;
};

/** Characters a passage may have so that heading plus passage stay within maxEmbedChars (never below 1,200). */
export function bodyLimit(
  heading: string,
  maxChars: number = MAX_CHARS,
  maxEmbedChars: number = MAX_EMBED_CHARS,
): number {
  return Math.max(1200, Math.min(maxChars, maxEmbedChars - cpLen(heading) - 2));
}

/** Passages of one document; a record with more than doc.max_chunks passages keeps the first max_chunks. */
export function chunkDoc(doc: Doc, maxChars: number = MAX_CHARS): Chunk[] {
  const spans = splitSpans(doc.text, bodyLimit(doc.heading, maxChars));
  const total = spans.length;
  const astral = SURROGATE.test(doc.text);
  const cps = astral ? Array.from(doc.text) : null;
  return spans.slice(0, Math.max(0, doc.max_chunks)).map((s, i) => ({
    dataset: doc.dataset,
    record_id: doc.record_id,
    chunk_no: i,
    chunk_total: total,
    start: s.start,
    end: s.end,
    body: cps ? cps.slice(s.start, s.end).join("") : doc.text.slice(s.start, s.end),
    heading: doc.heading,
    title: doc.title,
    href: doc.href,
    source_url: doc.source_url,
  }));
}

export function chunkEmbedText(c: Pick<Chunk, "heading" | "body">): string {
  return embeddingText(c.heading, c.body);
}

/** Budgeting estimate only (about 3.4 characters per token); never used as a spending bound. */
export function estimateTokens(text: string): number {
  return Math.floor((cpLen(text) * 10 + 33) / 34);
}

/** embed.py embed_key: identity of one embedding input (model, input type and the exact string). */
export function embedKey(
  text: string,
  model: string,
  inputType: string = "document",
): Promise<string> {
  return sha256Hex(`${model}\x00${inputType}\x00${text}`);
}
