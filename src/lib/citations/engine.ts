/**
 * Canonical citation extractor, TypeScript engine (citations-v2). Port of scripts/citations_v2/engine.py: both engines
 * read the same generated pattern table (patterns.data.ts = patterns.json) and must return identical results; the golden
 * fixtures in fixtures/golden.json are checked by both test suites. Pure code (no Node or Deno APIs, relative .ts
 * imports) so the app, scripts and the ingest-citations edge function import the same module.
 *
 * Offsets in the result are code points of the input (what Postgres substr() reads); internally the engine works on
 * UTF-16 indices and converts at the end when the text holds characters outside the Basic Multilingual Plane.
 */
import { PATTERNS } from "./patterns.data.ts";
import type { Antecedent, Citation, CitationKind, PatternRule, PatternTable, ShortForm } from "./types.ts";

export const ENGINE = "citations-v2-ts";
export const MAX_CHARS = 2_000_000;

type Groups = Record<string, string>;
type Match = RegExpExecArray & { indices: Array<[number, number] | undefined> & { groups?: Record<string, [number, number] | undefined> } };

type Raw = Omit<Citation, "matched" | "group" | "name" | "paren" | "antecedent" | "short_status"> & {
  group: number | null;
  name: Citation["name"];
  paren: Citation["paren"];
  antecedent: Antecedent | null;
  short_status: Citation["short_status"];
  matched: string;
  _match: number;
  _priority: number;
  _order: number;
  _tail: number;
};

type CompiledRule = PatternRule & {
  order: number;
  rx: RegExp;
  itemRx?: RegExp;
  atomicRx?: Record<string, RegExp>;
  anchorsLower: string[];
};

export type Compiled = {
  table: PatternTable;
  rules: CompiledRule[];
  signals: RegExp;
  nameTail: RegExp;
  paren: RegExp;
  casePin: RegExp;
  join: RegExp;
  abbrev: Set<string>;
  pins: Record<string, RegExp>;
};

export function compileTable(table: PatternTable): Compiled {
  const rules = table.rules.map((r, order) => {
    const c: CompiledRule = {
      ...r,
      order,
      rx: new RegExp(r.pattern, `dg${r.flags.includes("i") ? "i" : ""}`),
      anchorsLower: r.anchors.map((a) => a.toLowerCase()),
    };
    if (r.item) c.itemRx = new RegExp(r.item, "dg");
    if (r.atomic) {
      c.atomicRx = {};
      for (const [g, p] of Object.entries(r.atomic)) c.atomicRx[g] = new RegExp(p, "y");
    }
    return c;
  });
  const pins: Record<string, RegExp> = {};
  for (const [k, v] of Object.entries(table.pins)) pins[k] = new RegExp(v, "d");
  return {
    table,
    rules,
    signals: new RegExp(table.case.signals, "d"),
    nameTail: new RegExp(table.case.name_tail, "d"),
    paren: new RegExp(table.case.paren, "d"),
    casePin: new RegExp(table.case.pin, "d"),
    join: new RegExp(table.case.join),
    abbrev: new Set(table.case.abbreviations),
    pins,
  };
}

let DEFAULT: Compiled | null = null;
export function defaultCompiled(): Compiled {
  DEFAULT ??= compileTable(PATTERNS);
  return DEFAULT;
}

// ------------------------------------------------------------------------------------------------ helpers
const SPACE_RUN = /\s+/g;
export const squash = (s: string) => s.replace(SPACE_RUN, " ").replace(/^ +| +$/g, "");
const nospace = (s: string) => s.replace(SPACE_RUN, "");
const dash = (s: string) => s.replace(/[–—‑]/g, "-");
const compact = (s: string) => nospace(s).replace(/’/g, "'");
const isDigits = (s: string) => /^[0-9]+$/.test(s);
const isUpperCh = (ch: string) => ch.length > 0 && ch === ch.toUpperCase() && ch !== ch.toLowerCase();
const isLowerCh = (ch: string) => ch.length > 0 && ch === ch.toLowerCase() && ch !== ch.toUpperCase();
const lettersLower = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const alnumLower = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
function romanToInt(s: string): number | null {
  const low = s.toLowerCase();
  if (!low || [...low].some((ch) => !(ch in ROMAN))) return null;
  let total = 0;
  let prev = 0;
  for (const ch of [...low].reverse()) {
    const v = ROMAN[ch]!;
    total = v < prev ? total - v : total + v;
    prev = Math.max(prev, v);
  }
  return total;
}
function intToRoman(n: number): string {
  const out: string[] = [];
  for (const [v, sym] of [
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ] as const) {
    while (n >= v) {
      out.push(sym);
      n -= v;
    }
  }
  return out.join("");
}
const leadNumber = (s: string) => {
  const m = /^\d+/.exec(s);
  return m ? Number(m[0]) : -1;
};
const intStr = (v: string) => (isDigits(v) ? String(parseInt(v, 10)) : v);

