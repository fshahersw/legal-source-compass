/**
 * Parsers for the insights read RPCs (database/contracts/insights-v1.sql): snake_case JSON from the database into the
 * camelCase shapes of ./contract.ts. Pure and client-safe. Stored JSON is untrusted: a row that does not match the
 * contract is dropped, never repaired; a value the database marks as not recorded stays null with its reason.
 */
import {
  ENTITY_TYPES,
  LINK_EVIDENCE,
  METRIC_FORMATS,
  PERIOD_TYPES,
  TOPICS,
  type CrossPoint,
  type EntityRef,
  type EntityType,
  type Fact,
  type Link,
  type LinkEvidence,
  type MetricDef,
  type MetricFormat,
  type PeriodType,
  type SourceLink,
  type Topic,
} from "./contract";

/** Whether the layer answered: "unavailable" when the insights SQL has not been applied (or the read failed softly). */
export type LayerResult<T> = { status: "ok"; data: T } | { status: "unavailable"; message: string };

export type EntityDetail = { entity: EntityRef; facts: Fact[]; children: EntityRef[] };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const METRIC_ID = /^[a-z][a-z0-9_]{2,63}$/;
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$/;
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s || !ISO_DATE.test(s)) return null;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s ? s : null;
};
const nullable = (v: unknown, parse: (x: unknown) => number | null): number | null | undefined =>
  v === null || v === undefined ? null : (parse(v) ?? undefined);

export const NOT_RECORDED = "Not recorded";

/** An in-app link only: a root-relative path, never an external or protocol-relative URL. */
export function inAppHref(v: unknown): string | null {
  const s = str(v);
  return s && /^\/[a-z][A-Za-z0-9/_.:-]*$/.test(s) ? s : null;
}

function sourceLink(v: unknown): SourceLink | null {
  const o = obj(v);
  const label = str(o?.["label"]);
  const url = str(o?.["url"]);
  return label && url && /^https:\/\//.test(url) ? { label, url } : null;
}

export function parseMetricDef(v: unknown): MetricDef | null {
  const o = obj(v);
  if (!o) return null;
  const id = str(o["id"]);
  const label = str(o["label"]);
  const unit = str(o["unit"]);
  const format = oneOf<MetricFormat>(METRIC_FORMATS, o["format"]);
  const topic = oneOf<Topic>(TOPICS, o["topic"]);
  const periodType = oneOf<PeriodType>(PERIOD_TYPES, o["period_type"]);
  const direction = oneOf(["higher_is_more", "higher_is_less", "neutral"] as const, o["direction"]);
  const entityTypes = arr(o["entity_types"]).map((t) => oneOf<EntityType>(ENTITY_TYPES, t));
  const numerator = str(o["numerator"]);
  const method = str(o["method"]);
  if (
    !id ||
    !METRIC_ID.test(id) ||
    !label ||
    !unit ||
    !format ||
    !topic ||
    !periodType ||
    !direction
  )
    return null;
  if (!entityTypes.length || entityTypes.some((t) => t === null) || !numerator || !method)
    return null;
  const coverage = obj(o["coverage"]);
  const count = (x: unknown) => {
    const n = num(x);
    return n !== null && Number.isInteger(n) && n >= 0 ? n : 0;
  };
  return {
    id,
    label,
    description: str(o["description"]) ?? "",
    unit,
    format,
    topic,
    entityTypes: entityTypes as EntityType[],
    periodType,
    sourceDatasets: arr(o["source_datasets"]).flatMap((d) => (str(d) ? [d as string] : [])),
    sourceLinks: arr(o["source_links"]).flatMap((l) => {
      const link = sourceLink(l);
      return link ? [link] : [];
    }),
    numerator,
    denominator: str(o["denominator"]),
    method,
    caveats: arr(o["caveats"]).flatMap((c) => (str(c) ? [c as string] : [])),
    direction,
    coverage: {
      from: str(coverage?.["from"]),
      to: str(coverage?.["to"]),
      entities: count(coverage?.["entities"]),
      facts: count(coverage?.["facts"]),
    },
    refreshedAt: str(o["refreshed_at"]),
  };
}

