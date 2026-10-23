/**
 * Bridge from the published state metrics (getStateMetrics: Census, BEA, BLS, CDC, NHTSA and openFDA series built by
 * scripts/enrichment/state_metrics) to the insights contract shapes, so the Insights pages show real data before the
 * insights data layer is live. Pure: no I/O. Every value is the reader's value; the only transformation is the unit of
 * "$ millions" series, written in whole dollars (× 1,000,000) because the contract's currency format is dollars.
 *
 * Ids are `sm.<key>`: the dot keeps them apart from the data layer's snake_case ids.
 */
import type { Fact, MetricDef, MetricFormat, Topic } from "@/lib/insights/contract";
import type {
  MetricDef as StateMetricDef,
  StateMetricsBundle,
} from "@/lib/external/stateMetrics.functions";

export const STATE_METRIC_PREFIX = "sm.";
export const NATION_ID = "US";

const TOPIC_BY_GROUP: Record<string, Topic> = {
  "Population & economy": "places",
  "Health & injury": "places",
  "Product & vehicle safety": "safety",
};

export function bridgeId(key: string): string {
  return `${STATE_METRIC_PREFIX}${key}`;
}

/** Contract format and the factor a stored value is multiplied by to be in that format's unit. */
export function formatOf(def: Pick<StateMetricDef, "format" | "per">): {
  format: MetricFormat;
  factor: number;
} {
  switch (def.format) {
    case "int":
      return { format: "count", factor: 1 };
    case "money_m":
      return { format: "currency_usd", factor: 1_000_000 };
    case "dollars":
      return { format: "currency_usd", factor: 1 };
    case "pct":
      return { format: "percent", factor: 1 };
    case "rate":
      return def.per === 100000 || def.per === null
        ? { format: "rate_per_100k", factor: 1 }
        : { format: "ratio", factor: 1 };
  }
}

function unitOf(def: StateMetricDef, format: MetricFormat): string {
  if (def.format === "money_m") return "dollars";
  if (format === "percent") return "percent";
  if (def.format === "rate" && def.per === 1_000_000) return "per 1,000,000 residents";
  if (def.format === "rate" && /age-adjusted/.test(def.unit)) return "per 100,000 (age-adjusted)";
  if (def.format === "rate") return "per 100,000 residents";
  return def.unit;
}

function denominatorText(def: StateMetricDef, labels: Map<string, string>): string | null {
  if (!def.denominator) return null;
  const base = labels.get(def.denominator) ?? def.denominator;
  const per =
    def.per === 100000
      ? "per 100,000"
      : def.per === 1_000_000
        ? "per 1,000,000"
        : def.per === 1
          ? "per resident"
          : null;
  return `${base}, same year${per ? ` (${per})` : ""}`;
}

/** Contract metric definitions for the selectable state metrics. */
export function stateMetricDefs(bundle: StateMetricsBundle): MetricDef[] {
  const labels = new Map(bundle.metrics.map((m) => [m.key, m.label] as const));
  const facts = (key: string) =>
    bundle.states.reduce((n, s) => n + Object.keys(s.series[key] ?? {}).length, 0);
  return bundle.metrics
    .filter((m) => m.selectable)
    .sort((a, b) => a.order - b.order)
    .map((m) => {
      const { format } = formatOf(m);
      const caveats = [...m.caveats];
      for (const [year, note] of Object.entries(m.partialYears))
        caveats.push(`${year} is a partial year: ${note}.`);
      if (typeof m.provisional === "string") caveats.push(`Provisional: ${m.provisional}.`);
      else if (m.provisional)
        for (const [year, note] of Object.entries(m.provisional))
          caveats.push(`${year} is provisional: ${note}.`);
      if (m.nationalBasis) caveats.push(`United States value: ${m.nationalBasis}.`);
      return {
        id: bridgeId(m.key),
        label: m.label,
        description: m.method,
        unit: unitOf(m, format),
        format,
        topic: TOPIC_BY_GROUP[m.group] ?? "places",
        entityTypes: ["state", "nation"],
        periodType: "year",
        sourceDatasets: ["state_metrics_profiles", "state_metrics_national"],
        sourceLinks: m.sources.map((s) => ({
          label: `${s.publisher ? `${s.publisher}: ` : ""}${s.name}`,
          url: s.page ?? s.url,
        })),
        numerator: m.label,
        denominator: denominatorText(m, labels),
        method: m.method,
        caveats,
        direction: "higher_is_more",
        coverage: {
          from: m.years ? String(m.years[0]) : null,
          to: m.years ? String(m.years[1]) : null,
          entities: bundle.states.filter((s) => s.series[m.key]).length,
          facts: facts(m.key),
        },
        refreshedAt: bundle.generatedAt,
      } satisfies MetricDef;
    });
}

