/**
 * Federal court statistics from U.S. Courts Judicial Business tables (datasets court_stats_district_nos,
 * court_stats_district_times, court_stats_circuits, court_stats_national). Server-side reads only; stored
 * JSON is validated by the parsers in components/courts/courtStatsData (malformed rows are dropped).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import {
  parseCircuit,
  parseDistrictPanel,
  parseMatrix,
  parseNational,
  CIRCUIT_ORDER,
  type CircuitStats,
  type CourtStatsOverview,
  type DistrictPanel,
} from "@/components/courts/courtStatsData";

type CacheEntry<T> = { at: number; value: T };
const TTL = 10 * 60 * 1000;
let overviewCache: CacheEntry<CourtStatsOverview | null> | null = null;
const panelCache = new Map<string, CacheEntry<DistrictPanel | null>>();

async function loadOverview(): Promise<CourtStatsOverview | null> {
  const [national, matrix, circuits] = await Promise.all([
    restGet<{ id: string; summary: unknown }[]>(
      "corpus_records?select=id,summary:item->summary&dataset=eq.court_stats_national&id=eq.summary:national",
    ),
    restGet<{ id: string; years: unknown; rows: unknown }[]>(
      "corpus_records?select=id,years:item->years,rows:item->rows&dataset=eq.court_stats_district_nos&id=eq.summary:matrix",
    ),
    restGet<{ id: string; circuit: unknown }[]>(
      "corpus_records?select=id,circuit:item->circuit&dataset=eq.court_stats_circuits&order=id.asc",
    ),
  ]);
  const summary = parseNational(national.rows[0]?.summary);
  const m = parseMatrix(matrix.rows[0] ?? null);
  if (!summary || !m) return null;
  // The matrix and the national summary must describe the same fiscal years.
  if (m.years.join() !== summary.years.join()) return null;
  const parsed = circuits.rows
    .map((row) => parseCircuit(row.circuit))
    .filter((c): c is CircuitStats => c !== null);
  parsed.sort((a, b) => CIRCUIT_ORDER.indexOf(a.id) - CIRCUIT_ORDER.indexOf(b.id));
  return { years: m.years, national: summary, districts: m.rows, circuits: parsed };
}

export const getCourtStatsOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<CourtStatsOverview | null> => {
    if (overviewCache && Date.now() - overviewCache.at < TTL) return overviewCache.value;
    const value = await loadOverview();
    overviewCache = { at: Date.now(), value };
    return value;
  },
);

export const getCourtStatsDistrict = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(/^[a-z0-9]{2,12}$/) }).parse(d))
  .handler(async ({ data }): Promise<DistrictPanel | null> => {
    const hit = panelCache.get(data.id);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const r = await restGet<{ dataset: string; stats?: unknown; times?: unknown }[]>(
      `corpus_records?select=dataset,stats:item->stats,times:item->times&dataset=in.(court_stats_district_nos,court_stats_district_times)&id=eq.${encodeURIComponent(data.id)}`,
    );
    const stats = r.rows.find((row) => row.dataset === "court_stats_district_nos")?.stats;
    const times = r.rows.find((row) => row.dataset === "court_stats_district_times")?.times;
    const value = parseDistrictPanel(stats, times);
    panelCache.set(data.id, { at: Date.now(), value });
    return value;
  });
