/** Pure helpers of the Trends page (tested in trendsModel.test.ts). */
import type { EntityType, Fact, MetricDef } from "@/lib/insights/contract";
import { comparePeriods, densePeriods, periodLabel, periodTick } from "@/components/charts/format";
import type { PeriodAxis, TrendSeriesInput } from "@/components/charts/series";
import type { Series } from "@/components/charts/d3/maths";

export type TrendsSearch = {
  view?: "compare" | "national" | undefined;
  topic?: string | undefined;
  type?: EntityType | undefined;
  metric?: string | undefined;
  /** Comma-separated entity ids, at most six. */
  ids?: string | undefined;
  /** "1" = show the per-capita counterpart. */
  pc?: "1" | undefined;
  scale?: "own" | undefined;
  us?: "0" | undefined;
  /** "1" = show change since a chosen period (series rebased) instead of values. */
  chg?: "1" | undefined;
};

export const MAX_COMPARE = 6;

/** Per-capita counterparts the sources define (numerator series ↔ its published rate series). */
const PER_CAPITA_PAIRS: Readonly<Record<string, string>> = {
  "sm.overdose_deaths": "sm.overdose_rate",
  "sm.opioid_deaths": "sm.opioid_rate",
  "sm.synthetic_opioid_deaths": "sm.synthetic_opioid_rate",
  "sm.fars_fatalities": "sm.fars_rate",
  "sm.nhtsa_complaints": "sm.nhtsa_complaint_rate",
  "sm.fda_recalls": "sm.fda_recall_rate",
  "sm.gdp": "sm.gdp_per_capita",
};

/**
 * The count metric and its per-capita counterpart, when the catalog has both: an explicit pair above, or the data
 * layer's convention `<id>_per_100k` with a stated denominator. Null when there is none (no toggle is offered).
 */
export function perCapitaPair(
  metrics: readonly MetricDef[],
  id: string,
): { count: MetricDef; rate: MetricDef } | null {
  const by = new Map(metrics.map((m) => [m.id, m] as const));
  const reverse = Object.entries(PER_CAPITA_PAIRS).find(([, r]) => r === id)?.[0];
  const countId = reverse ?? (id.endsWith("_per_100k") ? id.slice(0, -"_per_100k".length) : id);
  const rateId = PER_CAPITA_PAIRS[countId] ?? `${countId}_per_100k`;
  const count = by.get(countId);
  const rate = by.get(rateId);
  return count && rate && rate.denominator ? { count, rate } : null;
}

export function parseIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[A-Za-z0-9_.:-]{1,40}$/.test(s)),
    ),
  ].slice(0, MAX_COMPARE);
}

export function axisFor(def: MetricDef, facts: readonly Fact[]): PeriodAxis {
  const keys = densePeriods(
    facts.map((f) => f.period),
    def.periodType,
  );
  return {
    keys,
    label: (k) => periodLabel(k, def.periodType),
    tick: (k) => periodTick(k, def.periodType),
  };
}

export function seriesFrom(
  facts: readonly Fact[],
  ids: readonly string[],
  label: (id: string) => string,
): TrendSeriesInput[] {
  return ids.map((id) => ({
    id,
    label: label(id),
    points: facts
      .filter((f) => f.entityId === id)
      .sort((a, b) => comparePeriods(a.period, b.period))
      .map((f) => ({ key: f.period, value: f.value, partial: f.partial, moe: f.moe, n: f.n })),
  }));
}

/**
 * Series for the change-since chart: one date per axis period, partial periods left out (a part-year never reads as a
 * fall), a period a source does not record stays null. `commonStart` is the first period where every series has a
 * positive value (the default comparison point), or 0. Null when fewer than three complete periods remain.
 */
export function changeSeries(
  series: readonly TrendSeriesInput[],
  axis: PeriodAxis,
): { series: Series[]; commonStart: number; partialDropped: string[] } | null {
  const partial = new Set(
    series.flatMap((s) => s.points.filter((p) => p.partial).map((p) => p.key)),
  );
  const keys = axis.keys.filter((k) => !partial.has(k));
  if (keys.length < 3 || !series.length) return null;
  const out: Series[] = series.map((s) => {
    const at = new Map(s.points.map((p) => [p.key, p.value] as const));
    return {
      id: s.id,
      label: s.label,
      points: keys.map((k) => ({ date: k, value: at.get(k) ?? null })),
    };
  });
  const start = keys.findIndex((_, i) =>
    out.every((s) => {
      const v = s.points[i]?.value;
      return v != null && v > 0;
    }),
  );
  return {
    series: out,
    commonStart: Math.max(0, start),
    partialDropped: axis.keys.filter((k) => partial.has(k)),
  };
}
