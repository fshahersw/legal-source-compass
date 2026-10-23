import { getIngestFreshness } from "@/lib/ingest/freshness.functions";

/** Freshness of every self-updating source, one request shared by every badge and the Sources-page table. */
export const freshnessQuery = {
  queryKey: ["ingest-freshness"] as const,
  queryFn: () => getIngestFreshness(),
  staleTime: 5 * 60 * 1000,
};
