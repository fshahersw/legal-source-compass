/**
 * Pure helpers for the statute <-> regulation links (datasets ecfr_parallel_authorities, ecfr_subject_index and
 * ecfr_agencies, built by scripts/enrichment/ecfr_authorities/). Server functions live in ecfrAuthorities.functions.ts;
 * everything here is isomorphic and tested without the network.
 *
 * A row of ecfr_parallel_authorities is one authority and one CFR title group exactly as the Parallel Table of
 * Authorities and Rules prints it. Malformed stored values are dropped, never repaired. A link is only ever made on an
 * exact title + section (U.S. Code) or exact title + part (CFR) key; "et seq." and ranges are shown as printed and are
 * never expanded.
 */
import { CFR_TITLE, partRecordId } from "./ecfrFull";

export const AUTHORITIES_DATASET = "ecfr_parallel_authorities";

/** Select for one authority row: the structured block is aliased to `p`. */
export const AUTHORITY_SELECT = "select=id,source_url,p:detail->ptoa";

export type AuthorityCategory = "usc" | "stat" | "publaw" | "presidential";
export type AuthorityLinkState =
  | "resolved"
  | "resolved_note"
  | "not_in_stored_code"
  | "et_seq"
  | "range"
  | "other_form"
  | "not_applicable";

export const CATEGORY_LABEL: Record<AuthorityCategory, string> = {
  usc: "U.S. Code",
  stat: "Statutes at Large",
  publaw: "Public laws",
  presidential: "Presidential documents",
};

const CATEGORIES = Object.keys(CATEGORY_LABEL) as AuthorityCategory[];
const STATES: AuthorityLinkState[] = [
  "resolved",
  "resolved_note",
  "not_in_stored_code",
  "et_seq",
  "range",
  "other_form",
  "not_applicable",
];

/** Part designations as the eCFR prints them: "314", "15F", "101-6", "60-4". */
export const PART_TOKEN = /^[0-9][0-9A-Za-z]{0,7}(?:-[0-9A-Za-z]{1,8})?$/;
const USC_TITLE = /^(?:[1-9]|[1-4][0-9]|5[0-4])a?$/;
const USC_KEY_SAFE = /^[A-Za-z0-9][A-Za-z0-9._~+-]{0,119}$/;

export type AuthorityLink = {
  state: AuthorityLinkState;
  /** Stored section id ("42:1395hh"), only for resolved / resolved_note. */
  id: string | null;
  title: string | null;
  key: string | null;
  start: string | null;
  end: string | null;
  startStored: boolean | null;
  endStored: boolean | null;
  reason: string | null;
};