function applyFilter(c: Compiled, name: string, v: string): string {
  const t = c.table;
  switch (name) {
    case "int":
      return intStr(v);
    case "upper":
      return v.toUpperCase();
    case "lower":
      return v.toLowerCase();
    case "squash":
      return squash(v);
    case "nospace":
      return nospace(v);
    case "dash":
      return dash(v);
    case "roman": {
      const s = v.trim();
      const r = romanToInt(s);
      return r !== null ? String(r) : s;
    }
    case "upper_roman":
      return isDigits(v) && Number(v) > 0 && Number(v) < 400 ? intToRoman(Number(v)) : v.toUpperCase();
    case "nocomma":
      return v.replace(/,/g, "");
    case "slug":
      return alnumLower(v);
    case "state":
      return t.states[lettersLower(v)] ?? "";
    case "state_abbr":
      return t.state_abbr[t.states[lettersLower(v)] ?? ""] ?? "";
    case "rule_set":
      return t.rule_sets[lettersLower(v)] ?? "";
    case "rule_set_name":
      return t.rule_set_names[t.rule_sets[lettersLower(v)] ?? ""] ?? "";
    case "last2":
      return v.slice(-2);
    case "docketnum": {
      const n = v.replace(/^0+/, "") || "0";
      return n.length >= 5 ? n : n.padStart(5, "0");
    }
    default:
      throw new Error(`unknown template filter ${name}`);
  }
}

const PLACE = /\{([a-z_0-9]+)((?:\|[a-z_0-9]+)*)\}/g;
const OPT = /\[([^[\]]*)\]/g;

export function render(c: Compiled, template: string, groups: Groups): string {
  const place = (_m: string, nm: string, filters: string) => {
    let v = groups[nm] ?? "";
    if (!v) return "";
    for (const f of filters.split("|").filter(Boolean)) v = applyFilter(c, f, v);
    return v;
  };
  const opt = (_m: string, inner: string) => {
    const names = [...inner.matchAll(PLACE)].map((p) => p[1]!);
    if (names.length && names.every((nm) => groups[nm])) return inner.replace(PLACE, place);
    return "";
  };
  return template.replace(OPT, opt).replace(PLACE, place);
}

function groupsOf(m: RegExpExecArray): Groups {
  const out: Groups = {};
  for (const [k, v] of Object.entries(m.groups ?? {})) if (v !== undefined) out[k] = v;
  return out;
}
const gStart = (m: Match, name: string) => m.indices.groups?.[name]?.[0] ?? -1;
const gEnd = (m: Match, name: string) => m.indices.groups?.[name]?.[1] ?? -1;

function cite(
  rule: CompiledRule,
  kind: CitationKind,
  start: number,
  end: number,
  span: [number, number],
  match: number,
  key: string | null,
  normalized: string,
  fields: Record<string, string | null | undefined>,
  pin: string | null = null,
  form: "full" | "short" = "full",
  short: ShortForm | null = null,
): Raw {
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined && v !== "") f[k] = v;
  return {
    kind, form, short, rule: rule.id, start, end, span: [span[0], span[1]], key, normalized, pin, fields: f,
    group: null, name: null, paren: null, antecedent: null, short_status: null, matched: "",
    _match: match, _priority: rule.priority ?? 0, _order: rule.order, _tail: end,
  };
}

// ------------------------------------------------------------------------------------------------ builders
const reporterEditions = (c: Compiled, written: string) => c.table.reporters[compact(written)] ?? [];

function buildCase(c: Compiled, rule: CompiledRule, m: Match, mid: number): Raw[] {
  const g = groupsOf(m);
  const written = squash(g["reporter"]!).replace(/’/g, "'");
  const eds = reporterEditions(c, g["reporter"]!);
  const canonical = eds.length === 1 ? eds[0]! : compact(g["reporter"]!);
  const volume = String(parseInt(g["volume"]!, 10));
  const page = isDigits(g["page"]!) ? String(parseInt(g["page"]!, 10)) : g["page"]!;
  let citeText: string;
  if (rule.id === "case_tc_memo") citeText = `${canonical} ${volume}-${page}`;
  else if (rule.id === "case_neutral" && squash(m[0]).replace(/ -/g, "-").replace(/- /g, "-").includes("-"))
    citeText = `${volume}-${canonical}-${page}`;
  else citeText = `${volume} ${canonical} ${page}`;
  const fields: Record<string, string> = { volume, reporter: canonical, reporter_as_written: written, page, cite: citeText };
  if (eds.length > 1) fields["reporter_editions"] = eds.join("|");
  const s = m.index;
  const e = m.index + m[0].length;
  return [cite(rule, "case", s, e, [s, e], mid, `case:${volume}:${canonical}:${page}`, citeText, fields)];
}

