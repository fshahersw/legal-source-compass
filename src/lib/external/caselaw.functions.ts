/**
 * Case law server functions (/cases, /cases/<cluster id>, /cases/courts). Read only.
 *
 *  - getCaselawCase: one Postgres RPC (caselaw_case_v2, or caselaw_case_v1 where the v2 contract is not installed:
 *    metadata + byte pointers) and one ranged storage read per storage object holding the case's opinions (usually one),
 *    decoded member by member; citation links whose cited case was loaded after the record was written are re-checked
 *    (caselaw_held_v1) so they open the case page;
 *  - getCaselawCitator: the case's cited-by member (counts by court and decade, citing cases, parentheticals), one RPC
 *    (cached) + one ranged read; getCaselawAuthorities: the cases its opinions cite, the same way;
 * *  - searchCaselaw: names and citations of every tier with court, state and system filters (caselaw_search_v2; v1 for
 *    tiers 1-3 where v2 is not installed);
 *  - searchCaselawFulltext: opinion text of the indexed tiers (caselaw_fulltext_v2 / v1: Postgres full-text search);
 *  - getCaselawTextCoverage: which tiers' opinion text is indexed and how (full text or the first words);
 *  - searchCaselawLive: CourtListener's live search API for tiers 2-7 (server token, rate-limited, cached; every
 *    response says whether it came from the live service or the cache), linked to our case pages when we hold the case;
 *  - getCaselawCourts: courts with case counts, level, system and state; getCaselawCourt / listCourtCases: one court's
 *    decisions by year and page by page (caselaw_court_years_v2 / caselaw_court_cases_v2).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  isTier,
  markHeld,
  orderOpinions,
  parseAuthorities,
  parseCaseHit,
  parseCaseRow,
  parseCitator,
  parseLiveHit,
  parseReadingRecord,
  readRanges,
  unheldCitedClusters,
  type Authorities,
  type CaseHit,
  type CaseRecord,
  type Citator,
  type LiveHit,
  type OpinionText,
  type Tier,
} from "./caselaw";
import { courtListenerSearch, gunzipText, readRange } from "./caselaw.server";
import { rpcPost, rpcPostOptional } from "./rest.server";

const memo = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.v as T;
  const v = await fn();
  memo.set(key, { at: Date.now(), v });
  if (memo.size > 500) memo.delete(memo.keys().next().value as string);
  return v;
}

const idInput = z.object({ id: z.number().int().min(1).max(2_000_000_000) });

async function caseRow(id: number): Promise<CaseRecord | null> {
  return cached(`case:${id}`, 5 * 60_000, async () => {
    // v2 adds the court's level, system and state and the provenance columns; null when the case is not held or the
    // v2 contract is not installed yet, so v1 answers then
    const raw =
      (await rpcPostOptional<unknown>("caselaw_case_v2", { p_cluster_id: id })) ??
      (await rpcPostOptional<unknown>("caselaw_case_v1", { p_cluster_id: id }));
    return raw == null ? null : parseCaseRow(raw, id);
  });
}

export type OpinionLoad =
  | { opinionId: number; status: "ok"; opinion: OpinionText }
  | { opinionId: number; status: "not_stored" | "unreadable" };
export type CasePage = {
  available: boolean;
  record: CaseRecord | null;
  opinions: OpinionLoad[];
  textError: string | null;
};

export const getCaselawCase = createServerFn({ method: "GET" })
  .inputValidator((d) => idInput.parse(d))
  .handler(async ({ data }): Promise<CasePage> => {
    const rec = await caseRow(data.id).catch((e: unknown) => {
      console.error("caselaw case", e);
      throw new Error("Case metadata could not be read.");
    });
    if (rec === null) return { available: false, record: null, opinions: [], textError: null };
    const ordered = orderOpinions(rec.opinions);
    const withText = ordered.map((o, i) => ({ o, i })).filter((x) => x.o.pointer);
    const ranges = readRanges(withText.map((x) => x.o.pointer!));
    const opinions: OpinionLoad[] = ordered.map((o) => ({
      opinionId: o.id,
      status: o.pointer ? "unreadable" : "not_stored",
    }));
    let textError: string | null = null;
    if (ranges.length > 6) {
      textError = "The stored opinion text is spread over too many places to read at once.";
    } else if (ranges.length) {
      try {
        await Promise.all(
          ranges.map(async (range) => {
            const bytes = await readRange(range.key, range.start, range.end);
            await Promise.all(
              range.members.map(async (m) => {
                const { o, i } = withText[m]!;
                const from = o.pointer!.offset - range.start;
                const json = await gunzipText(bytes.subarray(from, from + o.pointer!.length));
                const parsed = parseReadingRecord(JSON.parse(json), o.id);
                if (parsed && parsed.clusterId === rec.clusterId)
                  opinions[i] = { opinionId: o.id, status: "ok", opinion: parsed };
              }),
            );
          }),
        );
      } catch (e) {
        console.error("caselaw text", e);
        textError = "The stored opinion text could not be read. Try again shortly.";
      }
    }
    // citation links into cases loaded after this record was written (e.g. a district case cited by an appellate
    // opinion): checked live so they open the case page here instead of CourtListener
    const loaded = opinions.flatMap((x) => (x.status === "ok" ? [x.opinion] : []));
    const recheck = unheldCitedClusters(loaded);
    if (recheck.length) {
      const held = new Set<number>(
        (
          (await rpcPost<number[]>("caselaw_held_v1", { p_ids: recheck }).catch(() => [])) ?? []
        ).filter((x) => typeof x === "number"),
      );
      const marked = markHeld(loaded, held);
      let k = 0;
      for (let i = 0; i < opinions.length; i++)
        if (opinions[i]!.status === "ok")
          opinions[i] = { opinionId: opinions[i]!.opinionId, status: "ok", opinion: marked[k++]! };
    }
    return { available: true, record: { ...rec, opinions: ordered }, opinions, textError };
  });

export const getCaselawCitator = createServerFn({ method: "GET" })
  .inputValidator((d) => idInput.parse(d))
  .handler(async ({ data }): Promise<{ available: boolean; citator: Citator | null }> => {
    const rec = await caseRow(data.id);
    if (!rec) return { available: false, citator: null };
    if (!rec.citator) return { available: true, citator: null };
    const p = rec.citator;
    const bytes = await readRange(p.key, p.offset, p.offset + p.length);
    const citator = parseCitator(JSON.parse(await gunzipText(bytes)), rec.clusterId);
    if (!citator) throw new Error("The citator record could not be read.");
    return { available: true, citator };
  });

export const getCaselawAuthorities = createServerFn({ method: "GET" })
  .inputValidator((d) => idInput.parse(d))
  .handler(async ({ data }): Promise<{ available: boolean; authorities: Authorities | null }> => {
    const rec = await caseRow(data.id);
    if (!rec) return { available: false, authorities: null };
    if (!rec.authoritiesRef) return { available: true, authorities: null };
    const p = rec.authoritiesRef;
    const bytes = await readRange(p.key, p.offset, p.offset + p.length);
    const authorities = parseAuthorities(JSON.parse(await gunzipText(bytes)), rec.clusterId);
    if (!authorities) throw new Error("The cited-authorities record could not be read.");
    return { available: true, authorities };
  });

const jurisdictionInput = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .nullable()
  .default(null);
const searchInput = z.object({
  q: z.string().max(300).default(""),
  tier: z.number().int().min(1).max(7).nullable().default(null),
  jurisdiction: jurisdictionInput,
  court: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/)
    .nullable()
    .default(null),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  status: z
    .enum([
      "Published",
      "Unpublished",
      "Errata",
      "Separate",
      "In-chambers",
      "Relating-to",
      "Unknown",
    ])
    .nullable()
    .default(null),
  sort: z.enum(["relevance", "cited", "newest", "oldest"]).default("relevance"),
  page: z.number().int().min(1).max(100).default(1),
});
export type CaseSearch = {
  mode: "name" | "citation" | "browse";
  rows: CaseHit[];
  hasMore: boolean;
  page: number;
  note: string | null;
  dropped: number;
};
const PAGE = 25;

async function runSearch(
  d: z.infer<typeof searchInput>,
  q: string,
): Promise<{ mode: CaseSearch["mode"]; rows: CaseHit[]; hasMore: boolean; dropped: number }> {
  const common = {
    p_q: q || null,
    p_court: d.court,
    p_from: d.from,
    p_to: d.to,
    p_status: d.status,
    p_sort: d.sort,
    p_limit: PAGE,
    p_offset: (d.page - 1) * PAGE,
  };
  let raw = await rpcPostOptional<Record<string, unknown>>("caselaw_search_v2", {
    ...common,
    p_tiers: d.tier ? [d.tier] : null,
    p_jurisdiction: d.jurisdiction,
  });
  if (raw == null) {
    // the v2 contract is not installed: tiers 1-3 through v1 (a state or tier 4-7 filter finds nothing there)
    if ((d.tier && d.tier > 3) || d.jurisdiction)
      return { mode: "browse", rows: [], hasMore: false, dropped: 0 };
    raw = await rpcPost<Record<string, unknown>>("caselaw_search_v1", {
      ...common,
      p_tier: d.tier,
    });
  }
  const list = Array.isArray(raw["rows"]) ? (raw["rows"] as unknown[]) : [];
  const rows = list.map(parseCaseHit).filter((r): r is CaseHit => !!r);
  const mode = raw["mode"] === "citation" || raw["mode"] === "name" ? raw["mode"] : "browse";
  return { mode, rows, hasMore: raw["has_more"] === true, dropped: list.length - rows.length };
}

export const searchCaselaw = createServerFn({ method: "GET" })
  .inputValidator((d) => searchInput.parse(d))
  .handler(async ({ data }): Promise<CaseSearch> => {
    const q = data.q.trim();
    const first = await runSearch(data, q);
    if (first.mode === "citation" && first.rows.length === 0 && data.page === 1) {
      // not a citation we hold: try the words as a case name
      const byName = await runSearch(data, q.replace(/[0-9]+/g, " ").trim());
      if (byName.rows.length)
        return {
          ...byName,
          mode: "name",
          page: data.page,
          note: `No case with the citation “${q}”; showing name matches.`,
        };
    }
    return { ...first, page: data.page, note: null };
  });

const fulltextInput = z.object({
  q: z.string().min(1).max(300),
  tier: z.number().int().min(1).max(7).nullable().default(null),
  court: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/)
    .nullable()
    .default(null),
  jurisdiction: jurisdictionInput,
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  type: z
    .string()
    .regex(/^\d{3}[a-z]{3,30}$/)
    .nullable()
    .default(null),
  sort: z.enum(["relevance", "cited", "newest", "oldest"]).default("relevance"),
  page: z.number().int().min(1).max(50).default(1),
});
export type FulltextSearch = {
  rows: CaseHit[];
  hasMore: boolean;
  page: number;
  query: string | null;
  dropped: number;
};

export const searchCaselawFulltext = createServerFn({ method: "GET" })
  .inputValidator((d) => fulltextInput.parse(d))
  .handler(async ({ data }): Promise<FulltextSearch> => {
    const common = {
      p_q: data.q,
      p_from: data.from,
      p_to: data.to,
      p_type: data.type,
      p_sort: data.sort,
      p_limit: 20,
      p_offset: (data.page - 1) * 20,
    };
    let raw = await rpcPostOptional<Record<string, unknown>>("caselaw_fulltext_v2", {
      ...common,
      p_tiers: data.tier ? [data.tier] : null,
      p_court: data.court,
      p_jurisdiction: data.jurisdiction,
    });
    if (raw == null) {
      if (
        (data.tier && data.tier !== 1) ||
        data.jurisdiction ||
        (data.court && data.court !== "scotus")
      )
        return { rows: [], hasMore: false, page: data.page, query: null, dropped: 0 };
      raw = await rpcPost<Record<string, unknown>>("caselaw_fulltext_v1", common);
    }
    const list = Array.isArray(raw["rows"]) ? (raw["rows"] as unknown[]) : [];
    const rows = list.map(parseCaseHit).filter((r): r is CaseHit => !!r);
    return {
      rows,
      hasMore: raw["has_more"] === true,
      page: data.page,
      query: typeof raw["query"] === "string" ? raw["query"] : null,
      dropped: list.length - rows.length,
    };
  });

export type CourtOption = {
  courtId: string;
  tier: Tier;
  name: string;
  shortName: string | null;
  cases: number;
  /** Cases whose opinion text is stored (null: not recorded, e.g. before the v2 contract). */
  casesWithText: number | null;
  level: string | null;
  system: string | null;
  jurisdiction: string | null;
  parentCourtId: string | null;
  citationString: string | null;
  url: string | null;
};