export type AuthorityRow = {
  id: string;
  category: AuthorityCategory;
  /** The heading it is printed under ("42 U.S.C.", "106 Stat.", "Public Laws", "Executive Orders:"). */
  heading: string;
  /** The authority as printed ("1395hh", "301 et seq.", "301--303"). */
  authority: string;
  /** Display citation composed from heading + authority ("42 U.S.C. 1395hh"). */
  citation: string;
  sub: string | null;
  variant: string | null;
  page: number | null;
  edition: string;
  link: AuthorityLink;
  cfr: {
    title: number;
    label: string;
    partsText: string;
    parts: string[];
    partsStored: string[];
    partRanges: string[];
    unparsed: string[];
  };
  sourceUrl: string | null;
  leaderMissing: boolean;
};

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const str = (v: unknown, max = 2000) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const nat = (v: unknown, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
const strings = (v: unknown, ok: (s: string) => boolean, max = 400): string[] | null => {
  const a = arr(v);
  if (a.length > max) return null;
  const out: string[] = [];
  for (const x of a) {
    if (typeof x !== "string" || !ok(x)) return null;
    out.push(x);
  }
  return out;
};

export function parseAuthorityLink(raw: unknown): AuthorityLink | null {
  const l = obj(raw);
  const state = l?.["state"];
  if (!l || typeof state !== "string" || !STATES.includes(state as AuthorityLinkState)) return null;
  const title = str(l["title"], 4);
  const key = str(l["key"], 120);
  const id = str(l["id"], 140);
  if (title && !USC_TITLE.test(title)) return null;
  if (key && !USC_KEY_SAFE.test(key)) return null;
  const linked = state === "resolved" || state === "resolved_note";
  // A link is only trusted when its id is exactly "<title>:<key>".
  if (linked && (!title || !key || id !== `${title}:${key}`)) return null;
  return {
    state: state as AuthorityLinkState,
    id: linked ? id : null,
    title,
    key,
    start: str(l["start"], 120),
    end: str(l["end"], 120),
    startStored: typeof l["start_stored"] === "boolean" ? l["start_stored"] : null,
    endStored: typeof l["end_stored"] === "boolean" ? l["end_stored"] : null,
    reason: str(l["reason"], 300),
  };
}

/** One stored row (`id`, `source_url`, `p` = detail.ptoa) -> typed row, or null when anything is malformed. */
export function parseAuthorityRow(raw: unknown): AuthorityRow | null {
  const r = obj(raw);
  const p = obj(r?.["p"]);
  const id = str(r?.["id"], 300);
  if (!r || !p || !id) return null;
  const category = p["category"];
  if (typeof category !== "string" || !CATEGORIES.includes(category as AuthorityCategory))
    return null;
  const heading = str(p["heading"], 80);
  const authority = str(p["authority"], 160);
  const citation = str(p["citation"], 240);
  const edition = str(p["edition"], 8);
  const link = parseAuthorityLink(p["link"]);
  const c = obj(p["cfr"]);
  if (!heading || !authority || !citation || !edition || !link || !c) return null;
  const title = nat(c["title"], 50);
  const parts = strings(c["parts"], (s) => PART_TOKEN.test(s));
  const partsStored = strings(c["parts_stored"], (s) => PART_TOKEN.test(s));
  const partRanges = strings(c["part_ranges"], (s) => s.length <= 40, 40);
  const unparsed = strings(c["unparsed"], (s) => s.length <= 80, 40);
  const partsText = str(c["parts_text"], 4000);
  if (
    title === null ||
    !CFR_TITLE.test(String(title)) ||
    !parts ||
    !partsStored ||
    !partRanges ||
    !unparsed ||
    !partsText ||
    partsStored.some((s) => !parts.includes(s))
  )
    return null;
  const src = str(r["source_url"], 600);
  return {
    id,
    category: category as AuthorityCategory,
    heading,
    authority,
    citation,
    sub: str(p["sub"], 60),
    variant: str(p["variant"], 20),
    page: nat(p["page"], 100000),
    edition,
    link,
    cfr: {
      title,
      label: str(c["label"], 10) ?? "Parts",
      partsText,
      parts,
      partsStored,
      partRanges,
      unparsed,
    },
    sourceUrl: src && src.startsWith("https://www.govinfo.gov/") ? src : null,
    leaderMissing: p["leader_missing"] === true,
  };
}

export function parseAuthorityRows(raw: unknown): { rows: AuthorityRow[]; dropped: number } {
  const list = arr(raw);
  const rows = list.map(parseAuthorityRow);
  return {
    rows: rows.filter((x): x is AuthorityRow => x !== null),
    dropped: rows.filter((x) => x === null).length,
  };
}

/** Ids of the stored CFR part records for a set of "title:part" keys, without duplicates, in first-seen order. */
export function partIds(keys: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const [t, ...rest] = k.split(":");
    const part = rest.join(":");
    if (!t || !CFR_TITLE.test(t) || !PART_TOKEN.test(part)) continue;
    const id = partRecordId(t, part);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** "21 CFR Part 314—Applications for FDA Approval…" -> "Applications for FDA Approval…" (the stored part title minus the citation it repeats). */
export function partHeading(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = /^\d{1,2} CFR Part [^—]+—\s*(.+)$/.exec(title);
  return (m?.[1] ?? title).trim() || null;
}

export type CfrTitleParts = {
  cfrTitle: number;
  /** Parts in first-printed order, without duplicates. */
  parts: { part: string; stored: boolean }[];
  /** Printed part ranges and tokens that did not parse, as published. */
  ranges: string[];
  unparsed: string[];
  pages: number[];
};

/** Merge rows of one authority group into one list per CFR title (a section printed twice lists its parts once). */
export function mergeByCfrTitle(rows: AuthorityRow[]): CfrTitleParts[] {
  const by = new Map<number, CfrTitleParts>();
  for (const r of rows) {
    let g = by.get(r.cfr.title);
    if (!g) {
      g = { cfrTitle: r.cfr.title, parts: [], ranges: [], unparsed: [], pages: [] };
      by.set(r.cfr.title, g);
    }
    for (const p of r.cfr.parts)
      if (!g.parts.some((x) => x.part === p))
        g.parts.push({ part: p, stored: r.cfr.partsStored.includes(p) });
    for (const x of r.cfr.partRanges) if (!g.ranges.includes(x)) g.ranges.push(x);
    for (const x of r.cfr.unparsed) if (!g.unparsed.includes(x)) g.unparsed.push(x);
    if (r.page !== null && !g.pages.includes(r.page)) g.pages.push(r.page);
  }
  return [...by.values()].sort((a, b) => a.cfrTitle - b.cfrTitle);
}

export type AuthorityGroupKey = "usc" | "usc_edge" | "stat" | "publaw" | "presidential";
export type MergedAuthority = {
  key: string;
  category: AuthorityCategory;
  citation: string;
  authority: string;
  link: AuthorityLink;
  pages: number[];
  sub: string | null;
  /** The CFR title groups of this authority that contain the part (usually one). */
  cfrTitles: number[];
};

/** One entry per printed authority (a repeated authority is listed once with its pages), in table order. */
export function mergeAuthorities(rows: AuthorityRow[]): MergedAuthority[] {
  const out: MergedAuthority[] = [];
  const idx = new Map<string, MergedAuthority>();
  for (const r of rows) {
    const key = `${r.category}|${r.heading}|${r.authority}`;
    let m = idx.get(key);
    if (!m) {
      m = {
        key,
        category: r.category,
        citation: r.citation,
        authority: r.authority,
        link: r.link,
        pages: [],
        sub: r.sub,
        cfrTitles: [],
      };
      idx.set(key, m);
      out.push(m);
    }
    if (r.page !== null && !m.pages.includes(r.page)) m.pages.push(r.page);
    if (!m.cfrTitles.includes(r.cfr.title)) m.cfrTitles.push(r.cfr.title);
  }
  return out;
}

export type AuthoritySections = {
  /** U.S. Code authorities that name one section (exact, or the note to it). */
  statutes: MergedAuthority[];
  /** Ranges, "et seq." and other U.S. Code forms, as printed. */
  rangesAndOther: MergedAuthority[];
  statutesAtLarge: MergedAuthority[];
  publicLaws: MergedAuthority[];
  presidential: MergedAuthority[];
};

export function sectionAuthorities(merged: MergedAuthority[]): AuthoritySections {
  const named = (m: MergedAuthority) =>
    m.link.state === "resolved" ||
    m.link.state === "resolved_note" ||
    (m.category === "usc" && m.link.state === "not_in_stored_code");
  return {
    statutes: merged.filter((m) => m.category === "usc" && named(m)),
    rangesAndOther: merged.filter((m) => m.category === "usc" && !named(m)),
    statutesAtLarge: merged.filter((m) => m.category === "stat"),
    publicLaws: merged.filter((m) => m.category === "publaw"),
    presidential: merged.filter((m) => m.category === "presidential"),
  };
}

export function linkStateLabel(l: AuthorityLink): string {
  switch (l.state) {
    case "resolved":
      return "Section in the stored Code";
    case "resolved_note":
      return "Note to a section in the stored Code";
    case "not_in_stored_code":
      return "Not in the stored Code";
    case "et_seq":
      return "“et seq.”, as printed";
    case "range":
      return "Range, as printed";
    case "other_form":
      return "Other form, as printed";
    default:
      return "Not a U.S. Code authority";
  }
}

/** The U.S. Code section id a page asks for, or null when the title or key could not be a stored unit. */
export function sectionKeyId(title: string, key: string): string | null {
  return USC_TITLE.test(title) && USC_KEY_SAFE.test(key) ? `${title}:${key}` : null;
}

/** "cfr:42:part-405" ids for a PostgREST in() list; each id is quoted. */
export const inList = (ids: string[]) =>
  `in.(${ids.map((i) => `"${i.replace(/"/g, "")}"`).join(",")})`;

export type TableMeta = {
  edition: string | null;
  revisedAsOf: string | null;
  retrievedAt: string | null;
};

/** Edition facts from the dataset's catalog summary (null parts when absent). */
export function parseTableMeta(metadata: unknown): TableMeta {
  const s = obj(obj(metadata)?.["summary"]);
  const rv = str(s?.["table_revised_as_of"], 40);
  return {
    edition: str(s?.["edition"], 8),
    revisedAsOf: rv,
    retrievedAt: str(s?.["retrieved_at"], 40),
  };
}

/** "CFR Index and Finding Aids 2025, revised as of January 1, 2025": what the table is and how current it is. */
export function tableEdition(meta: TableMeta): string {
  if (!meta.edition) return "Parallel Table of Authorities and Rules";
  return `CFR Index and Finding Aids ${meta.edition}${meta.revisedAsOf ? `, revised as of ${meta.revisedAsOf}` : ""}`;
}