function buildCaseShort(c: Compiled, rule: CompiledRule, m: Match, mid: number): Raw[] {
  const g = groupsOf(m);
  const eds = reporterEditions(c, g["reporter"]!);
  const canonical = eds.length === 1 ? eds[0]! : compact(g["reporter"]!);
  const volume = String(parseInt(g["volume"]!, 10));
  const pin = squash(g["pin"]!);
  const fields = { volume, reporter: canonical, reporter_as_written: squash(g["reporter"]!).replace(/’/g, "'") };
  const s = m.index;
  const e = m.index + m[0].length;
  return [cite(rule, "case", s, e, [s, e], mid, null, `${volume} ${canonical} at ${pin}`, fields, pin, "short", "at")];
}

function buildStatuteList(c: Compiled, rule: CompiledRule, m: Match, mid: number): Raw[] {
  const g = groupsOf(m);
  const family = rule.family;
  const title = rule.const?.["title"] || String(parseInt(g["title"]!, 10));
  const label = (g["label"] ?? "").trim();
  const plural = /^(§§|secs\.|sections|parts|pts\.)$/i.test(label);
  const body = g["items"]!;
  const bodyStart = gStart(m, "items");
  const itemRx = new RegExp(rule.itemRx!.source, "dg");
  const items = ([...body.matchAll(itemRx)] as Match[]).slice(0, plural ? 20 : 1);
  if (!items.length) return [];
  const last = items[items.length - 1]!;
  const spanEnd = bodyStart + last.index + last[0].length;
  const out: Raw[] = [];
  const appendix = !!g["app"];
  const ms = m.index;
  items.forEach((it, i) => {
    const ig = groupsOf(it);
    const s = i === 0 ? ms : bodyStart + it.index;
    const e = bodyStart + it.index + it[0].length;
    if (family === "usc") {
      let section = ig["section"]!;
      let sectionEnd: string | null = ig["section_end"] ?? null;
      const pin = nospace(ig["subs"] ?? "") || nospace(ig["subs_end"] ?? "") || null;
      const fields: Record<string, string> = { title, section };
      const sep = sectionEnd ? body.slice(gEnd(it, "section"), gStart(it, "section_end")) : "";
      if (
        sectionEnd && /^\d{1,6}[A-Za-z]{1,4}$/.test(section) && /^\d{1,4}[A-Za-z]{0,4}$/.test(sectionEnd) &&
        /^[-–—]$/.test(sep) && leadNumber(sectionEnd) < leadNumber(section)
      ) {
        section = `${section}-${sectionEnd}`;
        sectionEnd = null;
        fields["section"] = section;
        fields["dash_joined"] = "true";
      }
      const t = title + (appendix ? "a" : "");
      if (appendix) fields["appendix"] = "true";
      let key: string;
      let norm: string;
      if (sectionEnd) {
        fields["section_end"] = sectionEnd;
        key = `usc:${t}:${section}:${sectionEnd}`;
        norm = `${title} U.S.C.${appendix ? " app." : ""} §§ ${section}–${sectionEnd}`;
      } else {
        key = `usc:${t}:${section}`;
        norm = `${title} U.S.C.${appendix ? " app." : ""} § ${section}`;
      }
      if (g["etseq"] && i === items.length - 1) fields["et_seq"] = "true";
      out.push(cite(rule, "usc", s, e, [ms, spanEnd], mid, key, norm, fields, pin));
      return;
    }
    const part = parseInt(ig["part"]!, 10);
    let section: string | null = ig["section"] ?? null;
    const partEndText = ig["part_end"] ?? null;
    let partEnd: number | null = partEndText ? parseInt(partEndText, 10) : null;
    const sectionEnd = ig["section_end"] ?? null;
    const pin = nospace(ig["subs"] ?? "") || nospace(ig["subs_end"] ?? "") || null;
    if (section) {
      const fields: Record<string, string> = { title, part: String(part), section };
      const sep = partEndText ? body.slice(gEnd(it, "subs"), gStart(it, "part_end")) : "";
      if (partEndText && !sectionEnd && /^[-–—]$/.test(sep) && partEnd! < part) {
        section = `${section}-${partEndText}`;
        fields["section"] = section;
        fields["dash_joined"] = "true";
        partEnd = null;
      }
      const end = partEnd !== null && sectionEnd ? `${partEnd}.${sectionEnd}` : null;
      if (end) fields["section_end"] = end;
      const key = `cfr:${title}:${part}.${section}` + (end ? `:${end}` : "");
      const norm = end ? `${title} C.F.R. §§ ${part}.${section}–${end}` : `${title} C.F.R. § ${part}.${section}`;
      out.push(cite(rule, "cfr", s, e, [ms, spanEnd], mid, key, norm, fields, pin));
      return;
    }
    const adjacent = partEnd !== null && partEnd > part && partEnd - part <= 1;
    const rng = partEnd !== null && partEnd - part > 1 ? partEnd : null;
    const parts = adjacent ? [part, partEnd!] : [part];
    parts.forEach((p, j) => {
      let ps: number;
      let pe: number;
      if (adjacent && j === 1) {
        ps = bodyStart + gStart(it, "part_end");
        pe = bodyStart + gEnd(it, "part_end");
      } else if (adjacent) {
        ps = s;
        pe = bodyStart + gEnd(it, "part");
      } else {
        ps = s;
        pe = e;
      }
      const fields: Record<string, string> = { title, part: String(p) };
      if (rng) fields["part_end"] = String(rng);
      const key = `cfr-part:${title}:${p}` + (rng ? `:${rng}` : "");
      const norm = rng ? `${title} C.F.R. parts ${p}–${rng}` : `${title} C.F.R. part ${p}`;
      out.push(cite(rule, "cfr_part", ps, pe, [ms, spanEnd], mid, key, norm, fields, pin));
    });
  });
  return out;
}

