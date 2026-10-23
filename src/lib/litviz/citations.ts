/**
 * Citation map shapes and the adapter seam. Every view reads through a `CitationAdapter`: today the litviz/1 RPCs
 * (documents.links precomputed by litviz_refresh_v1); when worker CITE's citations v2 RPCs are applied, the lead adds
 * an adapter for them at the front of CITATION_ADAPTERS and nothing else changes. Pure and client-safe.
 *
 * A citation counted here is a resolved, exact-id citation in the text of an open filing; it says the filing cites
 * the authority, never anything about MDL membership.
 */
import { linkTarget } from "@/lib/documents/documents";

export type AuthorityClass =
  "scotus" | "federal_appellate" | "state_high" | "other_court" | "usc" | "cfr";

/** Grid clusters, in display order. */
export const CLASS_ORDER: AuthorityClass[] = [
  "scotus",
  "federal_appellate",
  "state_high",
  "other_court",
  "usc",
  "cfr",
];
export const CLASS_LABEL: Record<AuthorityClass, string> = {
  scotus: "Supreme Court",
  federal_appellate: "Federal courts of appeals",
  state_high: "State high courts",
  other_court: "Other courts",
  usc: "U.S. Code",
  cfr: "Code of Federal Regulations",
};

export type Authority = {
  /** "<to_type>|<to_id>", e.g. "record|caselaw/112903", "law_unit|usc:28:1407". */
  key: string;
  toType: "record" | "law_unit";
  toId: string;
  kind: "case" | "usc" | "cfr";
  class: AuthorityClass;
  label: string;
  cite: string | null;
  heading: string | null;
  courtLabel: string | null;
  year: number | null;
  href: string | null;
};

export type MdlCitationMeta = {
  filings: number;
  withText: number;
  citing: number;
  citesUnresolved: number;
  citesAmbiguous: number;
};

export type CitationMap = {
  mdl: string;
  refreshed: string | null;
  meta: MdlCitationMeta | null;
  /** Distinct authorities the MDL's filings cite (the map shows the top ones). */
  distinct: number;
  authorities: (Authority & { filings: number; mentions: number })[];
  /** [authority key, authority key, filings citing both]. */
  edges: [string, string, number][];
};

export type CitationGrid = {
  refreshed: string | null;
  mdls: {
    mdl: string;
    title: string | null;
    filings: number | null;
    withText: number | null;
    citing: number | null;
  }[];
  authorities: (Authority & { filings: number })[];
  /** [authority key, mdl, filings citing]. */
  cells: [string, string, number][];
};

export type FilingCitations = {
  document: string;
  mdl: string;
  textStatus: string;
  refreshed: string | null;
  mdlCiting: number | null;
  authorities: (Authority & {
    mentions: number;
    firstPage: number | null;
    mdlFilings: number | null;
    allFilings: number | null;
  })[];
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
};
const CLASSES = new Set<string>(CLASS_ORDER);
const KEY = /^(record|law_unit)\|([A-Za-z0-9:/._-]{1,120})$/;

/** Where an authority's page is in the app, from its exact id (the same mapping the filing viewer uses). */
export function authorityHref(toType: string, toId: string): string | null {
  if (toType !== "record" && toType !== "law_unit") return null;
  return linkTarget({ toType, toId }).href;
}

function parseAuthority(raw: unknown): Authority | null {
  const o = obj(raw);
  const key = text(o?.["key"]);
  const m = key ? KEY.exec(key) : null;
  if (!o || !m) return null;
  const toType = m[1] as Authority["toType"];
  const toId = m[2]!;
  const kind =
    o["kind"] === "usc" || o["kind"] === "cfr" || o["kind"] === "case" ? o["kind"] : null;
  const cls = text(o["class"]);
  const year = int(o["year"]);
  return {
    key: key!,
    toType,
    toId,
    kind: kind ?? (toType === "record" ? "case" : toId.startsWith("cfr:") ? "cfr" : "usc"),
    class: cls && CLASSES.has(cls) ? (cls as AuthorityClass) : "other_court",
    label: text(o["label"]) ?? toId,
    cite: text(o["cite"]),
    heading: text(o["heading"]),
    courtLabel: text(o["court_label"]),
    year: year !== null && year > 1700 && year < 2200 ? year : null,
    href: authorityHref(toType, toId),
  };
}

