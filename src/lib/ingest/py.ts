/**
 * Python-compatible text helpers for ports of the Python builders (scripts/enrichment/**). The incremental rows must equal
 * what the builder writes, so whitespace, word boundaries, slicing, rounding and sorting follow Python 3 `str`/`re`
 * semantics, not JavaScript's:
 *   - `\s` is Python's Unicode whitespace (includes \x1c-\x1f and \x85, excludes U+FEFF);
 *   - `\w`/`\b` are Unicode word characters (letters, numbers, underscore), `\d` is a Unicode decimal digit;
 *   - `$` also matches before a final newline; `str.strip()` strips Python whitespace;
 *   - slicing counts code points; `round()` rounds half to even; `sorted()` compares code points.
 * Pure: no I/O. Shared by the edge functions (Deno) and the app (Node).
 */

/** Python's whitespace set (`str.isspace()` / `re` `\s` on str), as a character-class body. */
export const PY_WS =
  "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const WORD = "\\p{L}\\p{N}_";
const WB = `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;
const NWB = `(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`;

/** Translate a Python `re` pattern (str, no VERBOSE) into an equivalent JavaScript source for the `u` flag. */
export function pySource(pattern: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\") {
      const n = pattern[i + 1];
      if (n === undefined) throw new Error("trailing backslash");
      i++;
      if (n === "s") out += inClass ? PY_WS : `[${PY_WS}]`;
      else if (n === "S") {
        if (inClass) throw new Error("\\S inside a class is not supported");
        out += `[^${PY_WS}]`;
      } else if (n === "w") out += inClass ? WORD : `[${WORD}]`;
      else if (n === "W") {
        if (inClass) throw new Error("\\W inside a class is not supported");
        out += `[^${WORD}]`;
      } else if (n === "d") out += "\\p{Nd}";
      else if (n === "D") {
        if (inClass) throw new Error("\\D inside a class is not supported");
        out += "\\P{Nd}";
      } else if (n === "b" && !inClass) out += WB;
      else if (n === "B" && !inClass) out += NWB;
      else if (/[A-Za-z0-9]/.test(n)) {
        if ("tnrfvxu".includes(n) || (/[1-9]/.test(n) && !inClass)) out += "\\" + n;
        else throw new Error(`unsupported escape \\${n}`);
      } else if ("^$\\.*+?()[]{}|/-".includes(n)) out += "\\" + n;
      // Python reads any other escaped punctuation as the character itself; the `u` flag rejects such escapes
      else out += n;
      continue;
    }
    if (inClass) {
      const atStart = out.endsWith("[") || out.endsWith("[^");
      if (c === "]" && atStart) out += "\\]";
      else {
        if (c === "]") inClass = false;
        out += c;
      }
      continue;
    }
    if (c === "[") {
      inClass = true;
      out += c;
      if (pattern[i + 1] === "^") {
        out += "^";
        i++;
      }
      continue;
    }
    if (c === "$") {
      out += "(?=\\n?$)";
      continue;
    }
    // `{` `}` that are not a quantifier are literal in Python; the `u` flag requires them escaped
    if (c === "{" && !/^\{\d+(,\d*)?\}/.test(pattern.slice(i))) {
      out += "\\{";
      continue;
    }
    if (c === "}" && !/\{\d+(,\d*)?$/.test(pattern.slice(0, i))) {
      out += "\\}";
      continue;
    }
    out += c;
  }
  return out;
}

/** A RegExp with Python semantics. `flags` may contain i (re.I) and g (for replace/matchAll). */
export function pyRe(pattern: string, flags = ""): RegExp {
  return new RegExp(pySource(pattern), "u" + flags);
}

/** re.search */
export function pySearch(re: RegExp, s: string): RegExpExecArray | null {
  const r = new RegExp(re.source, re.flags.replace(/[gy]/g, ""));
  return r.exec(s);
}

/** re.match: anchored at the start. */
export function pyMatch(re: RegExp, s: string): RegExpExecArray | null {
  const r = new RegExp(re.source, re.flags.replace(/[gy]/g, "") + "y");
  r.lastIndex = 0;
  return r.exec(s);
}

/** re.fullmatch */
export function pyFullmatch(re: RegExp, s: string): RegExpExecArray | null {
  const r = new RegExp(`(?:${re.source})(?![\\s\\S])`, re.flags.replace(/[gy]/g, "") + "y");
  r.lastIndex = 0;
  return r.exec(s);
}

/** re.sub(pattern, repl, s) with a string replacement (no group references). */
export function pySub(re: RegExp, repl: string, s: string): string {
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  return s.replace(r, () => repl);
}

/** re.split (patterns without capture groups). */
export function pySplit(re: RegExp, s: string): string[] {
  const r = new RegExp(re.source, re.flags.replace(/[gy]/g, ""));
  return s.split(r);
}

const WS_RUN = pyRe("\\s+", "g");
const LEAD = new RegExp(`^[${PY_WS}]+`, "u");
const TRAIL = new RegExp(`[${PY_WS}]+$`, "u");

/** str.strip(chars): Python whitespace when chars is omitted. */
export function pyStrip(s: string, chars?: string): string {
  if (chars === undefined) return s.replace(LEAD, "").replace(TRAIL, "");
  const set = new Set(Array.from(chars));
  const cps = Array.from(s);
  let a = 0;
  let b = cps.length;
  while (a < b && set.has(cps[a]!)) a++;
  while (b > a && set.has(cps[b - 1]!)) b--;
  return cps.slice(a, b).join("");
}

/** `re.sub(r"\s+", " ", value or "").strip()` — the builders' clean_text. */
export function cleanText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return pyStrip(String(value).replace(WS_RUN, " "));
}

/** s[:n] counted in code points. */
export function pySlice(s: string, n: number): string {
  if (s.length <= n) return s;
  // fast path: no surrogate pairs
  if (!/[\ud800-\udfff]/.test(s)) return s.slice(0, n);
  return Array.from(s).slice(0, n).join("");
}

/** len(s) in code points. */
export function pyLen(s: string): number {
  return /[\ud800-\udfff]/.test(s) ? Array.from(s).length : s.length;
}

/** round(x) for a float: nearest integer, ties to even. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Python's default string ordering (code points). */
export function cmpPy(a: string, b: string): number {
  if (a === b) return 0;
  const A = Array.from(a);
  const B = Array.from(b);
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = A[i]!.codePointAt(0)!;
    const y = B[i]!.codePointAt(0)!;
    if (x !== y) return x - y;
  }
  return A.length - B.length;
}

/** Python tuple ordering for sort keys made of strings and numbers. */
export function cmpTuple(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    const c = typeof x === "number" && typeof y === "number" ? x - y : cmpPy(String(x), String(y));
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/** f"{n:,}" for an integer. */
export function fmtThousands(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  return (n < 0 ? "-" : "") + s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
