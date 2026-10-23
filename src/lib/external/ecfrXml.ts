/**
 * eCFR XML → text blocks, the same rules as scripts/enrichment/ecfr_full/ecfr_parse.py (which built the stored
 * dataset ecfr_sections_full), so the live "as of" view reads like the stored current text. Pure and isomorphic:
 * a small XML reader for the eCFR subset (elements, attributes, text, character references), no DOM.
 *
 * One section (DIV8 TYPE="SECTION") or appendix (DIV9 TYPE="APPENDIX") becomes `lines` (one block per line; table
 * cells joined by TAB; an empty line for a graphic), `layout` (one entry per block, see EcfrLayoutEntry) and `notes`
 * (source, authority, editorial, effective-date and amendment notes printed with it).
 */

export type XmlNode = {
  tag: string;
  attrs: Record<string, string>;
  children: (XmlNode | string)[];
};
export type EcfrNoteKind =
  "source" | "authority" | "omb" | "editorial" | "effective_date" | "amendment" | "cross_reference";
/** ["p", depth, flag?] | ["h", level, flag?] | ["t", rows] | ["g", src]; flag "x" box, "f" footnote, "i" flush. */
export type EcfrLayoutEntry =
  | ["p", number]
  | ["p", number, string]
  | ["h", number]
  | ["h", number, string]
  | ["t", (number | [number, number, number][])[]]
  | ["g", string];
export type EcfrItem = {
  n: string;
  type: string;
  heading: string;
  lines: string[];
  layout: EcfrLayoutEntry[];
  notes: [EcfrNoteKind, string][];
};

// ------------------------------------------------------------------------------------------------ XML reader
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(
    /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{0,31});/g,
    (m, body: string) => {
      if (body[0] === "#") {
        const cp =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
      }
      return NAMED[body] ?? m;
    },
  );
}

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/y;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

/** Parse an XML document into a tree. Tolerant: unknown entities stay as written; unclosed elements close at the end. */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { tag: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  let i = 0;
  const text = (s: string) => {
    if (!s) return;
    const top = stack[stack.length - 1]!;
    const d = decodeEntities(s);
    const last = top.children[top.children.length - 1];
    if (typeof last === "string") top.children[top.children.length - 1] = last + d;
    else top.children.push(d);
  };
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      text(xml.slice(i));
      break;
    }
    text(xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end < 0 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      const top = stack[stack.length - 1]!;
      top.children.push(xml.slice(lt + 9, end < 0 ? xml.length : end));
      i = end < 0 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt);
      i = end < 0 ? xml.length : end + 1;
      continue;
    }
    TAG.lastIndex = lt;
    const m = TAG.exec(xml);
    if (!m) {
      text("<");
      i = lt + 1;
      continue;
    }
    i = TAG.lastIndex;
    const [, close, tag, rawAttrs, selfClose] = m;
    if (close) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.tag === tag) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (rawAttrs ?? "").matchAll(ATTR))
      attrs[a[1]!] = decodeEntities(a[2] ?? a[3] ?? "");
    const node: XmlNode = { tag: tag!, attrs, children: [] };
    stack[stack.length - 1]!.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

const isNode = (c: XmlNode | string): c is XmlNode => typeof c !== "string";
export const elements = (n: XmlNode) => n.children.filter(isNode);
export function itertext(n: XmlNode): string {
  return n.children.map((c) => (typeof c === "string" ? c : itertext(c))).join("");
}
function* iterNodes(n: XmlNode): Generator<XmlNode> {
  yield n;
  for (const c of n.children) if (isNode(c)) yield* iterNodes(c);
}

