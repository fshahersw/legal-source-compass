/** Court analytics read: the same three corpus reads the /courts/analytics overview uses, validated by courtStatsData. */
import { restGet } from "@/lib/external/rest.server";
import {
  CIRCUIT_ORDER,
  parseCircuit,
  parseMatrix,
  parseNational,
  type CircuitStats,
  type CourtStatsOverview,
} from "@/components/courts/courtStatsData";
import { memoAsync, READ_TTL_MS } from "./cache";

export const readCourtOverview = memoAsync<CourtStatsOverview | null>(READ_TTL_MS, async () => {
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
});