const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() && v.length <= max ? v : null;
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

export function parseCourtOption(x: unknown): CourtOption | null {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const id =
    typeof o["court_id"] === "string" && /^[a-z0-9_-]{1,40}$/.test(o["court_id"])
      ? o["court_id"]
      : null;
  const tier = isTier(o["tier"]) ? o["tier"] : null;
  const name = text(o["full_name"], 300);
  const n = count(o["cases"]);
  const jur = text(o["jurisdiction"], 2);
  const url = text(o["url"], 500);
  if (!id || !tier || !name || n == null) return null;
  return {
    courtId: id,
    tier,
    name,
    shortName: text(o["short_name"], 200),
    cases: n,
    casesWithText: count(o["cases_with_text"]),
    level: text(o["level"], 8),
    system: text(o["system"], 20),
    jurisdiction: jur && /^[A-Z]{2}$/.test(jur) ? jur : null,
    parentCourtId:
      typeof o["parent_court_id"] === "string" && /^[a-z0-9_-]{1,40}$/.test(o["parent_court_id"])
        ? o["parent_court_id"]
        : null,
    citationString: text(o["citation_string"], 200),
    url: url && /^https?:\/\//.test(url) ? url : null,
  };
}

async function courts(): Promise<CourtOption[]> {
  return cached("courts", 30 * 60_000, async () => {
    const raw =
      (await rpcPostOptional<unknown[]>("caselaw_courts_v2", {})) ??
      (await rpcPost<unknown[]>("caselaw_courts_v1", {}));
    return (Array.isArray(raw) ? raw : [])
      .map(parseCourtOption)
      .filter((c): c is CourtOption => !!c);
  });
}