function parseMeta(raw: unknown): MdlCitationMeta | null {
  const o = obj(raw);
  if (!o) return null;
  return {
    filings: int(o["filings"]) ?? 0,
    withText: int(o["with_text"]) ?? 0,
    citing: int(o["citing"]) ?? 0,
    citesUnresolved: int(o["cites_unresolved"]) ?? 0,
    citesAmbiguous: int(o["cites_ambiguous"]) ?? 0,
  };
}

export function parseCitationMap(raw: unknown): CitationMap | null {
  const o = obj(raw);
  const mdl = text(o?.["mdl"]);
  if (!o || !mdl || !Array.isArray(o["authorities"])) return null;
  const authorities = (o["authorities"] as unknown[]).flatMap((a) => {
    const p = parseAuthority(a);
    const filings = int(obj(a)?.["filings"]);
    return p && filings !== null
      ? [{ ...p, filings, mentions: int(obj(a)?.["mentions"]) ?? filings }]
      : [];
  });
  const keys = new Set(authorities.map((a) => a.key));
  const edges = (Array.isArray(o["edges"]) ? (o["edges"] as unknown[]) : []).flatMap(
    (e): [string, string, number][] =>
      Array.isArray(e) &&
      typeof e[0] === "string" &&
      typeof e[1] === "string" &&
      keys.has(e[0]) &&
      keys.has(e[1]) &&
      int(e[2]) !== null
        ? [[e[0], e[1], int(e[2])!]]
        : [],
  );
  return {
    mdl,
    refreshed: text(o["refreshed"]),
    meta: parseMeta(o["meta"]),
    distinct: int(o["distinct_authorities"]) ?? authorities.length,
    authorities,
    edges,
  };
}

export function parseCitationGrid(raw: unknown): CitationGrid | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o["mdls"]) || !Array.isArray(o["authorities"])) return null;
  const mdls = (o["mdls"] as unknown[]).flatMap((m) => {
    const x = obj(m);
    const id = text(x?.["mdl"]);
    return x && id && /^[1-9][0-9]{0,5}$/.test(id)
      ? [
          {
            mdl: id,
            title: text(x["title"]),
            filings: int(x["filings"]),
            withText: int(x["with_text"]),
            citing: int(x["citing"]),
          },
        ]
      : [];
  });
  const authorities = (o["authorities"] as unknown[]).flatMap((a) => {
    const p = parseAuthority(a);
    const filings = int(obj(a)?.["filings"]);
    return p && filings !== null ? [{ ...p, filings }] : [];
  });
  const keys = new Set(authorities.map((a) => a.key));
  const ids = new Set(mdls.map((m) => m.mdl));
  const cells = (Array.isArray(o["cells"]) ? (o["cells"] as unknown[]) : []).flatMap(
    (c): [string, string, number][] =>
      Array.isArray(c) && keys.has(c[0] as string) && ids.has(c[1] as string) && int(c[2]) !== null
        ? [[c[0] as string, c[1] as string, int(c[2])!]]
        : [],
  );
  return { refreshed: text(o["refreshed"]), mdls, authorities, cells };
}

export function parseFilingCitations(raw: unknown): FilingCitations | null {
  const o = obj(raw);
  const document = text(o?.["document"]);
  const mdl = text(o?.["mdl"]);
  if (!o || !document || !mdl || !Array.isArray(o["authorities"])) return null;
  return {
    document,
    mdl,
    textStatus: text(o["text_status"]) ?? "not_recorded",
    refreshed: text(o["refreshed"]),
    mdlCiting: int(o["mdl_citing"]),
    authorities: (o["authorities"] as unknown[]).flatMap((a) => {
      const p = parseAuthority(a);
      const x = obj(a);
      const mentions = int(x?.["mentions"]);
      return p && mentions !== null
        ? [
            {
              ...p,
              mentions,
              firstPage: int(x?.["first_page"]),
              mdlFilings: int(x?.["mdl_filings"]),
              allFilings: int(x?.["all_filings"]),
            },
          ]
        : [];
    }),
  };
}

