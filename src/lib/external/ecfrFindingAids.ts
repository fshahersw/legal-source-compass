/**
 * Pure helpers for the eCFR agency list (ecfr_agencies) and the CFR Subject/Agency Index (ecfr_subject_index), built by
 * scripts/enrichment/ecfr_authorities/. Server functions live in ecfrAuthorities.functions.ts. Malformed stored values are
 * dropped, never repaired; a reference is matched only on exact CFR title + part.
 */
import { PART_TOKEN } from "./ecfrAuthorities";

export const AGENCIES_DATASET = "ecfr_agencies";
export const SUBJECTS_DATASET = "ecfr_subject_index";
export const AGENCY_SELECT = "select=id,a:detail->agency,x:detail->prepared_index";
export const SUBJECT_SELECT = "select=id,s:detail->subject";

const SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const str = (v: unknown, max = 2000) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const nat = (v: unknown, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;

export type CfrReference = {
  title: number | null;
  subtitle: string | null;
  chapter: string | null;
  subchapter: string | null;
  part: string | null;
};
export type AgencyNode = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  displayName: string | null;
  sortableName: string | null;
  parent: string | null;
  children: { slug: string; name: string }[];
  references: CfrReference[];
  /** Atlas agency profile id, only when the eCFR slug equals exactly one Federal Register agency slug. */
  profileId: string | null;
  order: number;
};
export type PreparedIndex = {
  id: string;
  cfrTitle: number;
  scope: string;
  indexesPrinted: string | null;
  agencyAsPrinted: string | null;
  linkedAgency: string | null;
};

const reference = (raw: unknown): CfrReference | null => {
  const r = obj(raw);
  if (!r) return null;
  const hasTitle = r["title"] !== null && r["title"] !== undefined;
  const title = hasTitle ? nat(r["title"], 50) : null;
  if (hasTitle && title === null) return null;
  return {
    title,
    subtitle: str(r["subtitle"], 20),
    chapter: str(r["chapter"], 20),
    subchapter: str(r["subchapter"], 20),
    part: str(r["part"], 20),
  };
};

export function parseAgencyRow(raw: unknown): AgencyNode | null {
  const r = obj(raw);
  const a = obj(r?.["a"]);
  const id = str(r?.["id"], 200);
  const slug = str(a?.["slug"], 121);
  const name = str(a?.["name"], 300);
  if (!r || !a || !id || !slug || !SLUG.test(slug) || !name || id !== `agency:${slug}`) return null;
  const refs = arr(a["cfr_references"]).map(reference);
  if (refs.some((x) => x === null)) return null;
  const kids: { slug: string; name: string }[] = [];
  for (const c of arr(a["children"])) {
    const k = obj(c);
    const ks = str(k?.["slug"], 121);
    const kn = str(k?.["name"], 300);
    if (!ks || !SLUG.test(ks) || !kn) return null;
    kids.push({ slug: ks, name: kn });
  }
  const parent = str(a["parent"], 121);
  if (parent && !SLUG.test(parent)) return null;
  const profile = str(a["fr_agency_id"], 8);
  return {
    id,
    slug,
    name,
    shortName: str(a["short_name"], 80),
    displayName: str(a["display_name"], 400),
    sortableName: str(a["sortable_name"], 400),
    parent,
    children: kids,
    references: refs as CfrReference[],
    profileId: profile && /^\d{1,6}$/.test(profile) ? profile : null,
    order: nat(a["order"], 10000) ?? 0,
  };
}

export function parsePreparedRow(raw: unknown): PreparedIndex | null {
  const r = obj(raw);
  const x = obj(r?.["x"]);
  const id = str(r?.["id"], 100);
  const title = nat(x?.["cfr_title"], 50);
  if (!r || !x || !id || title === null || !id.startsWith("prepared-index:")) return null;
  const linked = str(x["linked_agency"], 121);
  return {
    id,
    cfrTitle: title,
    scope: str(x["scope"], 300) ?? "",
    indexesPrinted: str(x["indexes_printed"], 40),
    agencyAsPrinted: str(x["agency_as_printed"], 600),
    linkedAgency: linked && SLUG.test(linked) ? linked : null,
  };
}

