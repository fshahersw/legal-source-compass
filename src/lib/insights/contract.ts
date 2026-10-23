/**
 * Insights data layer contract (insights/1).
 *
 * Shared by the database layer (schema `insights`, read RPCs `insights_*_v1` in database/contracts/insights-v1.sql),
 * the server functions in src/lib/insights/*.functions.ts and every chart that shows a metric. Every value a chart
 * shows is a fact row computed by a tested refresh function from corpus records (or a deterministic, tested
 * derivation from fact rows, such as a correlation); nothing is estimated, interpolated or projected. A value the
 * source does not give is `null` with a reason, never 0.
 *
 * Owner decision 2026-10-23 (evening): our own metric layer on top of the corpus, self-updating, used across the
 * platform. This file is the single source of the shapes; change it only with the lead.
 */

/** What a fact is about. The hierarchy (`parent`) is nation › state › county, circuit › district court, etc. */
export const ENTITY_TYPES = [
  "nation",
  "state",
  "county",
  "circuit",
  "court",
  "judge",
  "mdl",
  "company",
  "firm",
  "agency",
  "product",
  "law_unit",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** How a period is keyed. Periods of different types are never mixed in one series. */
export const PERIOD_TYPES = [
  "year", // "2024" — calendar year
  "fiscal_year", // "FY2024" — federal fiscal year ending September 30
  "quarter", // "2024-Q3"
  "month", // "2024-06"
  "twelve_months_ending", // "2024-06-30" — a 12-month period ending on that date (U.S. Courts tables)
  "snapshot", // "2026-10-01" — a count as of a date (e.g. pending actions)
] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];

export const METRIC_FORMATS = [
  "count",
  "rate_per_100k",
  "percent",
  "currency_usd",
  "months",
  "days",
  "ratio",
] as const;
export type MetricFormat = (typeof METRIC_FORMATS)[number];

export const TOPICS = [
  "places",
  "courts",
  "litigation",
  "law",
  "enforcement",
  "safety",
  "companies",
  "government",
] as const;
export type Topic = (typeof TOPICS)[number];

export type SourceLink = { label: string; url: string };

/** One row of the metric registry (insights.metrics). */
export type MetricDef = {
  /** Stable id, e.g. "fjc_civil_filed", "cfpb_complaints_per_100k". */
  id: string;
  /** Says what is counted, e.g. "Federal civil cases filed". */
  label: string;
  description: string;
  /** Plain unit, e.g. "cases", "complaints per 100,000 residents", "months". */
  unit: string;
  format: MetricFormat;
  topic: Topic;
  /** Entity types this metric has facts for. */
  entityTypes: EntityType[];
  periodType: PeriodType;
  /** corpus dataset ids the refresh function reads. */
  sourceDatasets: string[];
  sourceLinks: SourceLink[];
  /** What is counted, in words a reader can check against the source. */
  numerator: string;
  /** For rates: the denominator and its source and year (e.g. "Census Population Estimates, July 1 of the same year"). */
  denominator: string | null;
  /** How the value is derived (deterministic). */
  method: string;
  /** Reading notes: reporting changes, partial periods, what an empty period means. */
  caveats: string[];
  /** Whether a higher value reads as more of something (for colour direction); never a judgment. */
  direction: "higher_is_more" | "higher_is_less" | "neutral";
  /** Coverage as computed by the last refresh. */
  coverage: { from: string | null; to: string | null; entities: number; facts: number };
  refreshedAt: string | null;
};

/** One fact (insights.facts). `value` null means the source does not give it for this entity and period. */
export type Fact = {
  metricId: string;
  entityType: EntityType;
  entityId: string;
  period: string;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  value: number | null;
  /** Margin of error as published (Census), else null. */
  moe: number | null;
  /** True for a period still in progress or only partly covered by the source. */
  partial: boolean;
  /** Count behind a rate or median when the source gives it, else null. */
  n: number | null;
  notRecordedReason: string | null;
};

/** One entity of the shared spine (insights.entities). */
export type EntityRef = {
  type: EntityType;
  id: string;
  label: string;
  parent: { type: EntityType; id: string } | null;
  /** Published identifiers, e.g. { fips: "06037", usps: "CA" }, { cik: "0000078003" }, { court_id: "cand" }. */
  keys: Record<string, string>;
  /** In-app page for the entity, if one exists. */
  href: string | null;
};

/** How a link was established. Never fuzzy: an inferred or similarity-based match is not a link. */
export const LINK_EVIDENCE = ["exact_id", "exact_name_in_context", "publisher_stated"] as const;
export type LinkEvidence = (typeof LINK_EVIDENCE)[number];

/** One typed link between entities or records (insights.links). */
export type Link = {
  from: { type: EntityType | "record"; id: string };
  to: { type: EntityType | "record"; id: string };
  /** e.g. "located_in", "sits_in", "presides_over", "named_in", "cites", "regulated_by", "recalled_by". */
  relation: string;
  evidence: LinkEvidence;
  sourceDataset: string;
  sourceRecordId: string;
};

/** A paired observation for cross-metric analysis (insights_cross_v1). */
export type CrossPoint = {
  entityId: string;
  label: string;
  x: number;
  y: number;
  periodX: string;
  periodY: string;
};

/** Freshness of one self-updating source (insights_freshness_v1). */
export type Freshness = {
  source: string;
  dataset: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  newRecords: number | null;
  status: "ok" | "failed" | "never_run" | "stale";
  message: string | null;
};

/**
 * Read RPCs (public schema, SECURITY DEFINER, search_path = '', revoked from public/anon/authenticated, granted to
 * service_role; called only from server functions through rpcPost in src/lib/external/rest.server.ts).
 */
export const INSIGHTS_RPC = {
  catalog: "insights_catalog_v1", // () -> MetricDef[]
  series: "insights_series_v1", // (p_metric text, p_entity_type text, p_entity_ids text[], p_from text, p_to text) -> Fact[]
  snapshot: "insights_snapshot_v1", // (p_metric text, p_entity_type text, p_period text) -> Fact[]  (all entities, one period)
  latest: "insights_latest_v1", // (p_metric text, p_entity_type text) -> Fact[]  (each entity's latest complete period)
  cross: "insights_cross_v1", // (p_metric_x text, p_metric_y text, p_entity_type text, p_period_x text, p_period_y text) -> CrossPoint[]
  entity: "insights_entity_v1", // (p_type text, p_id text) -> { entity: EntityRef, facts: Fact[] (latest per metric), children: EntityRef[] }
  links: "insights_links_v1", // (p_type text, p_id text, p_relation text | null, p_limit int) -> Link[]
  freshness: "insights_freshness_v1", // () -> Freshness[]
} as const;
