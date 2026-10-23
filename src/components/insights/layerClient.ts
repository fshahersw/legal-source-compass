/**
 * The live insights data layer as the Insights pages read it: the read RPCs of src/lib/insights/contract.ts through
 * the layer's server functions (src/lib/insights/insights.functions.ts) and the self-updating sources' freshness
 * (src/lib/ingest/freshness.functions.ts). A layer that answers "unavailable" (its SQL not installed) rejects with
 * `InsightsLayerNotReady`, which the pages show as "our metric layer is not published yet"; any other failure rejects
 * with its own error.
 */
import {
  getInsightsCatalog,
  getInsightsCross,
  getInsightsEntity,
  getInsightsLatest,
  getInsightsLinks,
  getInsightsSeries,
  getInsightsSnapshot,
} from "@/lib/insights/insights.functions";
import type { LayerResult } from "@/lib/insights/layer";
import { getIngestFreshness } from "@/lib/ingest/freshness.functions";
import type { Fact } from "@/lib/insights/contract";
import type { InsightsLayer } from "./types";

export class InsightsLayerNotReady extends Error {
  constructor() {
    super("The insights metric layer is not published yet.");
    this.name = "InsightsLayerNotReady";
  }
}

function unwrap<T>(result: LayerResult<T>): T {
  if (result.status === "ok") return result.data;
  throw new InsightsLayerNotReady();
}

/** The series read takes at most this many entity ids per call. */
export const SERIES_IDS_PER_CALL = 500;

export const liveLayer: InsightsLayer = {
  catalog: async () => unwrap(await getInsightsCatalog()),
  series: async ({ metric, entityType, entityIds, from, to }) => {
    if (!entityIds.length) return [];
    const chunks: string[][] = [];
    for (let i = 0; i < entityIds.length; i += SERIES_IDS_PER_CALL)
      chunks.push(entityIds.slice(i, i + SERIES_IDS_PER_CALL));
    const parts = await Promise.all(
      chunks.map(async (ids) =>
        unwrap(
          await getInsightsSeries({
            data: {
              metric,
              entityType,
              entityIds: ids,
              from: from ?? undefined,
              to: to ?? undefined,
            },
          }),
        ),
      ),
    );
    return parts.flat() as Fact[];
  },
  snapshot: async (data) => unwrap(await getInsightsSnapshot({ data })),
  latest: async (data) => unwrap(await getInsightsLatest({ data })),
  cross: async (data) => unwrap(await getInsightsCross({ data })),
  entity: async (data) => unwrap(await getInsightsEntity({ data })),
  links: async ({ type, id, relation, limit }) =>
    unwrap(await getInsightsLinks({ data: { type, id, relation: relation ?? undefined, limit } })),
  freshness: async () => {
    const result = await getIngestFreshness();
    if (result.ledger === "not_installed") throw new InsightsLayerNotReady();
    return result.rows;
  },
};
