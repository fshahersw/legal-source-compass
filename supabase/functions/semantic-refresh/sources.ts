/**
 * Port of scripts/semantic/sources.py: one builder per corpus that turns a corpus_records row into the Doc the semantic
 * index chunks (src/lib/semantic/chunking.ts). The builders read only the fields sources.py reads; the database hands them
 * a pruned row with exactly those fields (semantic.source_input in database/contracts/semantic-refresh-v1.sql), and the
 * Python side checks that building from the pruned row equals building from the full row (scripts/semantic/refresh_rows.py).
 *
 * Python semantics are reproduced where they decide an output: truthiness (`x or y`), str() of JSON values in f-strings
 * (None -> "None", True -> "True"), `_one_line` (Python whitespace), urllib quote/unquote for in-app links. A row that
 * would make the Python builder raise (a non-object where an object is read) is built as if the field were absent; such
 * rows never reached the index, so this only matters for rows the batch build could not have embedded either.
 */
import { MARK, type Doc, isPySpaceCode, pyStrip } from "../../../src/lib/semantic/chunking.ts";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
/** The pruned corpus row (plus `_title_names` for U.S. Code sections) as semantic.source_input returns it. */
export type SourceRow = JsonObject;

/** Semantic dataset ids the refresh rebuilds from corpus_records (caselaw_scotus is handled separately). */
export const SOURCE_DATASETS = [
  "us_code_sections",
  "ecfr_sections_full",
  "crs_reports",
  "congress_bills",
  "oversight_reports",
  "doj_oig_reports",
  "ftc_publications_index",
] as const;
export type SourceDataset = (typeof SOURCE_DATASETS)[number];
export const ALL_DATASETS = [...SOURCE_DATASETS, "caselaw_scotus"] as const;

export function isSourceDataset(d: string): d is SourceDataset {
  return (SOURCE_DATASETS as readonly string[]).includes(d);
}

// ------------------------------------------------------------------------------------------------------ Python helpers
export function pyTruthy(v: Json | undefined): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function pyOr<T extends Json | undefined>(a: Json | undefined, b: T): Json | T {
  return pyTruthy(a) ? (a as Json) : b;
}

function obj(v: Json | undefined): JsonObject {
  return v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function get(o: JsonObject, key: string): Json | undefined {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

/** Python iteration of a JSON value used as `for x in value` (lists; a string iterates its characters). */
function pyIter(v: Json | undefined): Json[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return Array.from(v);
  if (v !== null && v !== undefined && typeof v === "object") return Object.keys(v);
  return [];
}

/** Python repr() of a float as `str()` prints it (shortest round-trip digits; scientific below 1e-4 and from 1e16). */
function pyFloatStr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return String(x); // JSON integers (Python int)
  const [mant, expText] = x.toExponential().split("e") as [string, string];
  const exp = Number(expText);
  const neg = mant.startsWith("-");
  const digits = mant.replace("-", "").replace(".", "");
  let body: string;
  if (exp >= -5 + 1 && exp < 16) {
    // -4 <= exp < 16: positional notation
    if (exp >= 0) {
      const intPart = digits.slice(0, exp + 1).padEnd(exp + 1, "0");
      const frac = digits.slice(exp + 1);
      body = `${intPart}.${frac || "0"}`;
    } else {
      body = `0.${"0".repeat(-exp - 1)}${digits}`;
    }
  } else {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    body = `${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  return (neg ? "-" : "") + body;
}

function pyReprString(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp < 0xa0)) out += `\\x${cp.toString(16).padStart(2, "0")}`;
    else if (/[\p{C}\p{Z}]/u.test(ch) && ch !== " ")
      out += cp > 0xffff ? `\\U${cp.toString(16).padStart(8, "0")}` : `\\u${cp.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return quote + out + quote;
}

function pyRepr(v: Json | undefined): string {
  if (typeof v === "string") return pyReprString(v);
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (v !== null && v !== undefined && typeof v === "object")
    return `{${Object.entries(v)
      .map(([k, x]) => `${pyReprString(k)}: ${pyRepr(x)}`)
      .join(", ")}}`;
  return pyStr(v);
}

/** Python str() of a JSON-decoded value, as an f-string prints it. */
export function pyStr(v: Json | undefined): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return pyFloatStr(v);
  return pyRepr(v);
}

/** sources.py _one_line: whitespace runs to one space, stripped; "" for anything that is not a string. */
export function oneLine(v: Json | undefined): string {
  if (typeof v !== "string") return "";
  let out = "";
  let inSpace = false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (isPySpaceCode(c)) {
      if (!inSpace) out += " ";
      inSpace = true;
    } else {
      out += v[i];
      inSpace = false;
    }
  }
  return pyStrip(out);
}

const utf8 = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
const HEX2 = /^[0-9A-Fa-f]{2}/;

/** urllib.parse.unquote (UTF-8, errors="replace"): %XX runs inside ASCII stretches are decoded; others stay. */
export function pyUnquote(s: string): string {
  if (!s.includes("%")) return s;
  let out = "";
  const re = /[\x00-\x7f]+/g;
  let prev = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    out += s.slice(prev, m.index);
    const bits = m[0].split("%");
    const bytes: number[] = [];
    const push = (t: string) => {
      for (let i = 0; i < t.length; i++) bytes.push(t.charCodeAt(i));
    };
    push(bits[0]!);
    for (const item of bits.slice(1)) {
      if (HEX2.test(item)) {
        bytes.push(parseInt(item.slice(0, 2), 16));
        push(item.slice(2));
      } else {
        bytes.push(0x25);
        push(item);
      }
    }
    out += utf8.decode(new Uint8Array(bytes));
    prev = m.index + m[0].length;
  }
  return out + s.slice(prev);
}

