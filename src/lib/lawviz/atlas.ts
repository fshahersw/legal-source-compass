/**
 * Law atlas model (pure, isomorphic): parses the `lawviz_atlas_v1` RPC (database/contracts/lawviz-v1.sql), names and
 * links every node, and maps recency to the ordinal colour bins. Malformed tuples are dropped, never repaired.
 */
import { smartTitle } from "@/lib/external/usCode.functions";

export type AtlasCorpus = "usc" | "cfr";
export type AtlasKind =
  | "root"
  | "title"
  | "chapter"
  | "division"
  | "group"
  | "part"
  | "section"
  | "appendix"
  | "courtRule"
  | "reorganizationPlan"
  | "range";

export type AtlasNode = {
  id: string;
  parent: string | null;
  kind: AtlasKind;
  num: string | null;
  label: string;
  sections: number;
  chars: number;
  recorded: number;
  lastChange: string | null;
  medianYear: number | null;
  /** Direct children (for a range: the units it holds). */
  children: number;
  status: string | null;
  ord: number;
  /** A run of consecutive units the server grouped because the parent has too many to draw one by one. */
  range: { lo: number; hi: number; lastNum: string | null } | null;
};

export type AtlasView =
  | {
      status: "ok";
      corpus: AtlasCorpus;
      focus: AtlasNode;
      path: AtlasNode[];
      children: AtlasNode[];
      childrenTotal: number;
      binned: boolean;
      truncated: boolean;
      grandchildren: AtlasNode[];
      grandchildrenTotal: number;
      grandchildrenIncluded: boolean;
      range: [number, number] | null;
      builtAt: string | null;
      dropped: number;
    }
  | { status: "unavailable" | "empty" | "not_found" | "invalid"; builtAt: string | null };

