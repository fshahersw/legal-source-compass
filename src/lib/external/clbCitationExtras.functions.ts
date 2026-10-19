/**
 * Two citation views for /courts/collection, compiled by scripts/enrichment/courtlistener_rest from CourtListener's bulk files:
 * - how later opinions describe a most-cited cluster (dataset clb_top_cited_parentheticals, same ids as clb_top_cited);
 * - citations CourtListener found in opinions but could not match to a case (dataset clb_unmatched_citations), by reporter and
 *   by citing court.
 * Parenthetical text is shown as CourtListener extracted it; describing cases flagged as blocked are not named. Links are kept
 * only when they name exactly the stored id. Stored JSON is validated here; malformed values are dropped. Read-only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const count = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
};
const pct = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n <= 100 ? n : null;
};
const year = (v: unknown) => {
  const n = count(v);
  return n != null && n >= 1600 && n <= 2100 ? n : null;
};
const COURT = /^[A-Za-z0-9]{2,24}$/;
const courtLink = (v: unknown, courtId: string | null) => {
  const s = str(v);
  return s && courtId && s === `/courts/${courtId}` ? s : null;
};

// ------------------------------------------------------------------ parentheticals

export const CLUSTER_ID = /^\d{1,10}$/;

export type Parenthetical = {
  id: number;
  score: number | null;
  /** As CourtListener extracted it; `truncated` when cut at 600 characters. */
  text: string;
  truncated: boolean;
  describingCase: string | null;
  /** The describing case is flagged by CourtListener as blocked from search engines, so it is not named. */
  describingCaseWithheld: boolean;
  describingUrl: string | null;
  describingCourt: string | null;
  describingCourtLink: string | null;
  describingYear: number | null;
};
export type ClusterParentheticals = {
  clusterId: number;
  caseName: string | null;
  parentheticals: number;
  describingOpinions: number | null;
  groups: number | null;
  describingCourts: {
    courtId: string;
    name: string;
    n: number;
    sharePct: number | null;
    link: string | null;
  }[];
  /** Describing parentheticals with a known court: Federal / State / Other. */
  describingGroups: { federal: number; state: number; other: number } | null;
  byDecade: { decade: number; n: number }[];
  examples: Parenthetical[];
};

export function parseClusterParentheticals(
  raw: unknown,
  clusterId: number,
): ClusterParentheticals | null {
  const p = obj(raw);
  if (!p || p["cluster_id"] !== clusterId) return null;
  const total = count(p["parentheticals"]);
  if (total == null) return null;
  const g = obj(p["describing_groups"]);
  const examples: Parenthetical[] = arr(p["examples"]).flatMap((x) => {
    const o = obj(x);
    const id = count(o?.["parenthetical_id"]);
    const text = str(o?.["text"], 700);
    if (id == null || !text) return [];
    const dcid = count(o?.["describing_cluster_id"]);
    const url = str(o?.["describing_url"]);
    const courtId = str(o?.["describing_court_id"], 24);
    const withheld = o?.["describing_case_withheld"] === true;
    return [
      {
        id,
        score: num(o?.["score"]),
        text,
        truncated: o?.["truncated"] === true,
        describingCase: withheld ? null : str(o?.["describing_case"], 300),
        describingCaseWithheld: withheld,
        describingUrl:
          !withheld && dcid != null && url === `https://www.courtlistener.com/opinion/${dcid}/`
            ? url
            : null,
        describingCourt: str(o?.["describing_court"]),
        describingCourtLink:
          courtId && COURT.test(courtId) ? courtLink(o?.["describing_court_link"], courtId) : null,
        describingYear: year(o?.["describing_year"]),
      },
    ];
  });
  return {
    clusterId,
    caseName: str(p["case_name"], 300),
    parentheticals: total,
    describingOpinions: count(p["describing_opinions"]),
    groups: count(p["groups"]),
    describingCourts: arr(p["describing_courts"]).flatMap((x) => {
      const o = obj(x);
      const id = str(o?.["court_id"], 24);
      const nm = str(o?.["name"]);
      const n = count(o?.["n"]);
      return id && COURT.test(id) && nm && n != null && n <= total
        ? [
            {
              courtId: id,
              name: nm,
              n,
              sharePct: pct(o?.["share_pct"]),
              link: courtLink(o?.["link"], id),
            },
          ]
        : [];
    }),
    describingGroups: g
      ? {
          federal: count(g["Federal"]) ?? 0,
          state: count(g["State"]) ?? 0,
          other: count(g["Other"]) ?? 0,
        }
      : null,
    byDecade: arr(p["by_decade"]).flatMap((x) => {
      const o = obj(x);
      const d = year(o?.["decade"]);
      const n = count(o?.["n"]);
      return d != null && d % 10 === 0 && n != null ? [{ decade: d, n }] : [];
    }),
    examples,
  };
}