function buildSingle(c: Compiled, rule: CompiledRule, m: Match, mid: number): Raw[] {
  const g = groupsOf(m);
  if (rule.nonzero && parseInt(g[rule.nonzero] || "0", 10) === 0) return [];
  const fields: Record<string, string> = {};
  for (const [k, t] of Object.entries(rule.fields ?? {})) fields[k] = render(c, t, g);
  for (const req of rule.required ?? []) if (!fields[req]) return [];
  const key = render(c, rule.key!, g);
  const norm = render(c, rule.normalized!, g);
  const pin = rule.pin_group ? nospace(g[rule.pin_group] ?? "") || null : null;
  const s = m.index;
  const e = m.index + m[0].length;
  return [cite(rule, rule.kind as CitationKind, s, e, [s, e], mid, key, norm, fields, pin)];
}

const SIGN_TAIL = /\s*(?:§§?|[Ss]ec(?:tion)?s?\.?|art\.|arts\.|Art\.|[Rr]ule)?\s*$/;
const SUBJECT_DROP = new Set(["cal", "tex", "md", "n", "y", "code", "ann", "law", "l", "laws"]);

function buildStateStatute(c: Compiled, rule: CompiledRule, m: Match, mid: number): Raw[] {
  const g = groupsOf(m);
  for (const [grp, rx] of Object.entries(rule.atomicRx ?? {})) {
    rx.lastIndex = gStart(m, grp);
    const a = rx.exec(m.input);
    if (!a || a.index + a[0].length !== gEnd(m, grp)) return [];
  }
  const rawCode = g["code_text"]!;
  const sec = dash(g["sec"]!);
  let code = squash(rawCode.replace(SIGN_TAIL, "")).replace(/,+$/, "");
  const st = rule.state!;
  const title = g["title"] || g["title2"];
  let normalized: string;
  let path: string;
  if (rule.code === "ilcs") {
    code = squash(rawCode).replace(/\/+$/, "");
    normalized = `${code}/${sec}`;
    path = `${parseInt(title!, 10)}/${g["act"]}/${sec}`;
  } else {
    if (st === "LA" && /Civ\.\s*Code/.test(code)) normalized = `${code} ${rawCode.includes("arts.") ? "arts." : "art."} ${sec}`;
    else if (rawCode.includes("§")) normalized = `${code} § ${sec}`;
    else normalized = `${code} ${sec}`;
    if (title) path = `${title}:${sec}`;
    else if (g["chapter"]) path = `${g["chapter"]}:${sec}`;
    else path = sec;
  }
  let codeId = rule.code!;
  if (codeId === "*") {
    const words = (code.match(/[A-Za-z]+/g) ?? []).map((w) => w.toLowerCase());
    codeId = words.filter((w) => !SUBJECT_DROP.has(w)).join("") || "code";
  }
  const fields: Record<string, string> = { state: st, code, code_id: codeId, section: sec };
  for (const k of ["title", "chapter", "act"]) if (g[k]) fields[k] = g[k]!;
  if (g["title2"]) fields["title"] = g["title2"];
  const key = `state-stat:${st}:${codeId}:${path}`.slice(0, 200);
  const s = m.index;
  const e = m.index + m[0].length;
  return [cite(rule, "state_statute", s, e, [s, e], mid, key, normalized, fields)];
}

function buildStateRegulation(c: Compiled, rule: CompiledRule, m: Match, mid: number): Raw[] {
  const g = groupsOf(m);
  const sec = nospace(dash(g["sec"] || g["sec2"] || ""));
  if (!sec) return [];
  const parts = [...["title", "part", "agency"].filter((k) => g[k]).map((k) => nospace(g[k]!)), sec];
  const st = rule.state!;
  const fields: Record<string, string> = { state: st, code_id: rule.code!, section: sec };
  for (const k of ["title", "part", "agency"]) if (g[k]) fields[k] = g[k]!;
  const key = `state-reg:${st}:${rule.code}:${parts.join(":")}`.slice(0, 200);
  const s = m.index;
  const e = m.index + m[0].length;
  return [cite(rule, "state_regulation", s, e, [s, e], mid, key, dash(squash(m[0])), fields)];
}

