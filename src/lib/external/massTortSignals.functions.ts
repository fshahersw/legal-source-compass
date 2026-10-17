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
  topTerms: { term: string; count: number }[];
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

type Item = {
  signal?: Record<string, unknown>;
  litigation?: Record<string, unknown>;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const record = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number>) : {};

let cache: { at: number; value: MassTortSignal[] } | null = null;

export const getMassTortSignals = createServerFn({ method: "GET" }).handler(
  async (): Promise<MassTortSignal[]> => {
    if (cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.value;
    const r = await restGet<{ id: string; item: Item }[]>(
      "corpus_records?select=id,item&dataset=eq.agency_safety_mass_tort_signals&order=ordinal.asc&limit=500",
    );
    const value = r.rows.flatMap(({ item }) => {
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
          topTerms: Array.isArray(s["top_terms"])
            ? (s["top_terms"] as MassTortSignal["topTerms"])
            : [],
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
    });
    cache = { at: Date.now(), value };
    return value;
  },
);