// ------------------------------------------------------------------------------------------------ inline text
// Python str.isspace() set, so whitespace folding matches the builder exactly.
// eslint-disable-next-line no-control-regex -- \x1c-\x1f are whitespace to Python str.isspace(), which built the data
const WS = /[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;
export const collapse = (s: string | null | undefined) =>
  (s ?? "").replace(WS, " ").replace(/^ | $/g, "");
const isBlank = (s: string) => collapse(s) === "";

const SUP: Record<string, string> = zip(
  "0123456789+-−=()abcdefghijklmnoprstuvwxyzABDEGHIJKLMNOPRTUVW*.,",
  "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾" + "ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ" + "ᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ*·,",
);
const SUB: Record<string, string> = zip(
  "0123456789+-−=()aehijklmnoprstuvx",
  "₀₁₂₃₄₅₆₇₈₉₊₋₋₌₍₎" + "ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ",
);
function zip(a: string, b: string): Record<string, string> {
  const ka = [...a];
  const kb = [...b];
  const out: Record<string, string> = {};
  ka.forEach((k, n) => {
    out[k] = kb[n]!;
  });
  return out;
}
const ACCENTS: Record<string, string> = {
  "1": "́",
  "2": "̀",
  "3": "̂",
  "4": "̈",
  "6": "̃",
  "7": "̊",
  "8": "̄",
  "9": "̧",
  b: "̇",
  g: "̱",
  i: "̇̅",
  j: "̇̃",
};
const FRACTIONS: Record<string, string> = {
  "1/2": "½",
  "1/4": "¼",
  "3/4": "¾",
  "1/3": "⅓",
  "2/3": "⅔",
  "1/8": "⅛",
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
  "1/5": "⅕",
  "1/6": "⅙",
};

function script(
  t0: string,
  table: Record<string, string>,
  mark: string,
  lettersPlain: boolean,
): string {
  const t = collapse(t0);
  if (!t) return "";
  const chars = [...t];
  if (chars.every((c) => c in table)) return chars.map((c) => table[c]).join("");
  if (lettersPlain && /^\p{L}+$/u.test(t) && isAlphaPy(t)) return t;
  return `${mark}(${t})`;
}
/** Python str.isalpha (letters only, no marks); close enough for footnote and ordinal suffixes. */
const isAlphaPy = (t: string) => /^\p{L}+$/u.test(t);

export function inline(node: XmlNode, images?: string[]): string {
  const parts: string[] = [];
  const scripts = new Set<number>();
  const addScript = (s: string) => {
    // XML line breaks before a super/subscript are layout between two of them or after an opening bracket; elsewhere
    // they stay a space (same rule as the Python builder).
    const last = parts[parts.length - 1];
    const m = last === undefined ? null : /\n\s*$/.exec(last);
    if (last !== undefined && m) {
      const head = last.slice(0, m.index);
      if (!head.trim()) {
        if (parts.length >= 2 && scripts.has(parts.length - 2)) parts.pop();
      } else if (["(", "["].includes(head.replace(/\s+$/, "").slice(-1))) {
        parts[parts.length - 1] = head.replace(/\s+$/, "");
      }
    }
    scripts.add(parts.length);
    parts.push(s);
  };
  const walk = (e: XmlNode) => {
    const tag = e.tag;
    const t = e.attrs["T"];
    if (tag === "SU" || tag === "sup" || (tag === "E" && (t === "51" || t === "53"))) {
      addScript(script(itertext(e), SUP, "^", true));
    } else if (
      tag === "SUB" ||
      tag === "sub" ||
      (tag === "E" && (t === "52" || t === "54" || t === "0732"))
    ) {
      addScript(script(itertext(e), SUB, "_", false));
    } else if (tag === "FR" || tag === "fr") {
      const frac = collapse(itertext(e));
      const sym = FRACTIONS[frac];
      const prev = [...parts.join("")].pop() ?? "";
      // Python str.isdigit(): decimal digits plus super/subscript digits
      const digit = /[\p{Nd}²³¹⁰⁴-⁹₀-₉]/u.test(prev);
      parts.push(sym ? sym : (digit ? " " : "") + frac);
    } else if (tag === "AC") {
      const mark = ACCENTS[e.attrs["T"] ?? ""];
      if (mark) {
        while (parts.length && !parts[parts.length - 1]!.trim()) parts.pop();
        if (parts.length) parts[parts.length - 1] = parts[parts.length - 1]!.replace(/\s+$/, "");
        parts.push(mark);
      }
    } else if (tag === "br" || tag === "BR") {
      parts.push(" ");
    } else if (tag === "img" || tag === "IMG") {
      if (images && e.attrs["src"]) images.push(e.attrs["src"]);
    } else if (tag === "FTREF") {
      // footnote reference marker element (empty)
    } else {
      for (const c of e.children) {
        if (typeof c === "string") parts.push(c);
        else walk(c);
      }
    }
  };
  for (const c of node.children) {
    if (typeof c === "string") parts.push(c);
    else walk(c);
  }
  return collapse(parts.join(""));
}

// ------------------------------------------------------------------------------------------------ paragraph depth
type Kind = "L" | "N" | "R" | "U" | "IN" | "IR" | "IL" | "IU";
const ORDER: Record<Kind, number> = { L: 0, N: 1, R: 2, U: 3, IN: 4, IR: 5, IL: 6, IU: 7 };
const ROMAN: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];
export function toRoman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN)
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out;
}
export function romanValue(s: string): number | null {
  if (!/^[ivxlcdm]+$/.test(s)) return null;
  const vals: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  for (let k = 0; k < s.length; k++) {
    const v = vals[s[k]!]!;
    const nx = k + 1 < s.length ? vals[s[k + 1]!]! : 0;
    total += nx > v ? -v : v;
  }
  return toRoman(total) === s ? total : null;
}
export function letterNext(s: string): string {
  if (s && new Set(s).size === 1 && /^[A-Za-z]+$/.test(s)) {
    const c = s[0]!;
    if (c === "z" || c === "Z") return (c === "z" ? "a" : "A").repeat(s.length + 1);
    return String.fromCharCode(c.charCodeAt(0) + 1).repeat(s.length);
  }
  return "";
}
const isLetterSeq = (s: string) =>
  !!s && new Set(s).size === 1 && /^[A-Za-z]+$/.test(s) && s.length <= 3;
