/**
 * TYPED STUB, REPLACED BY W2's IMPLEMENTATION.
 *
 * The insights data layer's server functions (src/lib/insights/insights.functions.ts, wave 1024, W2) were not in this
 * worktree when the Insights UI was built. These stubs have the call shapes the UI expects — one per read RPC in
 * src/lib/insights/contract.ts (INSIGHTS_RPC) — and reject with `InsightsLayerNotReady`, which every page shows as
 * "our metric layer is not published yet" while the bridged readers keep the pages useful.
 *
 * Integration: in src/components/insights/data.ts change the single import of this file to W2's module and map the
 * eight names below to W2's exports (same arguments, contract return types). Nothing else changes.
 */
import type {
  CrossPoint,
  EntityRef,
  EntityType,
  Fact,
  Freshness,
  Link,
  MetricDef,
} from "@/lib/insights/contract";

export class InsightsLayerNotReady extends Error {
  constructor() {
    super("The insights metric layer is not published yet.");
    this.name = "InsightsLayerNotReady";
  }
}

const notReady = async (): Promise<never> => {
  throw new InsightsLayerNotReady();
};

export type SeriesArgs = {
  metric: string;
  entityType: EntityType;
  entityIds: string[];
  from?: string | null | undefined;
  to?: string | null | undefined;
};
export type SnapshotArgs = { metric: string; entityType: EntityType; period: string };
export type LatestArgs = { metric: string; entityType: EntityType };
export type CrossArgs = {
  metricX: string;
  metricY: string;
  entityType: EntityType;
  periodX: string;
  periodY: string;
};
export type EntityArgs = { type: EntityType; id: string };
export type EntityResult = { entity: EntityRef; facts: Fact[]; children: EntityRef[] } | null;
export type LinksArgs = { type: EntityType; id: string; relation: string | null; limit: number };

export const getInsightsCatalog = (
  _: { data?: Record<string, never> } = {},
): Promise<MetricDef[]> => notReady();
export const getInsightsSeries = (_: { data: SeriesArgs }): Promise<Fact[]> => notReady();
export const getInsightsSnapshot = (_: { data: SnapshotArgs }): Promise<Fact[]> => notReady();
export const getInsightsLatest = (_: { data: LatestArgs }): Promise<Fact[]> => notReady();
export const getInsightsCross = (_: { data: CrossArgs }): Promise<CrossPoint[]> => notReady();
export const getInsightsEntity = (_: { data: EntityArgs }): Promise<EntityResult> => notReady();
export const getInsightsLinks = (_: { data: LinksArgs }): Promise<Link[]> => notReady();
export const getInsightsFreshness = (
  _: { data?: Record<string, never> } = {},
): Promise<Freshness[]> => notReady();
