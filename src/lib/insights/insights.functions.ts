/**
 * Insights server functions.
 *
 * 1. `getDailyInsights({ data: { section? } })` — the daily insight cards. Reads only what the requested section needs
 *    (sources run in parallel, each memoized for 10 minutes), builds the section's candidate pool, and returns today's
 *    pick for the UTC day the server clock is in. Deterministic and number-backed: no model is called.
 * 2. The metric layer (insights/1, database/contracts/insights-v1.sql): catalog, series, snapshot, latest, cross,
 *    entity and links, through the read RPCs of contract.ts INSIGHTS_RPC. Each returns a LayerResult: "unavailable"
 *    when the insights SQL is not installed yet (never an empty list pretending to be data). Successful reads are
 *    memoized for 10 minutes per input; failures throw and are not cached.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ENTITY_TYPES,
  INSIGHTS_RPC,
  type CrossPoint,
  type Fact,
  type Link,
  type MetricDef,
} from "./contract";
import {
  parseCatalog,
  parseCross,
  parseEntityDetail,
  parseFacts,
  parseLinks,
  type EntityDetail,
  type LayerResult,
} from "./layer";
import { readLayer } from "./layer.server";
import {
  buildPool,
  failedSection,
  sectionForDay,
  type SectionPool,
  type SourceOutcome,
} from "./pipeline";
import { READ_TTL_MS } from "./readers/cache";
import { SECTIONS, type SectionDef } from "./registry";
import { utcDayKey } from "./rotation";
import type { DailyInsights } from "./types";

const poolCache = new Map<string, { at: number; value: SectionPool }>();

async function poolFor(def: SectionDef): Promise<SectionPool> {
  const hit = poolCache.get(def.id);
  if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.value;
  const settled = await Promise.allSettled(def.sources.map((s) => s.run()));
  const outcomes: SourceOutcome[] = settled.map((r, i) => {
    const id = def.sources[i]!.id;
    if (r.status === "fulfilled") return { id, ok: true, insights: r.value };
    console.error(
      `Insight source ${id} failed: ${r.reason instanceof Error ? r.reason.message : "unknown error"}`,
    );
    return { id, ok: false, error: "read failed" };
  });
  const value = buildPool(def.id, outcomes);
  // A partial pool is not cached, so the next request retries the failed source.
  if (!value.partial) poolCache.set(def.id, { at: Date.now(), value });
  return value;
}

export const getDailyInsights = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        section: z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,31}$/)
          .optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<DailyInsights> => {
    const dayKey = utcDayKey(new Date());
    if (data.section) {
      const def = SECTIONS.find((s) => s.id === data.section);
      if (!def) throw new Error("Unknown insight section.");
      return { dayKey, sections: [sectionForDay(def, await poolFor(def), dayKey)] };
    }
    const sections = await Promise.all(
      SECTIONS.map(async (def) => {
        try {
          return sectionForDay(def, await poolFor(def), dayKey);
        } catch {
          return failedSection(def);
        }
      }),
    );
    return { dayKey, sections };
  });

// ------------------------------------------------------------------------------------------------ metric layer

const metricId = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/);
const entityType = z.enum(ENTITY_TYPES);
const entityId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$/);
const periodKey = z.string().regex(/^[A-Za-z0-9-]{1,20}$/);

export const getInsightsCatalog = createServerFn({ method: "GET" }).handler(
  (): Promise<LayerResult<MetricDef[]>> => readLayer(INSIGHTS_RPC.catalog, {}, parseCatalog),
);

export const getInsightsSeries = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        metric: metricId,
        entityType,
        entityIds: z.array(entityId).min(1).max(500).optional(),
        from: periodKey.optional(),
        to: periodKey.optional(),
      })
      .parse(d),
  )
  .handler(({ data }): Promise<LayerResult<Fact[]>> =>
    readLayer(
      INSIGHTS_RPC.series,
      {
        p_metric: data.metric,
        p_entity_type: data.entityType,
        p_entity_ids: data.entityIds ?? null,
        p_from: data.from ?? null,
        p_to: data.to ?? null,
      },
      parseFacts,
    ),
  );

export const getInsightsSnapshot = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ metric: metricId, entityType, period: periodKey }).parse(d),
  )
  .handler(({ data }): Promise<LayerResult<Fact[]>> =>
    readLayer(
      INSIGHTS_RPC.snapshot,
      { p_metric: data.metric, p_entity_type: data.entityType, p_period: data.period },
      parseFacts,
    ),
  );

export const getInsightsLatest = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ metric: metricId, entityType }).parse(d))
  .handler(({ data }): Promise<LayerResult<Fact[]>> =>
    readLayer(
      INSIGHTS_RPC.latest,
      { p_metric: data.metric, p_entity_type: data.entityType },
      parseFacts,
    ),
  );

export const getInsightsCross = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        metricX: metricId,
        metricY: metricId,
        entityType,
        periodX: periodKey,
        periodY: periodKey,
      })
      .parse(d),
  )
  .handler(({ data }): Promise<LayerResult<CrossPoint[]>> =>
    readLayer(
      INSIGHTS_RPC.cross,
      {
        p_metric_x: data.metricX,
        p_metric_y: data.metricY,
        p_entity_type: data.entityType,
        p_period_x: data.periodX,
        p_period_y: data.periodY,
      },
      parseCross,
    ),
  );

/** `data` is null when the entity is not in the spine. */
export const getInsightsEntity = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ type: entityType, id: entityId }).parse(d))
  .handler(({ data }): Promise<LayerResult<EntityDetail | null>> =>
    readLayer(INSIGHTS_RPC.entity, { p_type: data.type, p_id: data.id }, parseEntityDetail),
  );

export const getInsightsLinks = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        type: z.union([entityType, z.literal("record")]),
        id: z.string().min(1).max(160),
        relation: z
          .string()
          .regex(/^[a-z][a-z_]{1,39}$/)
          .optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      })
      .parse(d),
  )
  .handler(({ data }): Promise<LayerResult<Link[]>> =>
    readLayer(
      INSIGHTS_RPC.links,
      {
        p_type: data.type,
        p_id: data.id,
        p_relation: data.relation ?? null,
        p_limit: data.limit ?? 200,
      },
      parseLinks,
    ),
  );