function candidates(token: string, italic: boolean): Kind[] {
  if (/^\d+$/.test(token)) return [italic ? "IN" : "N"];
  if (/^[A-Z]+$/.test(token) && isLetterSeq(token)) return [italic ? "IU" : "U"];
  if (/^[a-z]+$/.test(token)) {
    const out: Kind[] = [];
    if (romanValue(token) !== null) out.push(italic ? "IR" : "R");
    if (isLetterSeq(token)) out.push(italic ? "IL" : "L");
    return out;
  }
  return [];
}
function successor(kind: Kind, value: string): string {
  if (kind === "N" || kind === "IN") return String(parseInt(value, 10) + 1);
  if (kind === "R" || kind === "IR") {
    const v = romanValue(value);
    return v ? toRoman(v + 1) : "";
  }
  return letterNext(value);
}
type Marker = [string, boolean];
const MARK = /\(([0-9]{1,3}|[a-z]{1,4}|[A-Z]{1,3})\)/y;

export function leadingMarkers(el: XmlNode): Marker[] {
  const chars: [string, boolean][] = [];
  const add = (text: string, italic: boolean) => {
    for (const ch of text) {
      chars.push([ch, italic]);
      if (chars.length > 600) return false;
    }
    return true;
  };
  const walk = (e: XmlNode, italic: boolean): boolean => {
    const it =
      italic ||
      e.tag === "I" ||
      e.tag === "i" ||
      (e.tag === "E" && (e.attrs["T"] === "03" || e.attrs["T"] === "7462"));
    for (const c of e.children) {
      if (typeof c === "string") {
        if (!add(c, it)) return false;
      } else if (!walk(c, it)) return false;
    }
    return true;
  };
  for (const c of el.children) {
    if (typeof c === "string") {
      if (!add(c, false)) break;
    } else if (!walk(c, false)) break;
  }
  const s = chars.map((c) => c[0]).join("");
  const out: Marker[] = [];
  const take = (pos: number): number => {
    for (;;) {
      MARK.lastIndex = pos;
      const m = MARK.exec(s);
      if (!m) return pos;
      const start = pos + 1;
      const tok = m[1]!;
      let italic = true;
      for (let k = start; k < start + tok.length; k++) italic = italic && chars[k]![1];
      out.push([tok, italic]);
      pos = MARK.lastIndex;
    }
  };
  let pos = take(s.length - s.replace(/^\s+/, "").length);
  if (out.length) {
    while (pos < s.length && s[pos] === " ") pos++;
    const start = pos;
    while (pos < s.length && chars[pos]![1]) pos++;
    const head = s.slice(start, pos).replace(/\s+$/, "");
    if (pos - start >= 2 && [".", "—", ":", "-"].includes(head.slice(-1))) {
      while (pos < s.length && " .—".includes(s[pos]!)) pos++;
      take(pos);
    }
  }
  return out;
}