export const getCaselawCourts = createServerFn({ method: "GET" }).handler(courts);

const LIVE_MAX_COURTS = 300;
const liveInput = z.object({
  q: z.string().min(1).max(300),
  tier: z.number().int().min(2).max(7).nullable().default(null),
  jurisdiction: jurisdictionInput,
  court: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/)
    .nullable()
    .default(null),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  allStatuses: z.boolean().default(false),
  semantic: z.boolean().default(false),
  sort: z.enum(["relevance", "cited", "newest", "oldest"]).default("relevance"),
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9%=_-]{1,400}$/)
    .nullable()
    .default(null),
});
export type LiveSearch =
  | {
      ok: true;
      source: "live" | "cache";
      fetchedAt: string;
      count: number | null;
      rows: LiveHit[];
      next: string | null;
      semantic: boolean;
    }
  | {
      ok: false;
      reason:
        "not_configured" | "rate_limited" | "upstream_error" | "no_courts" | "too_many_courts";
    };

const ORDER: Record<string, string> = {
  relevance: "score desc",
  cited: "citeCount desc",
  newest: "dateFiled desc",
  oldest: "dateFiled asc",
};
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

export const searchCaselawLive = createServerFn({ method: "GET" })
  .inputValidator((d) => liveInput.parse(d))
  .handler(async ({ data }): Promise<LiveSearch> => {
    const all = await courts();
    const tierCourts = all.filter(
      (c) =>
        (data.tier ? c.tier === data.tier : c.tier === 2 || c.tier === 3) &&
        (!data.jurisdiction || c.jurisdiction === data.jurisdiction),
    );
    const scope = data.court ? tierCourts.filter((c) => c.courtId === data.court) : tierCourts;
    if (!scope.length) return { ok: false, reason: "no_courts" };
    // one request names every court; hundreds of trial courts would make an unusable query
    if (scope.length > LIVE_MAX_COURTS) return { ok: false, reason: "too_many_courts" };
    const p = new URLSearchParams({
      q: data.q,
      type: "o",
      highlight: "on",
      court: scope.map((c) => c.courtId).join(" "),
    });
    if (data.semantic) p.set("semantic", "true");
    else p.set("order_by", ORDER[data.sort]!);
    if (data.from) p.set("filed_after", usDate(data.from));
    if (data.to) p.set("filed_before", usDate(data.to));
    if (data.allStatuses)
      for (const s of [
        "Unpublished",
        "Errata",
        "Separate",
        "In-chambers",
        "Relating-to",
        "Unknown",
      ])
        p.set(`stat_${s}`, "on");
    if (data.cursor) p.set("cursor", decodeURIComponent(data.cursor));
    // CourtListener answers a keyword search over many courts in up to about 25 seconds and a semantic search (the
    // query is embedded on its side) in about 20-30 seconds; a failed call still spends quota, so wait generously
    const res = await courtListenerSearch(p, data.semantic ? 60_000 : 45_000);
    if (!res.ok) return { ok: false, reason: res.reason };
    const body = (res.body ?? {}) as Record<string, unknown>;
    const hits = (Array.isArray(body["results"]) ? body["results"] : [])
      .map(parseLiveHit)
      .filter((h): h is Omit<LiveHit, "held"> => !!h);
    const ids = hits.map((h) => h.clusterId);
    const held = new Set<number>(
      ids.length
        ? ((await rpcPost<number[]>("caselaw_held_v1", { p_ids: ids }).catch(() => [])) ?? [])
        : [],
    );
    const nextUrl = typeof body["next"] === "string" ? body["next"] : null;
    let next: string | null = null;
    if (nextUrl) {
      try {
        const c = new URL(nextUrl).searchParams.get("cursor");
        next = c ? encodeURIComponent(c) : null;
      } catch {
        next = null;
      }
    }
    return {
      ok: true,
      source: res.source,
      fetchedAt: res.fetchedAt,
      count: typeof body["count"] === "number" ? body["count"] : null,
      rows: hits.map((h) => ({ ...h, held: held.has(h.clusterId) })),
      next,
      semantic: data.semantic,
    };
  });