/** Authorities grouped into the grid's clusters (class order), each cluster by filings citing, then label. */
export function clusterAuthorities<T extends Authority & { filings: number }>(
  list: readonly T[],
): {
  cls: AuthorityClass;
  items: T[];
}[] {
  return CLASS_ORDER.map((cls) => ({
    cls,
    items: list
      .filter((a) => a.class === cls)
      .sort((a, b) => b.filings - a.filings || a.label.localeCompare(b.label)),
  })).filter((g) => g.items.length > 0);
}

/** Side-by-side comparison of two MDLs: every authority either cites, with each side's share of citing filings. */
export function compareMdls(
  grid: CitationGrid,
  a: string,
  b: string,
): {
  key: string;
  authority: Authority;
  a: number;
  b: number;
  shareA: number | null;
  shareB: number | null;
  both: boolean;
}[] {
  const ca = grid.mdls.find((m) => m.mdl === a)?.citing ?? null;
  const cb = grid.mdls.find((m) => m.mdl === b)?.citing ?? null;
  const by = new Map(grid.cells.map((c) => [`${c[0]}#${c[1]}`, c[2]] as const));
  return grid.authorities
    .map((au) => {
      const va = by.get(`${au.key}#${a}`) ?? 0;
      const vb = by.get(`${au.key}#${b}`) ?? 0;
      return {
        key: au.key,
        authority: au,
        a: va,
        b: vb,
        shareA: ca ? (100 * va) / ca : null,
        shareB: cb ? (100 * vb) / cb : null,
        both: va > 0 && vb > 0,
      };
    })
    .filter((r) => r.a > 0 || r.b > 0)
    .sort(
      (x, y) =>
        Number(y.both) - Number(x.both) ||
        (y.shareA ?? 0) + (y.shareB ?? 0) - ((x.shareA ?? 0) + (x.shareB ?? 0)) ||
        x.authority.label.localeCompare(y.authority.label),
    );
}

// ------------------------------------------------------------------------------------------------ adapter seam

/** One citation backend: RPC names and parsers to the shapes above. A missing RPC makes the server try the next. */
export type CitationAdapter = {
  id: string;
  map: {
    rpc: string;
    args: (mdl: string, limit: number) => Record<string, unknown>;
    parse: (raw: unknown) => CitationMap | null;
  };
  grid: {
    rpc: string;
    args: (mdls: string[] | null, limit: number) => Record<string, unknown>;
    parse: (raw: unknown) => CitationGrid | null;
  };
  filing: {
    rpc: string;
    args: (document: string) => Record<string, unknown>;
    parse: (raw: unknown) => FilingCitations | null;
  };
};

export const LITVIZ_CITATIONS: CitationAdapter = {
  id: "litviz-v1",
  map: {
    rpc: "litviz_citations_v1",
    args: (mdl, limit) => ({ p_mdl: mdl, p_limit: limit }),
    parse: parseCitationMap,
  },
  grid: {
    rpc: "litviz_citation_grid_v1",
    args: (mdls, limit) => ({ p_mdls: mdls, p_limit: limit }),
    parse: parseCitationGrid,
  },
  filing: {
    rpc: "litviz_filing_citations_v1",
    args: (document) => ({ p_document: document }),
    parse: parseFilingCitations,
  },
};

/**
 * Tried in order. Worker CITE's citation index v2 needs no adapter of its own: once citations-v2.sql is applied,
 * litviz-v1.sql reads its resolved edges (litviz.citing_links) at the next refresh, so these RPCs keep their shape and
 * gain its coverage. Its own read RPCs (citations_map_v2 is a filing × authority graph, without the court, year and
 * class labels the grid clusters by) would need an adapter here; none is needed for the views as built.
 */
export const CITATION_ADAPTERS: CitationAdapter[] = [LITVIZ_CITATIONS];
