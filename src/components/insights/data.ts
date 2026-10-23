/**
 * The Insights pages' one data adapter. Every number a page shows comes through here, from one of:
 *
 * - the insights data layer (contract src/lib/insights/contract.ts; server functions by W2). Until W2's module lands,
 *   `./layerStub` stands in and reports "not published yet" (see that file for the one-line swap);
 * - bridged existing, tested readers (state metrics, MDL reports): `./bridge/*`, ids with a dot ("sm.", "mdl.");
 * - dev-only fixtures, when the dev server runs with VITE_INSIGHTS_FIXTURES=1 (fixtureMode.ts); never in production.
 *
 * Results are contract shapes (MetricDef, Fact, CrossPoint), so a page does not care where a metric comes from.
 */
import type { CrossPoint, EntityType, Fact, Freshness, MetricDef } from "@/lib/insights/contract";
import { STATES } from "@/lib/corpus/geo";
import { getStateMetrics, type StateMetricsBundle } from "@/lib/external/stateMetrics.functions";
import { getMdlAnalytics, type MdlAnalytics } from "@/lib/external/mdlAnalytics.functions";
import { comparePeriods, densePeriods } from "@/components/charts/format";
import { getDailyInsights } from "@/lib/insights/insights.functions";
import {
  getInsightsCatalog,
  getInsightsCross,
  getInsightsEntity,
  getInsightsFreshness,
  getInsightsLatest,
  getInsightsLinks,
  getInsightsSeries,
  getInsightsSnapshot,
  InsightsLayerNotReady,
} from "./layerStub"; // REPLACE with W2's module ("@/lib/insights/insights.functions") when it lands.
import { INSIGHTS_FIXTURES } from "./fixtureMode";
import {
  NATION_ID,
  STATE_METRIC_PREFIX,
  latestCompleteYear,
  stateMetricDefs,
  stateMetricFacts,
} from "./bridge/stateMetrics";
import { MDL_METRIC_PREFIX, mdlFacts, mdlHref, mdlLabel, mdlMetricDefs } from "./bridge/mdl";
import type { CatalogResult, EntityLabel, EventStudy, InsightsLayer, MetricOrigin } from "./types";

export { getDailyInsights };

// ------------------------------------------------------------------------------------------------ providers

const realLayer: InsightsLayer = {
  catalog: () => getInsightsCatalog(),
  series: (data) => getInsightsSeries({ data }),
  snapshot: (data) => getInsightsSnapshot({ data }),
  latest: (data) => getInsightsLatest({ data }),
  cross: (data) => getInsightsCross({ data }),
  entity: (data) => getInsightsEntity({ data }),
  links: (data) => getInsightsLinks({ data }),
  freshness: () => getInsightsFreshness(),
};

/** The data layer provider: the dev fixtures when they are switched on (dev server only), else the real layer. */
async function layer(): Promise<InsightsLayer> {
  if (INSIGHTS_FIXTURES) return (await import("./fixtures")).fixtureLayer;
  return realLayer;
}

export const fixturesOn = INSIGHTS_FIXTURES;

const TTL = 10 * 60 * 1000;
function memo<T>(load: () => Promise<T>): () => Promise<T> {
  let hit: { at: number; value: Promise<T> } | null = null;
  return () => {
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const value = load().catch((e: unknown) => {
      hit = null;
      throw e;
    });
    hit = { at: Date.now(), value };
    return value;
  };
}

export const stateBundle = memo<StateMetricsBundle>(() => getStateMetrics());
export const mdlData = memo<MdlAnalytics | null>(() => getMdlAnalytics());

export const isBridgeMetric = (id: string) => id.includes(".");
const isStateBridge = (id: string) => id.startsWith(STATE_METRIC_PREFIX);
const isMdlBridge = (id: string) => id.startsWith(MDL_METRIC_PREFIX);

// ------------------------------------------------------------------------------------------------ reads

export async function loadCatalog(): Promise<CatalogResult> {
  const lay = await layer();
  const [layerRes, stateRes, mdlRes] = await Promise.allSettled([
    lay.catalog(),
    stateBundle(),
    mdlData(),
  ]);
  const metrics: MetricDef[] = [];
  const origin: Record<string, MetricOrigin> = {};
  const bridgeFailures: string[] = [];
  let layerState: CatalogResult["layer"] = "ready";
  if (layerRes.status === "fulfilled") {
    for (const m of layerRes.value) {
      metrics.push(m);
      origin[m.id] = INSIGHTS_FIXTURES ? "fixture" : "layer";
    }
  } else layerState = layerRes.reason instanceof InsightsLayerNotReady ? "not_ready" : "failed";
  if (stateRes.status === "fulfilled")
    for (const m of stateMetricDefs(stateRes.value)) {
      metrics.push(m);
      origin[m.id] = "bridge";
    }
  else bridgeFailures.push("State metrics");
  if (mdlRes.status === "fulfilled" && mdlRes.value)
    for (const m of mdlMetricDefs(mdlRes.value)) {
      metrics.push(m);
      origin[m.id] = "bridge";
    }
  else bridgeFailures.push("MDL reports");
  if (!metrics.length && layerState !== "ready" && bridgeFailures.length === 2)
    throw new Error("No metric source could be read.");
  return { metrics, origin, layer: layerState, bridgeFailures, fixtures: INSIGHTS_FIXTURES };
}

