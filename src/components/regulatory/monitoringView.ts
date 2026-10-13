import {
  REGULATORY_EVENT_TYPES,
  REGULATORY_SOURCE_IDS,
  type RegulatoryQuery,
} from "@/lib/regulatory/types";

export const MONITORING_VIEWS = [
  "analytics",
  "signals",
  "trends",
  "entities",
  "investigations",
  "coverage",
] as const;
export type MonitoringView = (typeof MONITORING_VIEWS)[number];
export const PAGE_SIZE = 25;
export function quickTrendWindow(days: 7 | 30 | 90, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return {
    from: new Date(end.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}
export type MonitoringSearch = {
  view: MonitoringView;
  page: number;
  q?: string | undefined;
  source?: string | undefined;
  sourceFamily?: "fda" | "nhtsa" | "cpsc" | "federal_register" | undefined;
  eventType?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  dateBasis: "detected" | "published";
  entityNamespace?: string | undefined;
  entityId?: string | undefined;
  recordSource?: string | undefined;
  recordId?: string | undefined;
  eventId?: string | undefined;
  analyticsPeriod?: "30d" | "90d" | "1y" | "2y" | "custom" | undefined;
  analyticsInterval?: "day" | "week" | "month" | undefined;
  analyticsDomain?:
    | "overview"
    | "devices"
    | "drugs"
    | "food"
    | "cosmetics"
    | "veterinary"
    | "tobacco"
    | "transparency"
    | "catalog"
    | undefined;
  analyticsFrom?: string | undefined;
  analyticsTo?: string | undefined;
};

const bounded = (value: unknown, max: number) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= max
    ? value.trim()
    : undefined;

export function calendarDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

export function normalizeMonitoringSearch(raw: Record<string, unknown>): MonitoringSearch {
  const page = Number(raw["page"] ?? 1);
  return {
    view: MONITORING_VIEWS.includes(raw["view"] as MonitoringView)
      ? (raw["view"] as MonitoringView)
      : "analytics",
    page: Number.isSafeInteger(page) && page >= 1 && page <= 401 ? page : 1,
    q: bounded(raw["q"], 300),
    source: REGULATORY_SOURCE_IDS.includes(raw["source"] as never)
      ? String(raw["source"])
      : undefined,
    sourceFamily: ["fda", "nhtsa", "cpsc", "federal_register"].includes(
      raw["sourceFamily"] as string,
    )
      ? (raw["sourceFamily"] as MonitoringSearch["sourceFamily"])
      : undefined,
    eventType: REGULATORY_EVENT_TYPES.includes(raw["eventType"] as never)
      ? String(raw["eventType"])
      : undefined,
    from: calendarDate(raw["from"]),
    to: calendarDate(raw["to"]),
    dateBasis: raw["dateBasis"] === "published" ? "published" : "detected",
    entityNamespace: bounded(raw["entityNamespace"], 100),
    entityId: bounded(raw["entityId"], 300),
    recordSource: REGULATORY_SOURCE_IDS.includes(raw["recordSource"] as never)
      ? String(raw["recordSource"])
      : undefined,
    recordId: bounded(raw["recordId"], 500),
    eventId:
      typeof raw["eventId"] === "string" && /^[a-f0-9]{64}$/.test(raw["eventId"])
        ? raw["eventId"]
        : undefined,
    analyticsPeriod: ["30d", "90d", "1y", "2y", "custom"].includes(raw["analyticsPeriod"] as string)
      ? (raw["analyticsPeriod"] as MonitoringSearch["analyticsPeriod"])
      : undefined,
    analyticsInterval: ["day", "week", "month"].includes(raw["analyticsInterval"] as string)
      ? (raw["analyticsInterval"] as MonitoringSearch["analyticsInterval"])
      : undefined,
    analyticsDomain: [
      "overview",
      "devices",
      "drugs",
      "food",
      "cosmetics",
      "veterinary",
      "tobacco",
      "transparency",
      "catalog",
    ].includes(raw["analyticsDomain"] as string)
      ? (raw["analyticsDomain"] as MonitoringSearch["analyticsDomain"])
      : undefined,
    analyticsFrom: calendarDate(raw["analyticsFrom"]),
    analyticsTo: calendarDate(raw["analyticsTo"]),
  };
}

export function monitoringQuery(search: MonitoringSearch): RegulatoryQuery {
  return {
    ...(search.q ? { q: search.q } : {}),
    ...(search.source ? { source: search.source as NonNullable<RegulatoryQuery["source"]> } : {}),
    ...(search.sourceFamily ? { sourceFamily: search.sourceFamily } : {}),
    ...(search.eventType
      ? { eventType: search.eventType as NonNullable<RegulatoryQuery["eventType"]> }
      : {}),
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
    dateBasis: search.dateBasis,
    ...(search.entityNamespace ? { entityNamespace: search.entityNamespace } : {}),
    ...(search.entityId ? { entityId: search.entityId } : {}),
    limit: PAGE_SIZE,
    offset: (search.page - 1) * PAGE_SIZE,
  };
}

export const EVENT_LABELS: Record<string, string> = {
  initial_record: "Initial capture",
  backfill: "Historical backfill",
  new_record: "Newly observed",
  record_changed: "Source changed",
  correction: "Source correction",
};

export function queryLabels(query: RegulatoryQuery): string[] {
  return [
    query.q ? `Text: ${query.q}` : null,
    query.source ? `Source: ${query.source.replaceAll("_", " ")}` : null,
    query.sourceFamily ? `Source family: ${query.sourceFamily.replaceAll("_", " ")}` : null,
    query.eventType ? EVENT_LABELS[query.eventType] : null,
    query.from ? `From: ${query.from}` : null,
    query.to ? `To: ${query.to}` : null,
    `Date basis: ${query.dateBasis === "published" ? "publisher date" : query.dateBasis === "detected" ? "first detected" : query.from || query.to ? "awaiting clarification" : "first detected (default)"}`,
    query.entityNamespace && query.entityId
      ? `Exact entity: ${query.entityNamespace} / ${query.entityId}`
      : null,
  ].filter((value): value is string => !!value);
}

export function changeMonitoringFilters(
  current: MonitoringSearch,
  filters: Partial<MonitoringSearch>,
): MonitoringSearch {
  return normalizeMonitoringSearch({
    ...current,
    ...filters,
    page: 1,
    recordSource: undefined,
    recordId: undefined,
    eventId: undefined,
  });
}

export function publicSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function displayDate(value: string | null | undefined): string {
  return value || "Not recorded";
}

export function displayCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value.toLocaleString("en-US")
    : "Not recorded";
}

export function valueText(value: unknown): string {
  if (value === null || value === undefined) return "Not recorded";
  if (typeof value === "string") return value || "Empty source value";
  return JSON.stringify(value, null, 2);
}