function buildId(c: Compiled, rule: CompiledRule, m: Match, mid: number): Raw[] {
  const g = groupsOf(m);
  const fields: Record<string, string> = {};
  let pin: string | null = null;
  if (g["pin"]) {
    pin = squash(g["pin"]);
    fields["pin_kind"] = "page";
  }
  if (g["sec"]) {
    fields["section"] = dash(nospace(g["sec"].replace(/^§§?/, "")));
    const sub = /(\([a-zA-Z0-9]{1,5}\))+$/.exec(fields["section"]);
    if (sub) {
      pin = sub[0];
      fields["section"] = fields["section"].slice(0, sub.index);
    }
  }
  if (g["para"]) {
    pin = squash(g["para"]);
    fields["pin_kind"] = "paragraph";
  }
  const s = m.index;
  const e = m.index + m[0].length;
  return [cite(rule, "short", s, e, [s, e], mid, null, squash(m[0]), fields, pin, "short", "id")];
}

function buildSupra(c: Compiled, rule: CompiledRule, m: Match, mid: number): Raw[] {
  const g = groupsOf(m);
  let name = g["name"]!;
  const sig = c.signals.exec(name);
  const nameStart = gStart(m, "name") + (sig ? sig[0].length : 0);
  if (sig) name = name.slice(sig[0].length);
  if (!name) return [];
  const e = m.index + m[0].length;
  return [
    cite(rule, "short", nameStart, e, [nameStart, e], mid, null, squash(m[0].slice(nameStart - m.index)), { name: squash(name) },
      g["pin"] ? squash(g["pin"]) : null, "short", "supra"),
  ];
}

function buildSectionShort(c: Compiled, rule: CompiledRule, m: Match, mid: number): Raw[] {
  const g = groupsOf(m);
  const s = m.index;
  const e = m.index + m[0].length;
  return [
    cite(rule, "short", s, e, [s, e], mid, null, `§ ${dash(g["section"]!)}`, { section: dash(g["section"]!) },
      nospace(g["subs"] ?? "") || null, "short", "section"),
  ];
}

function buildRuleShort(c: Compiled, rule: CompiledRule, m: Match, mid: number): Raw[] {
  const g = groupsOf(m);
  const s = m.index;
  const e = m.index + m[0].length;
  return [
    cite(rule, "short", s, e, [s, e], mid, null, `Rule ${g["rule"]}`, { rule: g["rule"]! }, nospace(g["subs"] ?? "") || null,
      "short", "rule"),
  ];
}

const BUILDERS: Record<string, (c: Compiled, rule: CompiledRule, m: Match, mid: number) => Raw[]> = {
  case: buildCase,
  case_short: buildCaseShort,
  statute_list: buildStatuteList,
  single: buildSingle,
  state_statute: buildStateStatute,
  state_regulation: buildStateRegulation,
  id: buildId,
  supra: buildSupra,
  section_short: buildSectionShort,
  rule_short: buildRuleShort,
};

// ------------------------------------------------------------------------------------------------ page extraction
function candidates(c: Compiled, text: string): { cands: Raw[]; furniture: [number, number][] } {
  let lower: string | null = null;
  const cands: Raw[] = [];
  const furniture: [number, number][] = [];
  let mid = 0;
  for (const r of c.rules) {
    if (r.anchors.length) {
      if (r.flags.includes("i")) {
        lower ??= text.toLowerCase();
        const l = lower;
        if (!r.anchorsLower.some((a) => l.includes(a))) continue;
      } else if (!r.anchors.some((a) => text.includes(a))) continue;
    }
    r.rx.lastIndex = 0;
    for (const m of text.matchAll(r.rx) as IterableIterator<Match>) {
      if (m[0].length === 0) continue;
      mid += 1;
      if (r.builder === "furniture") {
        furniture.push([m.index, m.index + m[0].length]);
        continue;
      }
      cands.push(...BUILDERS[r.builder]!(c, r, m, mid));
    }
  }
  return { cands, furniture };
}