const KINDS: AtlasKind[] = [
  "root",
  "title",
  "chapter",
  "division",
  "group",
  "part",
  "section",
  "appendix",
  "courtRule",
  "reorganizationPlan",
  "range",
];
const LEAF_KINDS = new Set<AtlasKind>(["section", "appendix", "courtRule", "reorganizationPlan"]);

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown, max = 400) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const nat = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Node ids exactly as the refresh writes them. */
const NODE_ID =
  /^(?:usc|cfr|usc\/(?:[1-9]|[1-4]\d|5[0-4])a?(?:\/c(?:\d{1,6}|_))?|cfr\/(?:[1-9]|[1-4]\d|50)(?:\/c\/[^/#]{1,40}|\/p\/[^/#]{1,60})?|(?:[1-9]|[1-4]\d|5[0-4])a?:[A-Za-z0-9][A-Za-z0-9._~+-]{0,119}|cfr:(?:[1-9]|[1-4]\d|50):[^#]{1,200})$/;
const RANGE_ID = /^(.+)#(\d{1,12})-(\d{1,12})$/;

export const isNodeId = (id: string) => NODE_ID.test(id);

/** One compact tuple (see lawviz.node_tuple) -> node, or null when anything is malformed. */
export function parseAtlasTuple(raw: unknown): AtlasNode | null {
  if (!Array.isArray(raw) || raw.length < 13) return null;
  const [
    id,
    parent,
    kind,
    num,
    label,
    sections,
    chars,
    recorded,
    last,
    median,
    children,
    status,
    ord,
  ] = raw as unknown[];
  const k =
    typeof kind === "string" && KINDS.includes(kind as AtlasKind) ? (kind as AtlasKind) : null;
  const sid = str(id, 300);
  if (!k || !sid) return null;
  const s = nat(sections);
  const c = nat(chars);
  const r = nat(recorded);
  const ch = nat(children);
  const o = typeof ord === "number" && Number.isSafeInteger(ord) ? ord : null;
  if (s === null || c === null || r === null || ch === null || o === null || r > s) return null;
  const lastChange = typeof last === "string" && ISO.test(last) ? last : null;
  const medianYear =
    typeof median === "number" && Number.isInteger(median) && median >= 1789 && median <= 2100
      ? median
      : null;
  if (r > 0 !== (lastChange !== null) || r > 0 !== (medianYear !== null)) return null;
  const par = parent === null ? null : str(parent, 300);
  if (parent !== null && !par) return null;
  let range: AtlasNode["range"] = null;
  if (k === "range") {
    const m = RANGE_ID.exec(sid);
    const hi = typeof raw[13] === "number" && Number.isSafeInteger(raw[13]) ? raw[13] : null;
    if (!m || m[1] !== par || Number(m[2]) !== o || hi === null || Number(m[3]) !== hi) return null;
    range = { lo: o, hi, lastNum: str(label, 120) };
  } else if (!NODE_ID.test(sid) || (par !== null && !NODE_ID.test(par))) return null;
  return {
    id: sid,
    parent: par,
    kind: k,
    num: str(num, 120),
    label: k === "range" ? "" : (str(label, 200) ?? "Not recorded"),
    sections: s,
    chars: c,
    recorded: r,
    lastChange,
    medianYear,
    children: ch,
    status: str(status, 40),
    ord: o,
    range,
  };
}

function tuples(v: unknown): { nodes: AtlasNode[]; dropped: number } {
  if (!Array.isArray(v)) return { nodes: [], dropped: 0 };
  const nodes: AtlasNode[] = [];
  let dropped = 0;
  for (const t of v) {
    const n = parseAtlasTuple(t);
    if (n) nodes.push(n);
    else dropped++;
  }
  return { nodes, dropped };
}

export function parseBuilt(v: unknown): string | null {
  const b = obj(v);
  const at = str(b?.["finished_at"], 40);
  return at && /^\d{4}-\d{2}-\d{2}/.test(at) ? at : null;
}

/** The RPC payload -> view. `null` (contract not applied yet) is "unavailable". */
export function parseAtlasView(raw: unknown, corpus: AtlasCorpus): AtlasView {
  const r = obj(raw);
  if (!r) return { status: "unavailable", builtAt: null };
  const status = r["status"];
  const builtAt = parseBuilt(r["built"]);
  if (status === "empty" || status === "not_found" || status === "invalid")
    return { status, builtAt };
  if (status !== "ok" || r["corpus"] !== corpus) return { status: "unavailable", builtAt };
  const focus = parseAtlasTuple(r["focus"]);
  if (!focus) return { status: "unavailable", builtAt };
  const path = tuples(r["path"]);
  const kids = tuples(r["children"]);
  const grand = tuples(r["grandchildren"]);
  const kidsOk = kids.nodes.filter((n) => n.parent === focus.id);
  const childIds = new Set(kidsOk.map((n) => n.id));
  const grandOk = grand.nodes.filter((n) => n.parent !== null && childIds.has(n.parent));
  const rg = Array.isArray(r["range"]) ? (r["range"] as unknown[]) : null;
  return {
    status: "ok",
    corpus,
    focus,
    path: path.nodes,
    children: kidsOk,
    childrenTotal: nat(r["children_total"]) ?? kidsOk.length,
    binned: r["binned"] === true,
    truncated: r["truncated"] === true,
    grandchildren: grandOk,
    grandchildrenTotal: nat(r["grandchildren_total"]) ?? grandOk.length,
    grandchildrenIncluded: r["grandchildren_included"] === true,
    range: rg && typeof rg[0] === "number" && typeof rg[1] === "number" ? [rg[0], rg[1]] : null,
    builtAt,
    dropped:
      path.dropped +
      kids.dropped +
      grand.dropped +
      (kids.nodes.length - kidsOk.length) +
      (grand.nodes.length - grandOk.length),
  };
}

export const isLeaf = (n: AtlasNode) => LEAF_KINDS.has(n.kind);

const tidy = (s: string) => s.replace(/^[\s—–-]+/, "").trim();
/** OLRC prints chapter designations and headings in capitals; CFR text is already mixed case. */
const cased = (corpus: AtlasCorpus, s: string) => (corpus === "usc" ? smartTitle(s) : s);

/** The short name drawn inside a cell ("Title 42", "Chapter 21", "Part 101", "§ 1983"). */
export function shortName(corpus: AtlasCorpus, n: AtlasNode): string {
  if (n.kind === "range") return `${n.num ?? "?"} – ${n.range?.lastNum ?? "?"}`;
  if (n.kind === "root" || n.kind === "group") return n.label;
  if (n.num) return cased(corpus, n.num);
  return cased(corpus, tidy(n.label)) || "Not recorded";
}

/** The full name for tooltips, tables and the detail strip. */
export function fullName(corpus: AtlasCorpus, n: AtlasNode): string {
  if (n.kind === "range")
    return `${shortName(corpus, n)} (${n.children.toLocaleString("en-US")} ${corpus === "usc" ? "sections" : "sections and appendices"})`;
  if (n.kind === "root" || n.kind === "group") return n.label;
  const label = tidy(n.label);
  const head = n.num ? cased(corpus, n.num) : "";
  const body = label ? cased(corpus, label) : "";
  return head && body ? `${head} · ${body}` : head || body || "Not recorded";
}

/** Title key of a node ("42", "5a" for the U.S. Code; "21" for the CFR). */
export function titleOf(corpus: AtlasCorpus, id: string): string | null {
  if (corpus === "usc") {
    const m =
      /^usc\/((?:[1-9]|[1-4]\d|5[0-4])a?)(?:\/|$)/.exec(id) ??
      /^((?:[1-9]|[1-4]\d|5[0-4])a?):/.exec(id);
    return m ? m[1]! : null;
  }
  const m =
    /^cfr\/((?:[1-9]|[1-4]\d|50))(?:\/|$)/.exec(id) ?? /^cfr:((?:[1-9]|[1-4]\d|50)):/.exec(id);
  return m ? m[1]! : null;
}

export type AtlasLink =
  | { to: "/law/uscode/$title"; params: { title: string }; search: { q?: undefined; c?: number } }
  | { to: "/law/uscode/$title/$section"; params: { title: string; section: string } }
  | { to: "/law/cfr/$title"; params: { title: string } }
  | { to: "/law/cfr/$title/part/$part"; params: { title: string; part: string } }
  | {
      to: "/law/cfr/$title/$section";
      params: { title: string; section: string };
      search: { part?: string };
    };

/** The existing page a node opens (null for the root and for a range, which open in the atlas itself). */
export function nodeLink(corpus: AtlasCorpus, n: AtlasNode): AtlasLink | null {
  if (n.kind === "root" || n.kind === "range") return null;
  const t = titleOf(corpus, n.id);
  if (!t) return null;
  if (corpus === "usc") {
    if (isLeaf(n)) {
      const key = n.id.slice(t.length + 1);
      return { to: "/law/uscode/$title/$section", params: { title: t, section: key } };
    }
    const c = /\/c(\d{1,6})$/.exec(n.id);
    return {
      to: "/law/uscode/$title",
      params: { title: t },
      search: c ? { c: Number(c[1]) } : {},
    };
  }
  if (isLeaf(n)) {
    const rest = n.id.slice(`cfr:${t}:`.length);
    const at = rest.indexOf("@part-");
    const section = at >= 0 ? rest.slice(0, at) : rest;
    const part = at >= 0 ? rest.slice(at + 6) : undefined;
    return {
      to: "/law/cfr/$title/$section",
      params: { title: t, section },
      search: part ? { part } : {},
    };
  }
  const p = /\/p\/(.+)$/.exec(n.id);
  // "_<chapter>" groups units printed outside any part: there is no part page to open.
  if (p && !p[1]!.startsWith("_"))
    return { to: "/law/cfr/$title/part/$part", params: { title: t, part: p[1]! } };
  return { to: "/law/cfr/$title", params: { title: t } };
}

/** Plain href of a node link (for the data table and tests). */
export function linkHref(l: AtlasLink | null): string | null {
  if (!l) return null;
  const enc = encodeURIComponent;
  switch (l.to) {
    case "/law/uscode/$title":
      return `/law/uscode/${enc(l.params.title)}${l.search.c !== undefined ? `?c=${l.search.c}` : ""}`;
    case "/law/uscode/$title/$section":
      return `/law/uscode/${enc(l.params.title)}/${enc(l.params.section)}`;
    case "/law/cfr/$title":
      return `/law/cfr/${enc(l.params.title)}`;
    case "/law/cfr/$title/part/$part":
      return `/law/cfr/${enc(l.params.title)}/part/${enc(l.params.part)}`;
    case "/law/cfr/$title/$section":
      return `/law/cfr/${enc(l.params.title)}/${enc(l.params.section)}${l.search.part ? `?part=${enc(l.search.part)}` : ""}`;
  }
}

// ------------------------------------------------------------------------------------------------ recency bins
export type RecencyBin = { label: string; from: number; to: number };

/**
 * Six ordinal bins per corpus (one-hue ramp, validated light → dark with the dataviz ordinal checks). U.S. Code: the
 * year of the latest law OLRC cites as enacting or amending the section. CFR: the year of the latest version the eCFR
 * lists (the versioner starts on 2017-01-03; an earlier year is the date of the version in force then).
 */
export const RECENCY_BINS: Record<AtlasCorpus, RecencyBin[]> = {
  usc: [
    { label: "1970 or earlier", from: 1789, to: 1970 },
    { label: "1971–1990", from: 1971, to: 1990 },
    { label: "1991–2000", from: 1991, to: 2000 },
    { label: "2001–2010", from: 2001, to: 2010 },
    { label: "2011–2020", from: 2011, to: 2020 },
    { label: "2021 or later", from: 2021, to: 2100 },
  ],
  cfr: [
    { label: "2016 or earlier", from: 1789, to: 2016 },
    { label: "2017–2018", from: 2017, to: 2018 },
    { label: "2019–2020", from: 2019, to: 2020 },
    { label: "2021–2022", from: 2021, to: 2022 },
    { label: "2023–2024", from: 2023, to: 2024 },
    { label: "2025 or later", from: 2025, to: 2100 },
  ],
};

export function recencyBin(corpus: AtlasCorpus, year: number | null): number | null {
  if (year === null) return null;
  const i = RECENCY_BINS[corpus].findIndex((b) => year >= b.from && year <= b.to);
  return i >= 0 ? i : null;
}

export type SizeBy = "sections" | "chars";
export const sizeOf = (n: AtlasNode, by: SizeBy) => (by === "chars" ? n.chars : n.sections);

/** What the corpus calls its leaves, for counts in prose. */
export const UNIT_WORD: Record<AtlasCorpus, [string, string]> = {
  usc: ["section", "sections"],
  cfr: ["section or appendix", "sections and appendices"],
};

/** Child noun of a node kind ("chapters", "parts", ...), for "open to see 150 chapters". */
export function childNoun(corpus: AtlasCorpus, n: AtlasNode): string {
  switch (n.kind) {
    case "root":
      return "titles";
    case "title":
      return "chapters";
    case "chapter":
    case "division":
    case "group":
      return corpus === "usc" || n.id.includes("/p/") ? UNIT_WORD[corpus][1] : "parts";
    case "part":
    case "range":
      return UNIT_WORD[corpus][1];
    default:
      return "items";
  }
}
