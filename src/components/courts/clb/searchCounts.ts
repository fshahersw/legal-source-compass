/**
 * Pure parsers for the search-count records (dataset clb_search_counts): one record per court (the Supreme Court and the
 * 13 federal courts of appeals), one per topic (national by year) and the all-opinions series. Each count is what
 * CourtListener's search engine returned for an exact query; each point keeps its query, search page and retrieval time.
 * Shares are re-derived here from the stored counts and must agree with the stored share, or the point is dropped.
 */

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 400): string | null =>
  typeof v === "string" && v.trim() && v.length <= max ? v : null;
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SEARCH_PAGE = "https://www.courtlistener.com/?";

/** Courts that have a court record in the dataset. */
export const SEARCH_COUNT_COURTS = [
  "scotus",
  "ca1",
  "ca2",
  "ca3",
  "ca4",
  "ca5",
  "ca6",
  "ca7",
  "ca8",
  "ca9",
  "ca10",
  "ca11",
  "cadc",
  "cafc",
] as const;

export type CountPoint = { q: string; count: number; retrievedAt: string; searchUrl: string };
export type TopicShare = CountPoint & {
  slug: string;
  label: string;
  topicQuery: string;
  sharePct: number;
  rank: number | null;
  rankOf: number | null;
  pooledSharePct: number | null;
};
export type CourtCounts = {
  courtId: string;
  court: string;
  window: [string, string];
  total: CountPoint;
  topics: TopicShare[];
};
export type YearPoint = CountPoint & {
  year: number;
  partial: boolean;
  total: number | null;
  sharePct: number | null;
};
export type TopicSeries = { slug: string; label: string; topicQuery: string; points: YearPoint[] };

function point(v: unknown): CountPoint | null {
  const o = obj(v);
  const q = str(o?.["q"], 1200);
  const n = count(o?.["count"]);
  const at = str(o?.["retrieved_at"], 30);
  const url = str(o?.["search_url"], 2000);
  if (!q || n == null || !at || !STAMP.test(at) || !url || !url.startsWith(SEARCH_PAGE))
    return null;
  return { q, count: n, retrievedAt: at, searchUrl: url };
}

/** count / whole x 100, to the stored three decimals; null when the whole is missing or zero. */
export function shareOf(part: number, whole: number | null): number | null {
  return whole ? Math.round((100 * part * 1000) / whole) / 1000 : null;
}

const agrees = (stored: unknown, derived: number | null) =>
  typeof stored === "number" && derived != null && Math.abs(stored - derived) < 0.0006;

export function parseCourtCounts(raw: unknown, courtId: string): CourtCounts | null {
  const p = obj(raw);
  if (!p || p["kind"] !== "court" || p["court_id"] !== courtId) return null;
  const total = point(p["total"]);
  const court = str(p["court"], 200);
  const w = arr(p["window"]);
  if (!total || !court || w.length !== 2 || typeof w[0] !== "string" || typeof w[1] !== "string")
    return null;
  const topics = arr(p["topics"]).flatMap((t) => {
    const o = obj(t);
    const pt = point(o);
    const slug = str(o?.["slug"], 40);
    const label = str(o?.["label"], 120);
    const tq = str(o?.["topic_query"], 400);
    if (!o || !pt || !slug || !label || !tq || pt.count > total.count) return [];
    const derived = shareOf(pt.count, total.count);
    if (!agrees(o["share_pct"], derived)) return [];
    const rank = count(o["rank"]);
    const rankOf = count(o["rank_of"]);
    const pooled = o["pooled_share_pct"];
    return [
      {
        ...pt,
        slug,
        label,
        topicQuery: tq,
        sharePct: derived!,
        rank: rank && rankOf && rank <= rankOf ? rank : null,
        rankOf: rank && rankOf && rank <= rankOf ? rankOf : null,
        pooledSharePct: typeof pooled === "number" && pooled >= 0 && pooled <= 100 ? pooled : null,
      },
    ];
  });
  return { courtId, court, window: [w[0], w[1]], total, topics };
}

export function parseTopicSeries(raw: unknown): TopicSeries | null {
  const p = obj(raw);
  const slug = str(p?.["slug"], 40);
  const label = str(p?.["label"], 120);
  const tq = str(p?.["topic_query"], 400);
  if (!p || p["kind"] !== "topic" || !slug || !label || !tq) return null;
  const seen = new Set<number>();
  const points = arr(p["points"]).flatMap((x) => {
    const o = obj(x);
    const pt = point(o);
    const y = count(o?.["year"]);
    if (!o || !pt || y == null || y < 1900 || y > 2100 || seen.has(y)) return [];
    const total = count(o["total"]);
    if (total != null && pt.count > total) return [];
    const derived = total != null ? shareOf(pt.count, total) : null;
    if (derived != null && !agrees(o["share_pct"], derived)) return [];
    seen.add(y);
    return [{ ...pt, year: y, partial: o["partial"] === true, total, sharePct: derived }];
  });
  return points.length
    ? { slug, label, topicQuery: tq, points: points.sort((a, b) => a.year - b.year) }
    : null;
}

/** The record ids one court page reads. */
export function recordIds(courtId: string, topicSlugs: readonly string[]): string[] {
  return [`court:${courtId}`, ...topicSlugs.map((s) => `topic:${s}`)];
}