// ---------------------------------------------------------------------------------------------- text coverage
export type TextCoverage = {
  /** tier -> opinions indexed, by scope; empty when nothing beyond the Supreme Court is indexed */
  tiers: { tier: Tier; scope: "full" | "prefix"; opinions: number; prefixWords: number | null }[];
  installed: boolean;
};

export const getCaselawTextCoverage = createServerFn({ method: "GET" }).handler(
  async (): Promise<TextCoverage> =>
    cached("coverage", 6 * 3_600_000, async () => {
      const raw = await rpcPostOptional<unknown[]>("caselaw_text_coverage_v2", {});
      if (raw == null)
        return {
          installed: false,
          tiers: [{ tier: 1, scope: "full", opinions: 0, prefixWords: null }],
        };
      const tiers: TextCoverage["tiers"] = [];
      for (const x of Array.isArray(raw) ? raw : []) {
        const o = (x ?? {}) as Record<string, unknown>;
        const scope = o["scope"] === "full" || o["scope"] === "prefix" ? o["scope"] : null;
        const n = count(o["opinions"]);
        if (isTier(o["tier"]) && scope && n != null)
          tiers.push({
            tier: o["tier"],
            scope,
            opinions: n,
            prefixWords: count(o["prefix_words"]),
          });
      }
      return { installed: true, tiers };
    }),
);

