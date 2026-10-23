/**
 * PostgreSQL's jsonb text form (`value::jsonb::text`) computed in JavaScript, so a row built here can be compared with a
 * stored row by hash in SQL (md5(<expr>::text)) without moving the stored row. Rules (PostgreSQL 17):
 *   - object keys ordered by UTF-8 byte length, then bytewise; '{"k": v, "k2": v2}' with ': ' and ', ';
 *   - arrays '[a, b]'; strings escaped like escape_json (\" \\ \b \f \n \r \t, other control characters as \u00xx,
 *     everything else literal); numbers in plain decimal notation (an exponent form is refused, never guessed).
 * Tested against PostgreSQL (pglite) in scripts/ingest/jsonb.test.mjs.
 */
import { createHash } from "node:crypto";

const enc = new TextEncoder();

function compareKeys(a, b) {
  const A = enc.encode(a);
  const B = enc.encode(b);
  if (A.length !== B.length) return A.length - B.length;
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
}

function str(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

function num(n) {
  if (!Number.isFinite(n)) throw new Error("non-finite number");
  const s = String(n);
  if (/e/i.test(s)) throw new Error(`number ${s} has no exact jsonb text form here`);
  return s;
}

export function jsonbText(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return num(v);
  if (typeof v === "string") return str(v);
  if (Array.isArray(v))
    return `[${v.map((x) => (x === undefined ? "null" : jsonbText(x))).join(", ")}]`;
  const keys = Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort(compareKeys);
  return `{${keys.map((k) => `${str(k)}: ${jsonbText(v[k])}`).join(", ")}}`;
}

/** First 16 hex characters of md5(jsonb text): the comparison key used by the dry run's SQL. */
export function jsonbHash(v) {
  return createHash("md5").update(jsonbText(v), "utf8").digest("hex").slice(0, 16);
}
