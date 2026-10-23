/**
 * Case law server functions (/cases, /cases/<cluster id>). Read only.
 *
 *  - getCaselawCase: one Postgres RPC (caselaw_case_v1: metadata + byte pointers) and one ranged storage read that
 *    returns every opinion of the case (they are stored next to each other), decoded member by member;
 *  - getCaselawCitator: the case's cited-by member (counts by court and decade, citing cases, parentheticals), one RPC
 *    (cached) + one ranged read; getCaselawAuthorities: the cases its opinions cite, the same way;
 *  - searchCaselaw: names and citations of all three tiers (caselaw_search_v1);
 *  - searchCaselawFulltext: Supreme Court opinion text (caselaw_fulltext_v1, Postgres full-text search);
 *  - searchCaselawLive: CourtListener's live search API for the federal appellate and state tiers (server token,
 *    rate-limited, cached; every response says whether it came from the live service or the cache), linked to our
 *    case pages when we hold the case;
 *  - getCaselawCourts: courts of the three tiers with case counts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  coveringRange,
  orderOpinions,
  parseAuthorities,
  parseCaseHit,
  parseCaseRow,
  parseCitator,
  parseLiveHit,
  parseReadingRecord,
  type Authorities,
  type CaseHit,
  type CaseRecord,
  type Citator,
  type LiveHit,
  type OpinionText,
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
    const raw = await rpcPostOptional<unknown>("caselaw_case_v1", { p_cluster_id: id });
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
    const withText = ordered.filter((o) => o.pointer);
    const range = coveringRange(withText.map((o) => o.pointer!));
    const opinions: OpinionLoad[] = ordered.map((o) => ({
      opinionId: o.id,
      status: o.pointer ? "unreadable" : "not_stored",
    }));
    let textError: string | null = null;
    if (range) {
      try {
        const bytes = await readRange(range.key, range.start, range.end);
        await Promise.all(
          ordered.map(async (o, i) => {
            if (!o.pointer) return;
            const from = o.pointer.offset - range.start;
            const json = await gunzipText(bytes.subarray(from, from + o.pointer.length));
            const parsed = parseReadingRecord(JSON.parse(json), o.id);
            if (parsed && parsed.clusterId === rec.clusterId)
              opinions[i] = { opinionId: o.id, status: "ok", opinion: parsed };
          }),
        );
      } catch (e) {
        console.error("caselaw text", e);
        textError = "The stored opinion text could not be read. Try again shortly.";
      }
    } else if (withText.length) {
      textError = "The stored opinion text is not in one readable range.";
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

const searchInput = z.object({
  q: z.string().max(300).default(""),
  tier: z.number().int().min(1).max(3).nullable().default(null),
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
  const raw = await rpcPost<Record<string, unknown>>("caselaw_search_v1", {
    p_q: q || null,
    p_tier: d.tier,
    p_court: d.court,
    p_from: d.from,
    p_to: d.to,
    p_status: d.status,
    p_sort: d.sort,
    p_limit: PAGE,
    p_offset: (d.page - 1) * PAGE,
  });
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
    const raw = await rpcPost<Record<string, unknown>>("caselaw_fulltext_v1", {
      p_q: data.q,
      p_from: data.from,
      p_to: data.to,
      p_type: data.type,
      p_sort: data.sort,
      p_limit: 20,
      p_offset: (data.page - 1) * 20,
    });
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
  tier: 1 | 2 | 3;
  name: string;
  shortName: string | null;
  cases: number;
};

async function courts(): Promise<CourtOption[]> {
  return cached("courts", 30 * 60_000, async () => {
    const raw = await rpcPost<unknown[]>("caselaw_courts_v1", {});
    const out: CourtOption[] = [];
    for (const x of Array.isArray(raw) ? raw : []) {
      const o = x as Record<string, unknown>;
      const id =
        typeof o["court_id"] === "string" && /^[a-z0-9_-]{1,40}$/.test(o["court_id"])
          ? o["court_id"]
          : null;
      const tier = o["tier"] === 1 || o["tier"] === 2 || o["tier"] === 3 ? o["tier"] : null;
      const name =
        typeof o["full_name"] === "string" && o["full_name"].trim() ? o["full_name"] : null;
      const n =
        typeof o["cases"] === "number" && Number.isInteger(o["cases"]) && o["cases"] >= 0
          ? o["cases"]
          : null;
      if (id && tier && name && n != null)
        out.push({
          courtId: id,
          tier,
          name,
          shortName:
            typeof o["short_name"] === "string" && o["short_name"].trim() ? o["short_name"] : null,
          cases: n,
        });
    }
    return out;
  });
}

export const getCaselawCourts = createServerFn({ method: "GET" }).handler(courts);

const liveInput = z.object({
  q: z.string().min(1).max(300),
  tier: z
    .union([z.literal(2), z.literal(3)])
    .nullable()
    .default(null),
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
  | { ok: false; reason: "not_configured" | "rate_limited" | "upstream_error" | "no_courts" };

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
    const tierCourts = all.filter((c) =>
      data.tier ? c.tier === data.tier : c.tier === 2 || c.tier === 3,
    );
    const scope = data.court ? tierCourts.filter((c) => c.courtId === data.court) : tierCourts;
    if (!scope.length) return { ok: false, reason: "no_courts" };
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