export async function loadSeries(
  metric: MetricDef,
  entityType: EntityType,
  entityIds: readonly string[],
  from?: string | null,
  to?: string | null,
): Promise<Fact[]> {
  if (!entityIds.length) return [];
  if (isStateBridge(metric.id) && (entityType === "state" || entityType === "nation"))
    return stateMetricFacts(await stateBundle(), metric.id, entityType, { entityIds, from, to });
  if (isMdlBridge(metric.id)) {
    const d = await mdlData();
    return d ? mdlFacts(d, metric.id, { entityIds, from, to }) : [];
  }
  return (await layer()).series({
    metric: metric.id,
    entityType,
    entityIds: [...entityIds],
    from,
    to,
  });
}

export async function loadSnapshot(
  metric: MetricDef,
  entityType: EntityType,
  period: string,
): Promise<Fact[]> {
  if (isStateBridge(metric.id) && (entityType === "state" || entityType === "nation"))
    return stateMetricFacts(await stateBundle(), metric.id, entityType, { period });
  if (isMdlBridge(metric.id)) {
    const d = await mdlData();
    return d ? mdlFacts(d, metric.id, { period }) : [];
  }
  return (await layer()).snapshot({ metric: metric.id, entityType, period });
}

/** Every period a metric has for an entity type, oldest first. */
export async function loadPeriods(metric: MetricDef, entityType: EntityType): Promise<string[]> {
  if (isMdlBridge(metric.id)) {
    const d = await mdlData();
    if (!d) return [];
    return [...new Set(d.mdls.flatMap((r) => r.series.map((p) => p.date)))].sort(comparePeriods);
  }
  const { from, to } = metric.coverage;
  if (from && to && ["year", "fiscal_year", "quarter", "month"].includes(metric.periodType))
    return densePeriods([from, to], metric.periodType);
  // No fixed cadence: the periods the layer returns for the nation or for each entity's latest value.
  const lay = await layer();
  const latest = await lay.latest({ metric: metric.id, entityType });
  return [
    ...new Set([...(from ? [from] : []), ...latest.map((f) => f.period), ...(to ? [to] : [])]),
  ].sort(comparePeriods);
}

/** The latest complete period most entities record (the default period of a ranking or a scatter). */
export async function defaultPeriod(
  metric: MetricDef,
  entityType: EntityType,
): Promise<string | null> {
  if (isStateBridge(metric.id)) return latestCompleteYear(await stateBundle(), metric.id);
  if (isMdlBridge(metric.id)) {
    const d = await mdlData();
    return d?.overview.as_of ?? null;
  }
  const latest = await (await layer()).latest({ metric: metric.id, entityType });
  const counts = new Map<string, number>();
  for (const f of latest) counts.set(f.period, (counts.get(f.period) ?? 0) + 1);
  return (
    [...counts.entries()].sort((a, b) => b[1] - a[1] || comparePeriods(b[0], a[0]))[0]?.[0] ?? null
  );
}

/** Paired values for two metrics, joined on the exact entity id (never by name). */
export async function loadCross(
  x: MetricDef,
  y: MetricDef,
  entityType: EntityType,
  periodX: string,
  periodY: string,
): Promise<CrossPoint[]> {
  if (!isBridgeMetric(x.id) && !isBridgeMetric(y.id))
    return (await layer()).cross({ metricX: x.id, metricY: y.id, entityType, periodX, periodY });
  const [fx, fy] = await Promise.all([
    loadSnapshot(x, entityType, periodX),
    loadSnapshot(y, entityType, periodY),
  ]);
  return joinCross(fx, fy, periodX, periodY);
}

export function joinCross(
  fx: readonly Fact[],
  fy: readonly Fact[],
  periodX: string,
  periodY: string,
): CrossPoint[] {
  const ys = new Map(
    fy.filter((f) => f.value !== null).map((f) => [f.entityId, f.value as number] as const),
  );
  return fx.flatMap((f) => {
    const yv = ys.get(f.entityId);
    return f.value !== null && yv !== undefined
      ? [{ entityId: f.entityId, label: f.entityId, x: f.value, y: yv, periodX, periodY }]
      : [];
  });
}

const STATE_NAME = new Map(STATES.map((s) => [s.usps, s.name] as const));