/** sources.py encode_href: in-app path with every segment percent-encoded like encodeURIComponent; idempotent. */
export function encodeHref(path: string): string {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#"))
    throw new Error("not an in-app path");
  return (
    "/" +
    path
      .slice(1)
      .split("/")
      .map((seg) => encodeURIComponent(pyUnquote(seg)))
      .join("/")
  );
}

function joinLines(lines: string[]): string {
  return lines.filter((x) => x).join("\n");
}

function sourceUrlOf(v: Json | undefined): string | null {
  return pyTruthy(v) ? pyStr(v) : null;
}

// ------------------------------------------------------------------------------------------------------------ U.S. Code
/** sources.py _usc_title_names over the title rows the database matched to this section's title number. */
export function uscTitleNames(pairs: Json | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const [number, name] = p as [Json, Json];
    if (number !== null && pyTruthy(name)) out.set(pyStr(number), oneLine(name));
  }
  return out;
}

export function uscDoc(row: SourceRow, titles: Map<string, string>): Doc | null {
  const text = pyOr(get(row, "text"), "");
  if (typeof text !== "string" || !pyStrip(text)) return null;
  const u = obj(pyOr(get(obj(pyOr(get(row, "detail"), {})), "usc"), {}));
  const title = pyStr(pyOr(get(u, "title"), ""));
  const key = pyStr(pyOr(get(u, "key"), ""));
  if (!title || !key) return null;
  const citation = oneLine(get(u, "citation")) || oneLine(get(row, "title"));
  const headingText = oneLine(get(u, "heading"));
  const trail = [titles.has(title) ? `Title ${title} ${titles.get(title)}` : `Title ${title}`];
  for (const entry of pyIter(pyOr(get(u, "path"), []))) {
    if (Array.isArray(entry) && entry.length >= 4) {
      const label = oneLine(`${pyStr(entry[2])} ${pyStr(entry[3])}`);
      if (label) trail.push(label);
    }
  }
  trail.push(pyStrip(`${citation} ${headingText}`));
  return {
    dataset: "us_code_sections",
    record_id: pyStr(get(row, "id")),
    title: oneLine(get(row, "title")) || citation,
    heading: trail.join(" > "),
    text,
    href: encodeHref(`/law/uscode/${title}/${key}`),
    source_url: sourceUrlOf(get(row, "source_url")),
    max_chunks: 60,
  };
}

// ---------------------------------------------------------------------------------------------------------------- CFR
export function cfrDoc(row: SourceRow): Doc | null {
  const text = pyOr(get(row, "text"), "");
  const d = obj(pyOr(get(row, "detail"), {}));
  if (typeof text !== "string" || !pyStrip(text) || get(d, "reserved") === true) return null;
  const titleNo = pyStr(pyOr(get(d, "title_number"), ""));
  const ident = pyStr(pyOr(get(d, "identifier"), ""));
  if (!titleNo || !ident) return null;
  const where = oneLine(pyOr(get(obj(pyOr(get(row, "item"), {})), "subtitle"), get(d, "subtitle") ?? null));
  const title = oneLine(get(row, "title"));
  return {
    dataset: "ecfr_sections_full",
    record_id: pyStr(get(row, "id")),
    title,
    heading: where
      ? `Code of Federal Regulations > ${where} > ${title}`
      : `Code of Federal Regulations > ${title}`,
    text,
    href: encodeHref(`/law/cfr/${titleNo}/${ident}`),
    source_url: sourceUrlOf(pyOr(get(d, "ecfr_url"), pyOr(get(row, "source_url"), null))),
    max_chunks: 60,
  };
}