export function assignDepths(markersPerPar: Marker[][]): (number | null)[] {
  let stack: [Kind, string][] = [];
  const last: Partial<Record<Kind, string>> = {};
  let base: number | null = null;
  const out: (number | null)[] = [];
  const firsts = markersPerPar.map((m) => (m.length ? m[0]! : null));
  const nextFirst = (i: number) => {
    for (let j = i + 1; j < firsts.length; j++) if (firsts[j]) return firsts[j]!;
    return null;
  };
  const choose = (tok: string, italic: boolean, i: number, floor: number): Kind | null => {
    const cands = candidates(tok, italic).filter((c) => ORDER[c] > floor);
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0]!;
    const rom: Kind = italic ? "IR" : "R";
    const let_: Kind = italic ? "IL" : "L";
    const parent: Kind = italic ? "IN" : "N";
    const kinds = stack.map((s) => s[0]);
    const top = kinds[kinds.length - 1];
    const romOk =
      (tok === "i" &&
        (kinds.includes(parent) || (top !== undefined && ORDER[top] >= ORDER[parent]))) ||
      (last[rom] !== undefined && successor(rom, last[rom]!) === tok);
    const letOk = tok === "a" || (last[let_] !== undefined && successor(let_, last[let_]!) === tok);
    if (romOk && !letOk) return rom;
    if (letOk && !romOk) return let_;
    const nxt = nextFirst(i);
    if (nxt) {
      const [ntok, nital] = nxt;
      if (ntok === successor(rom, tok) && nital === italic) return rom;
      if (ntok === successor(let_, tok) && nital === italic) return let_;
      if (/^\d+$/.test(ntok)) return let_;
      if (ntok === ntok.toUpperCase() && /[A-Z]/.test(ntok)) return rom;
    }
    if (top !== undefined && ORDER[top] >= ORDER[parent]) return rom;
    return let_;
  };
  markersPerPar.forEach((markers, i) => {
    if (!markers.length) {
      out.push(null);
      return;
    }
    let depth: number | null = null;
    let floor = -1;
    for (let k = 0; k < markers.length; k++) {
      const [tok, italic] = markers[k]!;
      const kind = choose(tok, italic, i, k ? floor : -1);
      if (kind === null) break;
      const idx = ORDER[kind];
      stack = stack.filter(([kk]) => ORDER[kk] < idx);
      stack.push([kind, tok]);
      last[kind] = tok;
      for (const kk of Object.keys(last) as Kind[]) if (ORDER[kk] > idx) delete last[kk];
      if (k === 0) {
        if (base === null) base = idx;
        depth = Math.max(0, idx - base);
      }
      floor = idx;
    }
    out.push(depth);
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ body blocks
const NOTE_KINDS: Record<string, EcfrNoteKind> = {
  CITA: "source",
  SECAUTH: "authority",
  PARAUTH: "authority",
  APPRO: "omb",
  EDNOTE: "editorial",
  EFFDNOT: "effective_date",
  XREF: "amendment",
  CROSSREF: "cross_reference",
  AUTH: "authority",
  SOURCE: "source",
};
const FLUSH: Record<string, number> = {
  FP: 0,
  "FP-1": 1,
  "FP-2": 2,
  FP1: 1,
  FP2: 2,
  "FP1-2": 1,
  "FP-3": 3,
  FP3: 3,
  "FP-DASH": 0,
  FRP: 0,
  "FP1-1": 1,
  "FP2-2": 2,
  "FP-4": 4,
  PSPACE: 0,
  "FL-1": 1,
  "FL-2": 2,
  LDRFIG: 0,
  "P-1": 1,
  P1: 1,
  "P-2": 2,
  P2: 2,
  "P-3": 3,
  P3: 3,
  "FP2-3": 2,
  FRP0: 0,
  "P-DASH": 0,
  HALFDASH: 0,
  NAME: 0,
  LI: 1,
};
const HEADINGS: Record<string, number> = {
  HD1: 1,
  HD2: 2,
  HD3: 3,
  HD4: 4,
  HD5: 5,
  HD6: 6,
  HED: 2,
  TCAP: 3,
  BCAP: 3,
  TTITLE: 3,
  APP: 1,
  SUBJECT: 3,
  HED1: 1,
  SECHD: 2,
  PARTHD: 1,
  SUBCHIND: 3,
  DOCKETHD: 3,
  CHAPNO: 1,
};
const BOXES: Record<string, string> = {
  NOTE: "x",
  EXAMPLE: "x",
  EXTRACT: "x",
  NOTES: "x",
  FTNT: "f",
  EFTNT: "f",
  APPENDIX: "x",
  BOXTXT: "x",
};
const CONTAINERS = new Set(["DIV", "TBODY", "THEAD", "TFOOT", "LDRWK", "MATH", "GPH", "SCOL2"]);
const SKIP = new Set(["HEAD", "PRTPAGE", "FTREF", "GID"]);

class Body {
  lines: string[] = [];
  layout: EcfrLayoutEntry[] = [];
  notes: [EcfrNoteKind, string][] = [];
  private pars: [number, Marker[]][] = [];
  par(text: string, depth = 0, flag = "", markers?: Marker[]) {
    if (!text) return;
    this.lines.push(text);
    this.layout.push(flag ? ["p", depth, flag] : ["p", depth]);
    if (markers) this.pars.push([this.layout.length - 1, markers]);
  }
  head(text: string, level: number, flag = "") {
    if (!text) return;
    this.lines.push(text);
    this.layout.push(flag ? ["h", level, flag] : ["h", level]);
  }
  graphic(src: string) {
    this.lines.push("");
    this.layout.push(["g", src]);
  }
  finish() {
    const depths = assignDepths(this.pars.map((p) => p[1]));
    const positions = new Map<number, number | null>();
    this.pars.forEach(([li], n) => positions.set(li, depths[n] ?? null));
    let prev = 0;
    this.layout.forEach((entry, li) => {
      if (entry[0] !== "p" || entry.length > 2) return;
      if (positions.has(li)) {
        const d = positions.get(li) ?? prev;
        entry[1] = d;
        prev = d;
      }
    });
  }
}

function noteText(el: XmlNode): string {
  if (!elements(el).length) return inline(el);
  const bits: string[] = [];
  for (const c of el.children) {
    const t = typeof c === "string" ? collapse(c) : inline(c);
    if (t) bits.push(t);
  }
  return bits.join(" ");
}

const TABLE_TEXT_CLASSES: Record<string, number> = {
  gpotbl_title: 3,
  title: 3,
  gpotbl_description: 4,
  description: 4,
};

function tableRows(el: XmlNode, rows: XmlNode[], foot: XmlNode[]) {
  for (const c of elements(el)) {
    if (c.tag === "TR" || c.tag === "ROW") rows.push(c);
    else if (c.tag === "TFOOT")
      foot.push(...elements(c).filter((r) => r.tag === "TR" || r.tag === "ROW"));
    else if (c.tag === "THEAD" || c.tag === "TBODY" || c.tag === "TGROUP" || c.tag === "BOXHD")
      tableRows(c, rows, foot);
  }
}

/** Caption lines become headings, rows one TAB-joined line each, TFOOT rows footnote paragraphs. */
function table(el: XmlNode, body: Body) {
  for (const cap of elements(el).filter((c) => c.tag === "CAPTION")) {
    const ps = elements(cap).filter((p) => p.tag === "P");
    if (!ps.length) body.head(inline(cap), 3);
    for (const p of ps) body.head(inline(p), TABLE_TEXT_CLASSES[p.attrs["class"] ?? ""] ?? 4);
  }
  const rows: XmlNode[] = [];
  const foot: XmlNode[] = [];
  tableRows(el, rows, foot);
  const spec: (number | [number, number, number][])[] = [];
  for (const r of rows) {
    const cells = elements(r).filter((c) => c.tag === "TD" || c.tag === "TH" || c.tag === "ENT");
    if (!cells.length) continue;
    const texts: string[] = [];
    const cspec: [number, number, number][] = [];
    let plain = true;
    for (const c of cells) {
      const images: string[] = [];
      let t = inline(c, images);
      if (images.length)
        t = (t ? `${t} ` : "") + images.map((s) => `[graphic ${s.split("/").pop()}]`).join(" ");
      texts.push(t.replace(/\t/g, " "));
      const cs = parseInt(c.attrs["colspan"] ?? c.attrs["COLSPAN"] ?? "1", 10) || 1;
      const rs = parseInt(c.attrs["rowspan"] ?? c.attrs["ROWSPAN"] ?? "1", 10) || 1;
      const hd = c.tag === "TH" || (c.attrs["class"] ?? "").includes("colhed") ? 1 : 0;
      if (cs !== 1 || rs !== 1 || hd) plain = false;
      cspec.push([cs, rs, hd]);
    }
    body.lines.push(texts.join("\t"));
    spec.push(plain ? cells.length : cspec);
  }
  if (spec.length) body.layout.push(["t", spec]);
  for (const r of foot)
    body.par(
      elements(r)
        .map((c) => inline(c))
        .filter(Boolean)
        .join(" "),
      0,
      "f",
    );
}

function leader(el: XmlNode, body: Body) {
  const rows: string[][] = [];
  for (const c of elements(el)) {
    const t = inline(c);
    const lastRow = rows[rows.length - 1];
    if (c.tag === "LDRFIG" && lastRow && lastRow.length === 1) lastRow.push(t);
    else rows.push([t]);
  }
  if (rows.length) {
    for (const r of rows) body.lines.push(r.map((x) => x.replace(/\t/g, " ")).join("\t"));
    body.layout.push(["t", rows.map((r) => r.length)]);
  }
}

function blocks(el: XmlNode, body: Body, flag = "", top = true) {
  let first = true;
  for (const c of el.children) {
    if (typeof c === "string") {
      const t = collapse(c);
      if (t) {
        if (first && top) body.par(t, 0, "", []);
        else if (first) body.par(t, 0, flag);
        else body.par(t, 0, flag || "i");
      }
      first = false;
      continue;
    }
    first = false;
    const tag = c.tag;
    if (SKIP.has(tag)) continue;
    if (tag in NOTE_KINDS && top) {
      const text = noteText(c);
      if (text) body.notes.push([NOTE_KINDS[tag]!, text]);
    } else if (tag === "P" && (c.attrs["class"] ?? "") in TABLE_TEXT_CLASSES) {
      body.head(inline(c), TABLE_TEXT_CLASSES[c.attrs["class"] ?? ""]!, flag);
    } else if (tag === "P" && c.attrs["class"] === "gpotbl_note") {
      body.par(inline(c), 0, "f");
    } else if (tag === "P") {
      const images: string[] = [];
      const text = inline(c, images);
      if (text || !images.length) {
        if (top && !flag) body.par(text, 0, "", leadingMarkers(c));
        else body.par(text, 0, flag);
      }
      for (const src of images) body.graphic(src);
    } else if (tag in FLUSH) {
      const images: string[] = [];
      const text = inline(c, images);
      body.par(text, FLUSH[tag]!, flag || "i");
      for (const src of images) body.graphic(src);
    } else if (tag in HEADINGS) {
      body.head(inline(c), HEADINGS[tag]!, flag);
    } else if (tag === "TABLE" || tag === "GPOTABLE") {
      table(c, body);
    } else if (tag === "LDRWK") {
      leader(c, body);
    } else if (tag === "img" || tag === "IMG") {
      if (c.attrs["src"]) body.graphic(c.attrs["src"]);
    } else if (tag in BOXES) {
      blocks(c, body, BOXES[tag]!, false);
    } else if (CONTAINERS.has(tag)) {
      blocks(c, body, flag, flag ? false : top);
    } else if (tag in NOTE_KINDS) {
      const text = noteText(c);
      if (text) body.par(text, 0, flag || "x");
    } else {
      const text = inline(c);
      if (text) body.par(text, 0, flag || "i");
    }
  }
}

export function parseItem(el: XmlNode): EcfrItem {
  const head = elements(el).find((c) => c.tag === "HEAD");
  const body = new Body();
  blocks(el, body);
  body.finish();
  return {
    n: el.attrs["N"] ?? "",
    type: el.attrs["TYPE"] ?? "",
    heading: head ? inline(head) : "",
    lines: body.lines,
    layout: body.layout,
    notes: body.notes,
  };
}

/** Sections/appendices in document order, plus notes printed for their part (authority, source ...). */
export function parseEcfrDocument(xml: string): {
  items: EcfrItem[];
  partNotes: [EcfrNoteKind, string][];
} {
  const root = parseXml(xml);
  const items: EcfrItem[] = [];
  const partNotes: [EcfrNoteKind, string][] = [];
  const walk = (n: XmlNode) => {
    const type = n.tag.startsWith("DIV") ? n.attrs["TYPE"] : undefined;
    if (type === "SECTION" || type === "APPENDIX") {
      items.push(parseItem(n));
      return;
    }
    if (type === "PART" || type === "SUBPART" || type === "SUBJGRP") {
      for (const c of elements(n)) {
        const kind = NOTE_KINDS[c.tag];
        if (kind) {
          const t = noteText(c);
          if (t) partNotes.push([kind, t]);
        }
      }
    }
    for (const c of elements(n)) walk(c);
  };
  walk(root);
  return { items, partNotes };
}