export function parseFact(v: unknown): Fact | null {
  const o = obj(v);
  if (!o) return null;
  const metricId = str(o["metric_id"]);
  const entityType = oneOf<EntityType>(ENTITY_TYPES, o["entity_type"]);
  const entityId = str(o["entity_id"]);
  const period = str(o["period"]);
  const periodStart = isoDate(o["period_start"]);
  const periodEnd = isoDate(o["period_end"]);
  const value = nullable(o["value"], num);
  const moe = nullable(o["moe"], (x) => {
    const n = num(x);
    return n !== null && n >= 0 ? n : null;
  });
  const n = nullable(o["n"], num);
  const reason = o["not_recorded_reason"] === null ? null : str(o["not_recorded_reason"]);
  if (
    !metricId ||
    !METRIC_ID.test(metricId) ||
    !entityType ||
    !entityId ||
    !ENTITY_ID.test(entityId) ||
    !period
  )
    return null;
  if (!periodStart || !periodEnd || periodEnd < periodStart || typeof o["partial"] !== "boolean")
    return null;
  if (value === undefined || moe === undefined || n === undefined) return null;
  // the database guarantees a value or a reason, never both and never neither
  if ((value === null) !== (reason !== null) || (moe !== null && value === null)) return null;
  return {
    metricId,
    entityType,
    entityId,
    period,
    periodStart,
    periodEnd,
    value,
    moe,
    partial: o["partial"] as boolean,
    n,
    notRecordedReason: reason,
  };
}

export function parseEntity(v: unknown): EntityRef | null {
  const o = obj(v);
  const type = oneOf<EntityType>(ENTITY_TYPES, o?.["type"]);
  const id = str(o?.["id"]);
  const label = str(o?.["label"]);
  if (!o || !type || !id || !ENTITY_ID.test(id) || !label) return null;
  const p = obj(o["parent"]);
  const parentType = oneOf<EntityType>(ENTITY_TYPES, p?.["type"]);
  const parentId = str(p?.["id"]);
  const keys: Record<string, string> = {};
  for (const [k, val] of Object.entries(obj(o["keys"]) ?? {})) {
    const s = str(val);
    if (/^[a-z_]{1,40}$/.test(k) && s) keys[k] = s;
  }
  return {
    type,
    id,
    label,
    parent: parentType && parentId ? { type: parentType, id: parentId } : null,
    keys,
    href: inAppHref(o["href"]),
  };
}

function linkEnd(v: unknown): Link["from"] | null {
  const o = obj(v);
  const type = o?.["type"] === "record" ? "record" : oneOf<EntityType>(ENTITY_TYPES, o?.["type"]);
  const id = str(o?.["id"]);
  return type && id ? { type, id } : null;
}

export function parseLink(v: unknown): Link | null {
  const o = obj(v);
  const from = linkEnd(o?.["from"]);
  const to = linkEnd(o?.["to"]);
  const relation = str(o?.["relation"]);
  const evidence = oneOf<LinkEvidence>(LINK_EVIDENCE, o?.["evidence"]);
  const sourceDataset = str(o?.["source_dataset"]);
  const sourceRecordId = str(o?.["source_record_id"]);
  if (
    !from ||
    !to ||
    !relation ||
    !/^[a-z][a-z_]{1,39}$/.test(relation) ||
    !evidence ||
    !sourceDataset ||
    !sourceRecordId
  )
    return null;
  return { from, to, relation, evidence, sourceDataset, sourceRecordId };
}

export function parseCrossPoint(v: unknown): CrossPoint | null {
  const o = obj(v);
  const entityId = str(o?.["entity_id"]);
  const label = str(o?.["label"]);
  const x = num(o?.["x"]);
  const y = num(o?.["y"]);
  const periodX = str(o?.["period_x"]);
  const periodY = str(o?.["period_y"]);
  return entityId && label && x !== null && y !== null && periodX && periodY
    ? { entityId, label, x, y, periodX, periodY }
    : null;
}

const listOf =
  <T>(parse: (v: unknown) => T | null) =>
  (raw: unknown): T[] =>
    arr(raw).flatMap((v) => {
      const p = parse(v);
      return p ? [p] : [];
    });

export const parseCatalog = listOf(parseMetricDef);
export const parseFacts = listOf(parseFact);
export const parseEntities = listOf(parseEntity);
export const parseLinks = listOf(parseLink);
export const parseCross = listOf(parseCrossPoint);

/** insights_entity_v1: null when the entity is not in the spine (or the payload does not parse). */
export function parseEntityDetail(raw: unknown): EntityDetail | null {
  const o = obj(raw);
  const entity = parseEntity(o?.["entity"]);
  if (!o || !entity) return null;
  return { entity, facts: parseFacts(o["facts"]), children: parseEntities(o["children"]) };
}

/** The display text of a fact's value position: the reason when the value is not recorded. */
export function factReason(f: Pick<Fact, "value" | "notRecordedReason">): string | null {
  return f.value === null ? (f.notRecordedReason ?? NOT_RECORDED) : null;
}
