/**
 * Exclusions tab trends: LEIE and SAM exclusions by year (RPC exclusions_trends_v1, database/contracts/
 * exclusions-trends-v1.sql) with a fallback to the insights LEIE national series while the RPC is not applied, and the
 * NPDB national malpractice payment series (npdb_malpractice_national, 50 rows). Read-only; memoized 10 minutes.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet, rpcPostOptional } from "./rest.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import { INSIGHTS_RPC } from "@/lib/insights/contract";
import { parseFacts } from "@/lib/insights/layer";
import { readLayer } from "@/lib/insights/layer.server";
import {
  parseExclusionTrends,
  parseNpdbNational,
  type ExclusionTrends,
  type NpdbNational,
} from "./enforcementExclusions";

export type ExclusionsPayload = {
  /** "rpc": full trends; "fallback": LEIE yearly totals from the insights layer only; "none": nothing readable. */
  basis: "rpc" | "fallback" | "none";
  trends: ExclusionTrends | null;
  leieTotals: { year: string; partial: boolean; value: number | null }[];
  npdb: NpdbNational;
};

const today = () => new Date().toISOString().slice(0, 10);

const read = memoAsync(READ_TTL_MS, async (): Promise<ExclusionsPayload> => {
  const asOf = today();
  const [rpc, npdbRows] = await Promise.all([
    rpcPostOptional<unknown>("exclusions_trends_v1", { p_as_of: asOf }),
    restGet<{ id: unknown; c: unknown; source_url: unknown }[]>(
      "corpus_records?select=id,c:item->cells,source_url&dataset=eq.npdb_malpractice_national&order=ordinal.asc&limit=500",
    ),
  ]);
  const npdb = parseNpdbNational(npdbRows.rows, asOf);
  const trends = rpc === null ? null : parseExclusionTrends(rpc);
  if (trends)
    return {
      basis: "rpc",
      trends,
      leieTotals: trends.leie.map((r) => ({ year: r.year, partial: r.partial, value: r.total })),
      npdb,
    };
  const layer = await readLayer(
    INSIGHTS_RPC.series,
    {
      p_metric: "leie_exclusions",
      p_entity_type: "nation",
      p_entity_ids: null,
      p_from: null,
      p_to: null,
    },
    parseFacts,
  ).catch(() => null);
  const facts = layer?.status === "ok" ? layer.data : [];
  const leieTotals = facts
    .map((f) => ({ year: f.periodEnd.slice(0, 4), partial: f.partial, value: f.value }))
    .sort((a, b) => a.year.localeCompare(b.year));
  return { basis: leieTotals.length ? "fallback" : "none", trends: null, leieTotals, npdb };
});

export const getExclusionsTrends = createServerFn({ method: "GET" }).handler(
  async (): Promise<ExclusionsPayload> =>
    read().catch((e: unknown) => {
      console.error("exclusions trends", e);
      throw new Error("Exclusion trends could not be read just now.");
    }),
);