// ---------------------------------------------------------------------------------------------------- composed corpora
export function crsDoc(row: SourceRow): Doc | null {
  const crs = obj(pyOr(get(obj(pyOr(get(row, "detail"), {})), "crs"), {}));
  const title = oneLine(
    pyOr(get(crs, "title"), get(obj(get(obj(pyOr(get(row, "item"), {})), "cells")), "title") ?? null),
  );
  if (!title) return null;
  const topics = pyIter(pyOr(get(crs, "topics"), []))
    .filter((t): t is string => typeof t === "string" && pyStrip(t) !== "")
    .map(oneLine);
  const kind = oneLine(get(crs, "contentType"));
  const body = joinLines([topics.length ? `Topics: ${topics.join("; ")}` : "", kind ? `Type: ${kind}` : ""]);
  const rid = pyStr(get(row, "id"));
  return {
    dataset: "crs_reports",
    record_id: rid,
    title: oneLine(get(row, "title")) || title,
    heading: `Congressional Research Service > ${title}`,
    text: body || title,
    href: encodeHref(`/records/crs_reports/${rid}`),
    source_url: sourceUrlOf(get(row, "source_url")),
    max_chunks: 2,
  };
}

function summaryLines(summary: Json | undefined): string[] {
  const out: string[] = [];
  if (summary === null || summary === undefined || typeof summary !== "object" || Array.isArray(summary))
    return out;
  for (const block of pyIter(get(obj(pyOr(summary, {})), "blocks") ?? [])) {
    const b = obj(block);
    const x = oneLine(get(b, "x"));
    if (!x) continue;
    out.push(get(b, "k") === "li" ? `- ${x}` : x);
  }
  return out;
}

function pySlice14(v: Json | undefined): Json[] {
  if (typeof v === "string") return Array.from(v).slice(0, 14);
  return pyIter(v).slice(0, 14);
}

export function billDoc(row: SourceRow): Doc | null {
  const b = obj(pyOr(get(obj(pyOr(get(row, "detail"), {})), "bill"), {}));
  const titles = obj(pyOr(get(b, "titles"), {}));
  const display = oneLine(get(titles, "display"));
  const citation =
    oneLine(get(b, "display")) ||
    oneLine(get(obj(get(obj(pyOr(get(row, "item"), {})), "cells")), "citation"));
  if (!(display || citation)) return null;
  const official: string[] = [];
  for (const t of pyIter(pyOr(get(titles, "official"), []))) {
    const o =
      t !== null && typeof t === "object" && !Array.isArray(t) ? oneLine(get(t, "title")) : "";
    if (o && o !== display && !official.includes(o)) official.push(o);
  }
  const subjects = pySlice14(pyOr(get(b, "subjects"), []))
    .filter((s): s is string => typeof s === "string" && pyStrip(s) !== "")
    .map(oneLine);
  const area = oneLine(get(b, "policyArea"));
  const summary = summaryLines(get(b, "summary"));
  const parts = official.slice(0, 2).map((o) => `Official title: ${o}`);
  if (area) parts.push(`Policy area: ${area}`);
  if (subjects.length) parts.push(`Subjects: ${subjects.join("; ")}`);
  if (summary.length) parts.push("Summary:\n" + summary.join("\n"));
  const rid = pyStr(get(row, "id"));
  const typ = pyStr(pyOr(get(b, "type"), ""));
  const number = pyStr(pyOr(get(b, "number"), ""));
  const congress = get(b, "congress");
  const href = encodeHref(
    pyTruthy(congress) && typ && number
      ? `/law/legislation/federal/${pyStr(congress)}/${typ}/${number}`
      : `/records/congress_bills/${rid}`,
  );
  return {
    dataset: "congress_bills",
    record_id: rid,
    title: oneLine(get(row, "title")) || citation,
    heading: display ? `${citation}: ${display}` : citation,
    text: parts.length ? parts.join("\n") : display || citation,
    href,
    source_url: sourceUrlOf(get(row, "source_url")),
    max_chunks: 6,
  };
}