function cmp(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function resolveOverlaps(cands: Raw[]): Raw[] {
  cands.sort((a, b) =>
    cmp([a.span[0], -a.span[1], -a._priority, a._order, a.start], [b.span[0], -b.span[1], -b._priority, b._order, b.start]),
  );
  const kept: Raw[] = [];
  let lastMatch: number | null = null;
  let spanEnd = -1;
  for (const x of cands) {
    if (x._match === lastMatch) {
      kept.push(x);
      continue;
    }
    if (x.span[0] < spanEnd) continue;
    kept.push(x);
    lastMatch = x._match;
    spanEnd = x.span[1];
  }
  kept.sort((a, b) => cmp([a.start, a.end, a._order], [b.start, b.end, b._order]));
  return kept;
}

function lastSentenceCut(c: Compiled, seg: string): number {
  let cut = 0;
  for (const m of seg.matchAll(/[.!?]["”’)]*\s+(?=["“(]?[A-Z])|\n[ \t]*\n/g)) {
    if (seg[m.index] === ".") {
      const before = seg.slice(0, m.index);
      const w = /([A-Za-z][A-Za-z.'’]*)$/.exec(before);
      if (w) {
        const tok = w[1]!;
        const low = tok.toLowerCase().replace(/\.+$/, "");
        if (!isLowerCh(tok[0]!) || c.abbrev.has(low) || low.length < 2 || /^[a-z](?:\.[a-z])+$/.test(low)) continue;
      } else if (!/[0-9)"”’]$/.test(before)) continue;
    }
    cut = m.index + m[0].length;
  }
  return cut;
}

const CONNECTORS = new Set([
  "of", "the", "and", "&", "for", "de", "del", "la", "le", "du", "des", "van", "von", "ex", "rel.", "et", "al.", "d/b/a",
  "a/k/a", "n/k/a", "f/k/a", "y",
]);
const CORP_SUFFIX = /^(?:Inc|Co|Corp|Ltd|LLC|L\.L\.C|LLP|L\.L\.P|L\.P|LP|P\.C|N\.A|S\.A|AG|PLC|plc|GmbH)\.?,?$/;

function plaintiffTail(c: Compiled, before: string): number {
  const toks = [...before.matchAll(/\S+/g)];
  let start = before.length;
  for (let i = toks.length - 1; i >= 0; i -= 1) {
    const t = toks[i]![0];
    const bare = t.replace(/,+$/, "");
    if (c.signals.test(t + " ")) break;
    if (t.endsWith(",") && i < toks.length - 1 && !CORP_SUFFIX.test(toks[i + 1]![0])) break;
    const ch = bare.slice(0, 1);
    if (isUpperCh(ch) || /^[0-9]$/.test(ch) || bare.startsWith("'") || bare.startsWith("’") || bare.startsWith("&")) {
      start = toks[i]!.index;
    } else if (CONNECTORS.has(bare.toLowerCase())) {
      // a connector inside a name; the name starts at the next capitalised word to its left
    } else break;
  }
  return start;
}

const NAME_PREFIX =
  /^(?:In\s+re|IN\s+RE|Ex\s+parte|EX\s+PARTE|(?:In\s+the\s+)?Matter\s+of|Estate\s+of|Application\s+of|Petition\s+of)\s/;

export function caseName(c: Compiled, text: string, start: number, floor: number): Citation["name"] {
  const lo = Math.max(floor, start - 260, 0);
  let seg = text.slice(lo, start);
  const cut = lastSentenceCut(c, seg);
  seg = seg.slice(cut);
  const base = lo + cut;
  const m = c.nameTail.exec(seg) as Match | null;
  if (!m) return null;
  let s = gStart(m, "name");
  const e = gEnd(m, "name");
  const nm = seg.slice(s, e);
  const v = /\s+vs?\.?\s+/.exec(nm);
  if (v && !NAME_PREFIX.test(nm)) {
    const ps = plaintiffTail(c, nm.slice(0, v.index));
    if (ps >= v.index) return null;
    s += ps;
  } else {
    const sig = c.signals.exec(nm);
    if (sig && !/^In\s+re\s/.test(nm)) s += sig[0].length;
  }
  const name = text.slice(base + s, base + e);
  if (!name.trim() || name.length > 240) return null;
  return { text: squash(name), start: base + s, end: base + e };
}

function postprocess(c: Compiled, text: string, keptIn: Raw[]): Raw[] {
  const starts = [...new Set(keptIn.filter((x) => x.form === "full").map((x) => x.span[0]))].sort((a, b) => a - b);
  const covered: [number, number][] = [];
  const nextStart = (after: number) => starts.find((s) => s > after) ?? text.length;
  for (const x of keptIn) {
    x._tail = x.end;
    if (x.form !== "full") continue;
    const rx = x.kind === "case" ? c.casePin : c.pins[x.kind];
    if (rx && x.pin === null) {
      const limit = Math.min(x.end + 80, nextStart(x.start));
      const pm = rx.exec(text.slice(x.end, limit));
      if (pm) {
        x.pin = squash(pm.groups!["pin"]!);
        x._tail = x.end + pm.index + pm[0].length;
        covered.push([x.end, x._tail]);
      }
    }
  }
  const kept = covered.length
    ? keptIn.filter((x) => x.form === "full" || !covered.some(([a, b]) => a <= x.start && x.start < b))
    : keptIn;
  let group = 0;
  let prevTail = -1;
  let members: number[] = [];
  const close = (ms: number[]) => {
    if (!ms.length) return;
    const last = kept[ms[ms.length - 1]!]!;
    const tail = last._tail;
    const pm = c.paren.exec(text.slice(tail, tail + 140)) as Match | null;
    let paren: Citation["paren"] = null;
    if (pm) {
      const court = squash(pm.groups!["court"]!).replace(/,+$/, "");
      paren = {
        court,
        year: pm.groups!["year"]!,
        date: squash(pm.groups!["date"]!),
        start: tail + pm.index,
        end: tail + pm.index + pm[0].length,
      };
    }
    const first = ms[0]!;
    const floor = first > 0 ? kept[first - 1]!._tail : 0;
    const name = caseName(c, text, kept[first]!.start, floor);
    for (const i of ms) {
      kept[i]!.paren = paren;
      kept[i]!.name = name;
    }
  };
  kept.forEach((x, idx) => {
    if (x.kind !== "case" || x.form !== "full") {
      close(members);
      members = [];
      prevTail = -1;
      return;
    }
    const joined = prevTail >= 0 && c.join.test(text.slice(prevTail, x.start));
    if (!joined) {
      close(members);
      members = [];
      group += 1;
    }
    x.group = group;
    members.push(idx);
    prevTail = x._tail;
  });
  close(members);
  return kept;
}

function pageCitations(c: Compiled, text: string): Raw[] {
  const source = text.slice(0, MAX_CHARS);
  const { cands, furniture } = candidates(c, source);
  const filtered = furniture.length
    ? cands.filter((x) => x.kind !== "docket" || furniture.every(([a, b]) => x.end <= a || x.start >= b))
    : cands;
  const kept = postprocess(c, source, resolveOverlaps(filtered));
  for (const x of kept) x.matched = source.slice(x.start, x.end);
  return kept;
}

/** Citations of one text (a page or a whole document), short forms linked within it. */
export function extractCitations(text: string, compiled?: Compiled): Citation[] {
  const c = compiled ?? defaultCompiled();
  const kept = pageCitations(c, text);
  linkShortForms(c, [[0, text, kept]]);
  const cp = codePointMapper(text);
  return kept.map((x) => toPublic(x, cp));
}

/**
 * Citations of a document given page by page: short forms may refer to a citation on an earlier page (the antecedent is
 * then {page, index}). Offsets are per page.
 */
export function extractPages(pages: string[], compiled?: Compiled): Citation[][] {
  const c = compiled ?? defaultCompiled();
  const per: [number, string, Raw[]][] = pages.map((t, i) => [i, t, pageCitations(c, t)]);
  linkShortForms(c, per);
  return per.map(([, t, kept]) => {
    const cp = codePointMapper(t);
    return kept.map((x) => toPublic(x, cp));
  });
}

/** UTF-16 index -> code-point index (identity when the text has no surrogate pairs). */
function codePointMapper(text: string): (i: number) => number {
  if (!/[\uD800-\uDFFF]/.test(text)) return (i) => i;
  const map = new Int32Array(text.length + 1);
  let cp = 0;
  for (let i = 0; i < text.length; i += 1) {
    map[i] = cp;
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        map[i + 1] = cp;
        i += 1;
      }
    }
    cp += 1;
  }
  map[text.length] = cp;
  return (i) => map[i]!;
}

function toPublic(x: Raw, cp: (i: number) => number): Citation {
  return {
    kind: x.kind,
    form: x.form,
    short: x.short,
    rule: x.rule,
    start: cp(x.start),
    end: cp(x.end),
    matched: x.matched,
    span: [cp(x.span[0]), cp(x.span[1])],
    key: x.key,
    normalized: x.normalized,
    pin: x.pin,
    fields: x.fields,
    group: x.group,
    name: x.name ? { text: x.name.text, start: cp(x.name.start), end: cp(x.name.end) } : null,
    paren: x.paren ? { ...x.paren, start: cp(x.paren.start), end: cp(x.paren.end) } : null,
    antecedent: x.antecedent,
    short_status: x.short_status,
  };
}

// ------------------------------------------------------------------------------------------------ short forms
const PAGED_KINDS = new Set(["case", "federal_register", "statutes_at_large"]);

/** The two citations sit in one citation sentence joined by a semicolon (a string cite). */
function betweenIsStringCite(c: Compiled, text: string, aEnd: number, bStart: number): boolean {
  const gap = text.slice(aEnd, bStart);
  return gap.length < 400 && gap.includes(";") && lastSentenceCut(c, gap) === 0;
}

type Hist = [number, number, Raw];

function linkShortForms(c: Compiled, pages: [number, string, Raw[]][]): void {
  const history: Hist[] = [];
  let lastRuleSet: string | null = null;
  const single = pages.length === 1;
  for (const [p, text, kept] of pages) {
    kept.forEach((x, i) => {
      if (x.form === "full") {
        if (x.kind !== "mdl" && x.kind !== "docket") history.push([p, i, x]);
        if (x.kind === "federal_rule") lastRuleSet = x.fields["set"] ?? null;
        return;
      }
      let target: Hist | null = null;
      let status: "resolved" | "ambiguous" | "none" = "none";
      if (x.short === "id") {
        const prev = history.length ? history[history.length - 1]! : null;
        if (prev) {
          const [pp, , px] = prev;
          status = "resolved";
          if (history.length > 1 && pp === p) {
            const [qp, , qx] = history[history.length - 2]!;
            if (
              qp === p && qx.key !== px.key && (qx.group === null || qx.group !== px.group) &&
              betweenIsStringCite(c, text, qx.end, px.start)
            )
              status = "ambiguous";
          }
          // "Id. at 570" names a page; the preceding authority has none
          if (x.fields["pin_kind"] === "page" && !PAGED_KINDS.has(px.kind)) status = "ambiguous";
          const sec = x.fields["section"];
          if (status === "resolved" && sec) {
            const f = px.fields;
            if (px.kind === "usc") {
              x.key = `usc:${f["title"]}:${sec}`;
              x.normalized = `${f["title"]} U.S.C. § ${sec}`;
            } else if (px.kind === "cfr" && sec.includes(".")) {
              x.key = `cfr:${f["title"]}:${sec}`;
              x.normalized = `${f["title"]} C.F.R. § ${sec}`;
            } else if (px.kind === "state_statute") {
              x.key = `state-stat:${f["state"]}:${f["code_id"]}:${sec}`;
              x.normalized = `${f["code"]} § ${sec}`;
            } else status = "ambiguous";
            if (status === "resolved") {
              x.kind = px.kind !== "cfr_part" ? px.kind : "cfr";
              target = prev;
            }
          } else if (status === "resolved") {
            x.key = px.key;
            x.kind = px.kind;
            target = prev;
          }
        }
      } else if (x.short === "at") {
        const vol = x.fields["volume"];
        const rep = x.fields["reporter"];
        const pinPage = x.pin ? leadNumber(x.pin.replace(/^\*+/, "")) : -1;
        let cands = history.filter(
          ([, , h]) =>
            h.kind === "case" && h.form === "full" && h.fields["volume"] === vol && h.fields["reporter"] === rep &&
            isDigits(h.fields["page"] ?? "") && Number(h.fields["page"]) <= pinPage,
        );
        let keys = new Set(cands.map(([, , h]) => h.key));
        if (keys.size > 1) {
          const nm = /([A-Z][A-Za-z'’.&-]+)(?:\s+[A-Z][A-Za-z'’.&-]+)*,\s*$/.exec(text.slice(Math.max(0, x.start - 80), x.start));
          if (nm) {
            const word = nm[1]!.replace(/\.+$/, "").toLowerCase();
            const named = cands.filter(([, , h]) => h.name && (h.name.text.toLowerCase().match(/[a-z0-9'’]+/g) ?? []).includes(word));
            if (new Set(named.map(([, , h]) => h.key)).size === 1) {
              cands = named;
              keys = new Set([named[0]![2].key]);
            }
          }
        }
        if (keys.size === 1) {
          target = cands[cands.length - 1]!;
          status = "resolved";
          x.key = target[2].key;
          x.kind = "case";
        } else if (keys.size) status = "ambiguous";
      } else if (x.short === "supra") {
        const words = x.fields["name"]!.toLowerCase().match(/[a-z0-9'’]+/g) ?? [];
        const cands: Hist[] = [];
        if (words.length) {
          for (const h of history) {
            if (h[2].kind === "case" && h[2].name) {
              const nw = h[2].name.text.toLowerCase().match(/[a-z0-9'’]+/g) ?? [];
              let hit = false;
              for (let k = 0; k < nw.length && !hit; k += 1) hit = words.every((w, j) => nw[k + j] === w);
              if (hit) cands.push(h);
            }
          }
        }
        const keys = new Set(cands.map(([, , h]) => h.key));
        const groups = new Set(cands.map(([hp, , h]) => `${hp}:${h.group}`));
        if (groups.size === 1) {
          target = cands[0]!;
          status = "resolved";
          x.key = target[2].key;
          x.kind = "case";
        } else if (keys.size) status = "ambiguous";
      } else if (x.short === "section") {
        const sec = x.fields["section"];
        const cands = history.filter(
          ([, , h]) => (h.kind === "usc" || h.kind === "state_statute") && h.form === "full" && h.fields["section"] === sec,
        );
        const keys = new Set(cands.map(([, , h]) => h.key));
        if (keys.size === 1) {
          target = cands[cands.length - 1]!;
          status = "resolved";
          x.key = target[2].key;
          x.kind = target[2].kind;
        } else if (keys.size) status = "ambiguous";
      } else if (x.short === "rule") {
        if (lastRuleSet) {
          status = "resolved";
          x.key = `rule:${lastRuleSet}:${x.fields["rule"]}`;
          x.kind = "federal_rule";
          x.fields["set"] = lastRuleSet;
        }
      }
      x.short_status = status;
      if (target) {
        const [tp, ti, tx] = target;
        const own = x.fields;
        if (x.short === "id" && own["section"]) {
          const base: Record<string, string> = {};
          for (const [k, v] of Object.entries(tx.fields)) if (!["section_end", "dash_joined", "et_seq"].includes(k)) base[k] = v;
          x.fields = { ...base, ...own };
        } else x.fields = { ...tx.fields, ...own };
        x.antecedent = single ? ti : { page: tp, index: ti };
        history.push([p, i, x]);
      }
    });
  }
}