function yearFact(
  metricId: string,
  entityType: "state" | "nation",
  entityId: string,
  year: string,
  value: number | null,
  partial: boolean,
  reason: string | null,
): Fact {
  return {
    metricId,
    entityType,
    entityId,
    period: year,
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    value,
    moe: null,
    partial,
    n: null,
    notRecordedReason: value === null ? (reason ?? "Not in the published series") : null,
  };
}

/**
 * Facts for one metric: every state (USPS id) or the nation ("US"), every year in the metric's published range.
 * A year inside the range that a state's series does not carry is an explicit null fact, with the state's own note
 * as the reason when the source gives one (e.g. suppressed counts).
 */
export function stateMetricFacts(
  bundle: StateMetricsBundle,
  metricId: string,
  entityType: "state" | "nation",
  options: {
    entityIds?: readonly string[] | undefined;
    from?: string | null | undefined;
    to?: string | null | undefined;
    period?: string | undefined;
  } = {},
): Fact[] {
  if (!metricId.startsWith(STATE_METRIC_PREFIX)) return [];
  const key = metricId.slice(STATE_METRIC_PREFIX.length);
  const def = bundle.metrics.find((m) => m.key === key);
  if (!def || !def.years) return [];
  const { factor } = formatOf(def);
  const years: string[] = [];
  for (let y = def.years[0]; y <= def.years[1]; y++) years.push(String(y));
  const inWindow = (y: string) =>
    (!options.period || y === options.period) &&
    (!options.from || y >= options.from) &&
    (!options.to || y <= options.to);
  const scaled = (v: number | undefined) => (typeof v === "number" ? v * factor : null);
  if (entityType === "nation") {
    if (options.entityIds && !options.entityIds.includes(NATION_ID)) return [];
    return years
      .filter(inWindow)
      .map((y) =>
        yearFact(
          metricId,
          "nation",
          NATION_ID,
          y,
          scaled(def.national[y]),
          y in def.partialYears,
          null,
        ),
      );
  }
  const wanted = options.entityIds ? new Set(options.entityIds) : null;
  const out: Fact[] = [];
  for (const s of bundle.states) {
    if (wanted && !wanted.has(s.usps)) continue;
    const series = s.series[key] ?? {};
    for (const y of years) {
      if (!inWindow(y)) continue;
      out.push(
        yearFact(
          metricId,
          "state",
          s.usps,
          y,
          scaled(series[y]),
          y in def.partialYears,
          s.notes[key]?.[y] ?? null,
        ),
      );
    }
  }
  return out;
}

/** The latest complete (not partial) year that at least `minStates` states record. */
export function latestCompleteYear(
  bundle: StateMetricsBundle,
  metricId: string,
  minStates = 40,
): string | null {
  const key = metricId.slice(STATE_METRIC_PREFIX.length);
  const def = bundle.metrics.find((m) => m.key === key);
  if (!def?.years) return null;
  for (let y = def.years[1]; y >= def.years[0]; y--) {
    const year = String(y);
    if (year in def.partialYears) continue;
    const n = bundle.states.filter((s) => typeof s.series[key]?.[year] === "number").length;
    if (n >= minStates) return year;
  }
  return null;
}