export const getClbParentheticals = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z.object({ clusterId: z.number().int().positive().max(9_999_999_999) }).parse(d),
  )
  .handler(async ({ data }): Promise<ClusterParentheticals | null> => {
    const r = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.clb_top_cited_parentheticals&id=eq.cluster:${data.clusterId}&limit=1`,
    );
    return r.rows.length === 1 ? parseClusterParentheticals(r.rows[0]!.p, data.clusterId) : null;
  });

// ------------------------------------------------------------------ unmatched citations

export const UNMATCHED_ID = /^(reporter:[a-z0-9-]{1,80}|court:[A-Za-z0-9]{2,24})$/;

export type UnmatchedRow = {
  id: string;
  kind: "reporter" | "court";
  name: string;
  citations: number;
  distinct: number | null;
  opinions: number | null;
  unresolvedPct: number | null;
  type: string | null;
  /** Reporters only: whether CourtListener's citation table holds any citation with this reporter string. */
  inCitationTable: boolean | null;
};
export type StatusShare = { code: number; label: string; n: number; sharePct: number | null };
export type UnmatchedOverview = {
  citations: number;
  unresolved: number | null;
  unresolvedPct: number | null;
  statuses: StatusShare[];
  types: StatusShare[];
  byDecade: { decade: number; n: number }[];
  reportersTotal: number | null;
  minReporter: number | null;
  minCourt: number | null;
};
export type UnmatchedList = { overview: UnmatchedOverview | null; rows: UnmatchedRow[] };

function shares(v: unknown, whole: number): StatusShare[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const code = count(o?.["code"]);
    const label = str(o?.["label"], 120);
    const n = count(o?.["n"]);
    return code != null && label && n != null && n <= whole
      ? [{ code, label, n, sharePct: pct(o?.["share_pct"]) }]
      : [];
  });
}

export function parseUnmatchedOverview(raw: unknown): UnmatchedOverview | null {
  const p = obj(raw);
  const citations = count(p?.["citations"]);
  if (!p || citations == null) return null;
  return {
    citations,
    unresolved: count(p["unresolved"]),
    unresolvedPct: pct(p["unresolved_pct"]),
    statuses: shares(p["statuses"], citations),
    types: shares(p["types"], citations),
    byDecade: arr(p["by_decade"]).flatMap((x) => {
      const o = obj(x);
      const d = year(o?.["decade"]);
      const n = count(o?.["n"]);
      return d != null && d % 10 === 0 && n != null ? [{ decade: d, n }] : [];
    }),
    reportersTotal: count(p["reporters_total"]),
    minReporter: count(p["min_reporter"]),
    minCourt: count(p["min_court"]),
  };
}

export function parseUnmatchedRow(id: unknown, cells: unknown): UnmatchedRow | null {
  const rid = str(id, 120);
  const c = obj(cells);
  if (!rid || !UNMATCHED_ID.test(rid) || !c) return null;
  const kind = rid.startsWith("reporter:") ? "reporter" : "court";
  if (c["kind"] !== kind) return null;
  const name = str(c["name"]);
  const citations = count(c["citations"]);
  if (!name || citations == null) return null;
  const inTable = c["in_citation_table"];
  return {
    id: rid,
    kind,
    name,
    citations,
    distinct: count(c["distinct"]),
    opinions: count(c["opinions"]),
    unresolvedPct: pct(c["unresolved_pct"]),
    type: str(c["type"], 80),
    inCitationTable:
      kind === "reporter" ? (inTable === "Yes" ? true : inTable === "No" ? false : null) : null,
  };
}

export const getClbUnmatchedList = createServerFn({ method: "GET" }).handler(
  async (): Promise<UnmatchedList> => {
    const [ov, list] = await Promise.all([
      restGet<{ p: unknown }[]>(
        "corpus_records?select=p:item->profile&dataset=eq.clb_unmatched_citations&id=eq.overview:all&limit=1",
      ),
      restGet<{ id: unknown; c: unknown }[]>(
        "corpus_records?select=id,c:item->cells&dataset=eq.clb_unmatched_citations&id=neq.overview:all&order=ordinal.asc&limit=2000",
      ),
    ]);
    return {
      overview: ov.rows.length === 1 ? parseUnmatchedOverview(ov.rows[0]!.p) : null,
      rows: list.rows.flatMap((r) => {
        const row = parseUnmatchedRow(r.id, r.c);
        return row ? [row] : [];
      }),
    };
  },
);

export type UnmatchedDetail = {
  id: string;
  kind: "reporter" | "court";
  name: string;
  statuses: StatusShare[];
  /** Reporters: the citations most often left unmatched, as written. */
  topCitations: { citation: string; n: number; status: string | null; mixed: boolean }[];
  /** Reporters: citing courts; courts: their most frequent unmatched reporters. */
  parts: { key: string; label: string; n: number; sharePct: number | null; link: string | null }[];
  byPeriod: { label: string; n: number }[];
  firstYear: number | null;
  lastYear: number | null;
  /** Courts: share of the court's opinions with at least one unmatched citation. */
  opinionsWithUnmatchedPct: number | null;
  courtOpinions: number | null;
  inCitationTable: { citations: number; clusters: number } | null;
};

export function parseUnmatchedDetail(id: string, raw: unknown): UnmatchedDetail | null {
  const p = obj(raw);
  if (!p || !UNMATCHED_ID.test(id)) return null;
  const kind = id.startsWith("reporter:") ? "reporter" : "court";
  const total = count(p["citations"]);
  if (total == null) return null;
  if (kind === "court" && p["court_id"] !== id.slice(6)) return null;
  const name = kind === "reporter" ? str(p["reporter"], 80) : str(p["name"]);
  if (!name) return null;
  const statuses = arr(p["statuses"]).flatMap((x) => {
    const o = obj(x);
    const code = count(o?.["code"]);
    const label = str(o?.["label"], 120);
    const n = count(o?.["n"]);
    return code != null && label && n != null && n <= total
      ? [{ code, label, n, sharePct: pct(o?.["share_pct"]) }]
      : [];
  });
  const parts =
    kind === "reporter"
      ? arr(p["citing_courts"]).flatMap((x) => {
          const o = obj(x);
          const cid = str(o?.["court_id"], 24);
          const nm = str(o?.["name"]);
          const n = count(o?.["n"]);
          return cid && COURT.test(cid) && nm && n != null && n <= total
            ? [
                {
                  key: cid,
                  label: nm,
                  n,
                  sharePct: pct(o?.["share_pct"]),
                  link: courtLink(o?.["link"], cid),
                },
              ]
            : [];
        })
      : arr(p["reporters"]).flatMap((x) => {
          const o = obj(x);
          const rep = str(o?.["reporter"], 80);
          const n = count(o?.["n"]);
          return rep && n != null && n <= total
            ? [{ key: rep, label: rep, n, sharePct: pct(o?.["share_pct"]), link: null }]
            : [];
        });
  const byPeriod =
    kind === "reporter"
      ? arr(p["by_decade"]).flatMap((x) => {
          const o = obj(x);
          const d = year(o?.["decade"]);
          const n = count(o?.["n"]);
          return d != null && n != null ? [{ label: `${d}s`, n }] : [];
        })
      : arr(p["by_year"]).flatMap((x) => {
          const o = obj(x);
          const y = year(o?.["yr"]);
          const n = count(o?.["citations"]);
          return y != null && y >= 1950 && n != null ? [{ label: String(y), n }] : [];
        });
  const it = obj(p["in_citation_table"]);
  const itc = count(it?.["citations"]);
  const itk = count(it?.["clusters"]);
  return {
    id,
    kind,
    name,
    statuses,
    topCitations: arr(p["top_citations"]).flatMap((x) => {
      const o = obj(x);
      const citation = str(o?.["citation"], 120);
      const n = count(o?.["n"]);
      return citation && n != null && n <= total
        ? [
            {
              citation,
              n,
              status: str(o?.["status"], 120),
              mixed: (count(o?.["statuses"]) ?? 1) > 1,
            },
          ]
        : [];
    }),
    parts,
    byPeriod,
    firstYear: year(p["first_citing_year"]),
    lastYear: year(p["last_citing_year"]),
    opinionsWithUnmatchedPct: pct(p["opinions_with_unmatched_pct"]),
    courtOpinions: count(p["court_opinions"]),
    inCitationTable: itc != null && itk != null ? { citations: itc, clusters: itk } : null,
  };
}

export const getClbUnmatchedDetail = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(UNMATCHED_ID) }).parse(d))
  .handler(async ({ data }): Promise<UnmatchedDetail | null> => {
    const r = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.clb_unmatched_citations&id=eq.${encodeURIComponent(data.id)}&limit=1`,
    );
    return r.rows.length === 1 ? parseUnmatchedDetail(data.id, r.rows[0]!.p) : null;
  });