/** Display names for entity ids: exact lookups only; an id without a known name is shown as the id itself. */
export async function loadEntityLabels(
  entityType: EntityType,
  ids: readonly string[],
): Promise<Map<string, EntityLabel>> {
  const out = new Map<string, EntityLabel>();
  if (entityType === "state") {
    for (const id of ids)
      out.set(id, {
        id,
        label: STATE_NAME.get(id) ?? id,
        href: STATE_NAME.has(id) ? `/places/${id}` : null,
      });
    return out;
  }
  if (entityType === "nation") {
    for (const id of ids)
      out.set(id, { id, label: id === NATION_ID ? "United States" : id, href: null });
    return out;
  }
  if (entityType === "mdl") {
    const d = await mdlData();
    const rows = new Map((d?.mdls ?? []).map((r) => [String(r.mdl), r] as const));
    for (const id of ids) {
      const r = rows.get(id);
      out.set(id, {
        id,
        label: r ? mdlLabel(r) : `MDL ${id}`,
        href: /^\d+$/.test(id) ? mdlHref(Number(id)) : null,
      });
    }
    return out;
  }
  const lay = await layer();
  const unique = [...new Set(ids)].slice(0, 80);
  const results = await Promise.allSettled(
    unique.map((id) => lay.entity({ type: entityType, id })),
  );
  results.forEach((r, i) => {
    const id = unique[i]!;
    const e = r.status === "fulfilled" ? r.value?.entity : null;
    out.set(id, { id, label: e?.label ?? id, href: e?.href ?? null });
  });
  for (const id of ids) if (!out.has(id)) out.set(id, { id, label: id, href: null });
  return out;
}

/** Entity ids a metric has facts for (for pickers). */
export async function loadEntityIds(metric: MetricDef, entityType: EntityType): Promise<string[]> {
  if (entityType === "state") return STATES.map((s) => s.usps);
  if (entityType === "nation") return [NATION_ID];
  if (isMdlBridge(metric.id)) {
    const d = await mdlData();
    return (d?.mdls ?? []).map((r) => String(r.mdl));
  }
  const latest = await (await layer()).latest({ metric: metric.id, entityType });
  return [...new Set(latest.map((f) => f.entityId))];
}

export async function loadEventStudy(): Promise<EventStudy | null> {
  const lay = await layer();
  if (!lay.eventStudy) throw new InsightsLayerNotReady();
  return lay.eventStudy();
}

export async function loadFreshness(): Promise<Freshness[]> {
  return (await layer()).freshness();
}

// ------------------------------------------------------------------------------------------------ query options

const K = INSIGHTS_FIXTURES ? "fixtures" : "live";
const STALE = 10 * 60 * 1000;

export const catalogQuery = {
  queryKey: ["insights", K, "catalog"] as const,
  queryFn: loadCatalog,
  staleTime: STALE,
  retry: 1,
};

export const seriesQuery = (
  metric: MetricDef | undefined,
  entityType: EntityType,
  ids: readonly string[],
  from?: string | null,
  to?: string | null,
) => ({
  queryKey: [
    "insights",
    K,
    "series",
    metric?.id ?? "",
    entityType,
    [...ids].sort().join(","),
    from ?? "",
    to ?? "",
  ] as const,
  queryFn: () => loadSeries(metric!, entityType, ids, from, to),
  enabled: !!metric && ids.length > 0,
  staleTime: STALE,
  retry: 1,
});

export const snapshotQuery = (
  metric: MetricDef | undefined,
  entityType: EntityType,
  period: string | null,
) => ({
  queryKey: ["insights", K, "snapshot", metric?.id ?? "", entityType, period ?? ""] as const,
  queryFn: () => loadSnapshot(metric!, entityType, period!),
  enabled: !!metric && !!period,
  staleTime: STALE,
  retry: 1,
});

export const periodsQuery = (metric: MetricDef | undefined, entityType: EntityType) => ({
  queryKey: ["insights", K, "periods", metric?.id ?? "", entityType] as const,
  queryFn: async () => ({
    periods: await loadPeriods(metric!, entityType),
    fallback: await defaultPeriod(metric!, entityType),
  }),
  enabled: !!metric,
  staleTime: STALE,
  retry: 1,
});

export const labelsQuery = (entityType: EntityType, ids: readonly string[]) => ({
  queryKey: ["insights", K, "labels", entityType, [...ids].sort().join(",")] as const,
  queryFn: () => loadEntityLabels(entityType, ids),
  enabled: ids.length > 0,
  staleTime: STALE,
});

export const eventStudyQuery = {
  queryKey: ["insights", K, "event-study"] as const,
  queryFn: loadEventStudy,
  staleTime: STALE,
  retry: 0,
};

export const mdlQuery = {
  queryKey: ["insights", "mdl-analytics"] as const,
  queryFn: mdlData,
  staleTime: STALE,
  retry: 1,
};

export const stateBundleQuery = {
  queryKey: ["insights", "state-metrics"] as const,
  queryFn: stateBundle,
  staleTime: STALE,
  retry: 1,
};

export { InsightsLayerNotReady };