/** "Title 21, Chapter I" from one published reference; only the keys the eCFR printed. */
export function referenceLabel(r: CfrReference): string {
  const parts: string[] = [];
  if (r.title !== null) parts.push(`Title ${r.title}`);
  if (r.subtitle) parts.push(`Subtitle ${r.subtitle}`);
  if (r.chapter) parts.push(`Chapter ${r.chapter}`);
  if (r.subchapter) parts.push(`Subchapter ${r.subchapter}`);
  if (r.part) parts.push(`Part ${r.part}`);
  return parts.join(", ");
}

export type AgencyTree = { node: AgencyNode; children: AgencyNode[] };

/** Top-level agencies in the eCFR's own order, each with its child agencies (a child is never merged into its parent). */
export function agencyTree(nodes: AgencyNode[]): AgencyTree[] {
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  const tops = nodes.filter((n) => !n.parent || !bySlug.has(n.parent));
  return [...tops]
    .sort((a, b) => a.order - b.order)
    .map((node) => ({
      node,
      children: node.children
        .map((c) => bySlug.get(c.slug))
        .filter((c): c is AgencyNode => !!c)
        .sort((a, b) => a.order - b.order),
    }));
}

/** Title numbers an agency's references name, ascending, without duplicates. */
export function referencedTitles(n: AgencyNode): number[] {
  return [...new Set(n.references.map((r) => r.title).filter((t): t is number => t !== null))].sort(
    (a, b) => a - b,
  );
}

/** Case-insensitive match on name, short name, display name or slug; an empty query matches everything. */
export function agencyMatches(n: AgencyNode, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [n.name, n.shortName, n.displayName, n.slug].some(
    (x) => !!x && x.toLowerCase().includes(s),
  );
}

// ---------------------------------------------------------------------------------------------------------------
export type SubjectEntry = { level: number; text: string; xref: boolean; refs: [number, string][] };
export type SubjectRow = {
  id: string;
  heading: string;
  segment: { index: number; of: number };
  pages: [number, number] | null;
  entries: SubjectEntry[];
};

export function parseSubjectRow(raw: unknown): SubjectRow | null {
  const r = obj(raw);
  const s = obj(r?.["s"]);
  const id = str(r?.["id"], 300);
  const heading = str(s?.["heading"], 300);
  const seg = obj(s?.["segment"]);
  const index = nat(seg?.["index"], 500);
  const of = nat(seg?.["of"], 500);
  if (!r || !s || !id || !heading || index === null || of === null) return null;
  const entries: SubjectEntry[] = [];
  for (const e of arr(s["entries"])) {
    const o = obj(e);
    const text = str(o?.["t"], 2000);
    const level = nat(o?.["l"], 12);
    if (!o || !text || level === null) return null;
    const refs: [number, string][] = [];
    for (const x of arr(o["r"])) {
      const a = arr(x);
      const t = nat(a[0], 50);
      if (t === null || typeof a[1] !== "string" || !PART_TOKEN.test(a[1])) return null;
      refs.push([t, a[1]]);
    }
    entries.push({ level, text, xref: o["x"] === 1, refs });
  }
  const pg = arr(s["pages"]);
  const p0 = nat(pg[0], 100000);
  const p1 = nat(pg[1], 100000);
  return {
    id,
    heading,
    segment: { index, of },
    pages: p0 !== null && p1 !== null ? [p0, p1] : null,
    entries,
  };
}

export type SubjectMatch = SubjectEntry & { context: string[] };

/**
 * The entries of a heading that carry exactly this CFR title + part reference (never a nearby part or a title-only match),
 * each with the printed lines above it that it hangs under (an entry at level 2 is read under its level 1 and level 0 lines;
 * cross-reference lines are not context).
 */
export function entriesForPart(row: SubjectRow, title: number, part: string): SubjectMatch[] {
  const out: SubjectMatch[] = [];
  const stack: { level: number; text: string }[] = [];
  for (const e of row.entries) {
    if (e.xref) continue;
    while (stack.length && stack[stack.length - 1]!.level >= e.level) stack.pop();
    if (e.refs.some(([t, p]) => t === title && p === part))
      out.push({ ...e, context: stack.map((x) => x.text) });
    stack.push({ level: e.level, text: e.text });
  }
  return out;
}