// ---------------------------------------------------------------------------------------------- one court
const courtInput = z.object({ court: z.string().regex(/^[a-z0-9_-]{1,40}$/) });
export type CourtYears = {
  court: CourtOption | null;
  years: { year: number; cases: number; withText: number }[];
  undated: number;
  available: boolean;
};

export const getCaselawCourt = createServerFn({ method: "GET" })
  .inputValidator((d) => courtInput.parse(d))
  .handler(async ({ data }): Promise<CourtYears> => {
    const court = (await courts()).find((c) => c.courtId === data.court) ?? null;
    if (!court) return { court: null, years: [], undated: 0, available: false };
    const raw = await rpcPostOptional<Record<string, unknown>>("caselaw_court_years_v2", {
      p_court: data.court,
    });
    if (raw == null) return { court, years: [], undated: 0, available: false };
    const years: CourtYears["years"] = [];
    for (const y of Array.isArray(raw["years"]) ? raw["years"] : []) {
      const a = Array.isArray(y) ? y : [];
      const yr = count(a[0]);
      const n = count(a[1]);
      const t = count(a[2]);
      if (yr != null && yr >= 1600 && yr <= 2100 && n != null)
        years.push({ year: yr, cases: n, withText: t ?? 0 });
    }
    return { court, years, undated: count(raw["undated"]) ?? 0, available: true };
  });

const courtCasesInput = z.object({
  court: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  year: z.number().int().min(1600).max(2100).nullable().default(null),
  sort: z.enum(["newest", "oldest", "cited"]).default("newest"),
  page: z.number().int().min(1).max(200).default(1),
});
export type CourtCases = { rows: CaseHit[]; hasMore: boolean; page: number; dropped: number };
const COURT_PAGE = 50;

export const listCourtCases = createServerFn({ method: "GET" })
  .inputValidator((d) => courtCasesInput.parse(d))
  .handler(async ({ data }): Promise<CourtCases> => {
    const raw = await rpcPostOptional<Record<string, unknown>>("caselaw_court_cases_v2", {
      p_court: data.court,
      p_year: data.year,
      p_sort: data.sort,
      p_limit: COURT_PAGE,
      p_offset: (data.page - 1) * COURT_PAGE,
    });
    const list = raw && Array.isArray(raw["rows"]) ? (raw["rows"] as unknown[]) : [];
    const rows = list.map(parseCaseHit).filter((r): r is CaseHit => !!r);
    return {
      rows,
      hasMore: raw?.["has_more"] === true,
      page: data.page,
      dropped: list.length - rows.length,
    };
  });