export function oversightDoc(row: SourceRow): Doc | null {
  const o = obj(pyOr(get(obj(pyOr(get(row, "item"), {})), "oversight"), {}));
  const title = oneLine(get(row, "title"));
  if (!title) return null;
  const desc = oneLine(get(o, "description"));
  const body = joinLines([
    pyTruthy(get(o, "oig")) ? `Reported by: ${oneLine(get(o, "oig"))}` : "",
    pyTruthy(get(o, "agency_reviewed")) ? `Agency reviewed: ${oneLine(get(o, "agency_reviewed"))}` : "",
    pyTruthy(get(o, "type")) ? `Report type: ${oneLine(get(o, "type"))}` : "",
    desc ? `Description: ${desc}` : "",
  ]);
  const rid = pyStr(get(row, "id"));
  return {
    dataset: "oversight_reports",
    record_id: rid,
    title,
    heading: `Inspector General report > ${title}`,
    text: body || title,
    href: encodeHref(`/records/oversight_reports/${rid}`),
    source_url: sourceUrlOf(get(row, "source_url")),
    max_chunks: 3,
  };
}

export function dojOigDoc(row: SourceRow): Doc | null {
  const d = obj(pyOr(get(obj(pyOr(get(row, "item"), {})), "dojoig"), {}));
  const title = oneLine(get(row, "title"));
  if (!title) return null;
  const components = pyIter(pyOr(get(d, "components"), []))
    .filter((c): c is string => typeof c === "string" && pyStrip(c) !== "")
    .map(oneLine);
  const body = joinLines([
    pyTruthy(get(d, "type")) ? `Report type: ${oneLine(get(d, "type"))}` : "",
    components.length ? `Components: ${components.join("; ")}` : "",
    pyTruthy(get(d, "entity")) ? `Entity: ${oneLine(get(d, "entity"))}` : "",
    pyTruthy(get(d, "location")) ? `Location: ${oneLine(get(d, "location"))}` : "",
    pyTruthy(get(d, "description")) ? `Description: ${oneLine(get(d, "description"))}` : "",
  ]);
  const rid = pyStr(get(row, "id"));
  return {
    dataset: "doj_oig_reports",
    record_id: rid,
    title,
    heading: `Department of Justice Inspector General report > ${title}`,
    text: body || title,
    href: encodeHref(`/records/doj_oig_reports/${rid}`),
    source_url: sourceUrlOf(get(row, "source_url")),
    max_chunks: 3,
  };
}

export function ftcPublicationDoc(row: SourceRow): Doc | null {
  const item = obj(pyOr(get(row, "item"), {}));
  const title = oneLine(get(row, "title"));
  const summary = oneLine(get(item, "summary"));
  if (!title) return null;
  const series = oneLine(get(obj(pyOr(get(item, "cells"), {})), "series"));
  const body = joinLines([series ? `Series: ${series}` : "", summary]);
  const rid = pyStr(get(row, "id"));
  return {
    dataset: "ftc_publications_index",
    record_id: rid,
    title,
    heading: `Federal Trade Commission > ${title}`,
    text: body || title,
    href: encodeHref(`/records/ftc_publications_index/${rid}`),
    source_url: sourceUrlOf(pyOr(get(item, "page_url"), pyOr(get(row, "source_url"), null))),
    max_chunks: 3,
  };
}

/** The Doc of one pruned row of `dataset`, or null when sources.py would leave the record out of the index. */
export function buildDoc(dataset: SourceDataset, row: SourceRow): Doc | null {
  switch (dataset) {
    case "us_code_sections":
      return uscDoc(row, uscTitleNames(get(row, "_title_names")));
    case "ecfr_sections_full":
      return cfrDoc(row);
    case "crs_reports":
      return crsDoc(row);
    case "congress_bills":
      return billDoc(row);
    case "oversight_reports":
      return oversightDoc(row);
    case "doj_oig_reports":
      return dojOigDoc(row);
    case "ftc_publications_index":
      return ftcPublicationDoc(row);
  }
}

/** The corpus keeps a U+001E mark before U.S. Code heading lines; exported for tests that build synthetic statutes. */
export const HEADING_MARK = MARK;
