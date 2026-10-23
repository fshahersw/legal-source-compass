/**
 * Server function behind the "Updated <date>" badges and the Sources-page freshness table: reads
 * public.insights_freshness_v1 (read-only, service role, server side only), validates every row against the contract and
 * names the sources. A missing RPC (the ingest SQL not applied yet) is reported as `not_installed`, never as an error.
 * Memoized for one minute per server instance.
 */
import { createServerFn } from "@tanstack/react-start";
import { rpcPostOptional } from "@/lib/external/rest.server";
import { INSIGHTS_RPC } from "@/lib/insights/contract";
import { parseFreshness, withLabels, type FreshnessResult } from "./freshness";

const TTL_MS = 60 * 1000;
let cached: { at: number; value: FreshnessResult } | null = null;

export const getIngestFreshness = createServerFn({ method: "GET" }).handler(
  async (): Promise<FreshnessResult> => {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
    const raw = await rpcPostOptional<unknown>(INSIGHTS_RPC.freshness, {});
    const value: FreshnessResult =
      raw === null
        ? { ledger: "not_installed", rows: [] }
        : { ledger: "installed", rows: withLabels(parseFreshness(raw)) };
    cached = { at: Date.now(), value };
    return value;
  },
);
