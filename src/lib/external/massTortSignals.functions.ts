/** Mass-tort product signals: products-liability MDLs joined to FDA/NHTSA report and recall aggregates. */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";

export type SignalRecall = {
  recall_number?: string | null;
  res_event_number?: string | null;
  classification?: string | null;
  report_date?: string | null;
  event_date_initiated?: string | null;
  recalling_firm?: string | null;
  product_description?: string | null;
  reason_for_recall?: string | null;
  status?: string | null;
};
export type MassTortSignal = {
  mdl: number;
  title: string;
  product: string;
  kind: "drug" | "device" | "food" | "cosmetic" | "vehicle";
  source: string;
  sourceUrl: string;
  caveat: string;
  eventTotal: number | null;
  eventsByYear: Record<string, number>;
  breakdown: Record<string, number>;
  breakdownError: string | null;
  /** Most reported terms with spelling-case variants combined (see mergeTermCase). */
  topTerms: TopTerm[];
  recallTotal: number | null;
  recallBreakdown: Record<string, number>;
  recentRecalls: SignalRecall[];
  eventsQuery: string | null;
  pending: number;
  total: number;
  change12m: number | null;
  judge: string | null;
  district: string | null;
  series: { date: string; pending: number; total: number }[];
};

export type TopTerm = {
  term: string;
  count: number;
  /** Every spelling recorded for this term, first seen first ("Diarrhoea", "DIARRHOEA"). */
  variants: string[];
};

type Item = {
  signal?: Record<string, unknown>;
  litigation?: Record<string, unknown>;
};

/** Case folding shared with merge_case_variants in scripts/enrichment/build_mass_tort_signals.py (str.lower()). */
const foldCase = (term: string) => term.toLowerCase();

/**
 * Combine report terms that differ only in letter case (openFDA counts "Diarrhoea" and "DIARRHOEA" separately): counts
 * are summed per case-folded term, the label is the variant with the highest count (ties: first seen), and the list
 * is re-sorted by count, descending (ties keep first-seen order). Malformed entries are dropped. The input is the
 * stored top-N list, so a variant that fell outside it is not included in the sum. Already-merged input (the builder
 * stores `variants` with each term) keeps its spellings: they are listed with the term and its count is not split.
 */
export function mergeTermCase(raw: unknown): TopTerm[] {
  const groups = new Map<
    string,
    { order: number; total: number; spellings: Map<string, number> }
  >();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const e = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const term = typeof e?.["term"] === "string" ? e["term"].trim() : "";
    const count = e?.["count"];
    if (!term || typeof count !== "number" || !Number.isFinite(count) || count < 0) continue;
    const key = foldCase(term);
    const g = groups.get(key) ?? { order: groups.size, total: 0, spellings: new Map() };
    const stored = Array.isArray(e?.["variants"]) ? (e["variants"] as unknown[]) : [];
    for (const v of stored) {
      const spelling = typeof v === "string" ? v.trim() : "";
      if (spelling && foldCase(spelling) === key && !g.spellings.has(spelling))
        g.spellings.set(spelling, 0); // a stored variant's own count is already inside `count`
    }
    g.total += count;
    g.spellings.set(term, (g.spellings.get(term) ?? 0) + count);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.total - a.total || a.order - b.order)
    .map((g) => {
      let label = "";
      let best = -1;
      for (const [spelling, n] of g.spellings) if (n > best) [label, best] = [spelling, n];
      return { term: label, count: g.total, variants: [...g.spellings.keys()] };
    });
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const record = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number>) : {};

/** Map one stored signal record to a MassTortSignal; incomplete records yield an empty list. */
export function toSignals(item: Item): MassTortSignal[] {
  const s = item.signal;
  const l = item.litigation;
  if (!s || !l || typeof l["mdl"] !== "number") return [];
  const queries = (s["queries"] ?? {}) as Record<string, unknown>;
  return [
    {
      mdl: l["mdl"],
      title: str(l["title"]) ?? "",
      product: str(s["product"]) ?? "",
      kind: (str(s["product_kind"]) ?? "drug") as MassTortSignal["kind"],
      source: str(s["source"]) ?? "",
      sourceUrl: str(s["source_url"]) ?? "",
      caveat: str(s["caveat"]) ?? "",
      eventTotal: num(s["event_total"]),
      eventsByYear: record(s["events_by_year"]),
      breakdown: record(s["event_breakdown"]),
      breakdownError: str(s["event_breakdown_error"]),
      topTerms: mergeTermCase(s["top_terms"]),
      recallTotal: num(s["recall_total"]),
      recallBreakdown: record(s["recall_breakdown"]),
      recentRecalls: Array.isArray(s["recent_recalls"])
        ? (s["recent_recalls"] as SignalRecall[])
        : [],
      eventsQuery: str(queries["events"]),
      pending: num(l["pending"]) ?? 0,
      total: num(l["total"]) ?? 0,
      change12m: num(l["change_12m"]),
      judge: str(l["judge"]),
      district: str(l["district"]),
      series: Array.isArray(l["series"]) ? (l["series"] as MassTortSignal["series"]) : [],
    },
  ];
}

let cache: { at: number; value: MassTortSignal[] } | null = null;

export const getMassTortSignals = createServerFn({ method: "GET" }).handler(
  async (): Promise<MassTortSignal[]> => {
    if (cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.value;
    const r = await restGet<{ id: string; item: Item }[]>(
      "corpus_records?select=id,item&dataset=eq.agency_safety_mass_tort_signals&order=ordinal.asc&limit=500",
    );
    const value = r.rows.flatMap(({ item }) => toSignals(item));
    cache = { at: Date.now(), value };
    return value;
  },
);
