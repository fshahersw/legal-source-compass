/**
 * KPI board model: the headline metric of each topic as a tile (latest complete value, change against the period
 * before it, sparkline, source), from two kinds of input — the Analytics hub's trend blocks (live today) and contract
 * facts for a nation-level metric. Plus the deterministic "notable movements" rule. Pure and tested (kpis.test.ts).
 */
import type { Fact, MetricDef, Topic } from "@/lib/insights/contract";
import {
  compareX,
  formatChange,
  formatValue,
  formatTick,
  periodLabel as hubPeriodLabel,
  type TrendBlockData,
} from "@/lib/analytics/trend";
import {
  densePeriods,
  metricFormatter,
  periodLabel,
  comparePeriods,
  formatPercentChange,
} from "@/components/charts/format";
import {
  alignToAxis,
  changeVsPrevious,
  lastCompleteIndex,
  type TrendSeriesInput,
} from "@/components/charts/series";

export const TOPIC_LABEL: Record<Topic, string> = {
  places: "Places",
  courts: "Courts & judges",
  litigation: "Litigation",
  law: "Law & regulation",
  enforcement: "Enforcement",
  safety: "Products & safety",
  companies: "Companies",
  government: "Government",
};

export const TOPIC_ORDER: readonly Topic[] = [
  "courts",
  "litigation",
  "enforcement",
  "safety",
  "companies",
  "places",
  "law",
  "government",
];

/** Topic of each Analytics hub block shown on the KPI board (the hub's overview blocks). */
export const HUB_BLOCK_TOPIC: Readonly<Record<string, Topic>> = {
  "federal-civil": "courts",
  "federal-criminal": "courts",
  "judicial-vacancies": "courts",
  "judicial-nominations": "courts",
  "mdl-pending": "litigation",
  "securities-class-actions": "litigation",
  "doj-press": "enforcement",
  "sec-releases": "enforcement",
  "ftc-actions": "enforcement",
  "epa-cases": "enforcement",
  "osha-inspections": "enforcement",
  "ftc-sentinel": "enforcement",
  "cpsc-recalls": "safety",
  "nhtsa-recalls": "safety",
  "fsis-recalls": "safety",
  "fda-recalls": "safety",
  faers: "safety",
  caers: "safety",
  "cfpb-complaints": "companies",
  "federal-register": "law",
  "congress-bills": "government",
};

/** Bridged state-metric national series shown on the board (official national totals or sums of the states). */
export const BRIDGE_KPI_METRICS: readonly string[] = [
  "sm.population",
  "sm.unemployment_rate",
  "sm.overdose_deaths",
  "sm.fars_fatalities",
  "sm.nhtsa_complaints",
  "sm.fda_class1_recalls",
];

export type Kpi = {
  id: string;
  topic: Topic;
  title: string;
  unit: string;
  /** "1,307,769", "$3.94 billion", "4.2%". */
  value: string | null;
  periodText: string | null;
  seriesLabel: string | null;
  /** "+5,752 (+2.1%) vs FY2024". */
  changeText: string | null;
  /** Why no change is shown. */
  changeNote: string | null;
  /** Relative change in percent (null when not computable), for "notable movements". */
  changePercent: number | null;
  direction: "up" | "down" | "flat" | null;
  /** Complete, recorded periods in the series (the evidence behind a movement). */
  completePeriods: number;
  spark: { series: TrendSeriesInput; keys: string[] } | null;
  source: { label: string; url: string };
  /** In-app link to the full chart. */
  href: { to: string; hash?: string | undefined; search?: Record<string, string> | undefined };
  partialNote: string | null;
};

/** A tile from an Analytics hub trend block (its primary series). */
export function kpiFromBlock(block: TrendBlockData, title: string, topic: Topic): Kpi {
  const primary = block.series[block.primary] ?? block.series[0];
  const keys = primary ? [...new Set(primary.points.map((p) => p.x))].sort(compareX) : [];
  const latest = block.latest;
  const complete = primary
    ? primary.points.filter((p) => p.value !== null && !p.partial).length
    : 0;
  const partialPoint = primary?.points.find((p) => p.partial && p.value !== null);
  const change = latest?.change ?? null;
  return {
    id: `hub:${block.id}`,
    topic,
    title,
    unit: block.unit,
    value: latest ? formatValue(latest.value, block.format) : null,
    periodText: latest?.period ?? null,
    seriesLabel: latest?.seriesLabel ?? null,
    changeText: change ? formatChange(change, block.format) : null,
    changeNote: latest ? latest.changeNote : "No complete period is recorded.",
    changePercent: change?.percent ?? null,
    direction: change ? (change.absolute > 0 ? "up" : change.absolute < 0 ? "down" : "flat") : null,
    completePeriods: complete,
    spark: primary
      ? {
          series: {
            id: primary.id,
            label: primary.label,
            points: primary.points.map((p) => ({ key: p.x, value: p.value, partial: p.partial })),
          },
          keys,
        }
      : null,
    source: block.source,
    href: { to: "/insights/trends", hash: `block-${block.id}`, search: { view: "national" } },
    partialNote: partialPoint
      ? `${hubPeriodLabel(partialPoint.x, block.xKind)} is a partial period (${formatTick(partialPoint.value as number, block.format)} so far) and is not the latest value.`
      : null,
  };
}

/** A tile from a nation-level contract metric and its facts. */
export function kpiFromFacts(def: MetricDef, facts: readonly Fact[], href: Kpi["href"]): Kpi {
  const fmt = metricFormatter(def.format);
  const sorted = [...facts].sort((a, b) => comparePeriods(a.period, b.period));
  const keys = densePeriods(
    sorted.map((f) => f.period),
    def.periodType,
  );
  const series: TrendSeriesInput = {
    id: def.id,
    label: def.label,
    points: sorted.map((f) => ({ key: f.period, value: f.value, partial: f.partial })),
  };
  const aligned = alignToAxis(series, keys);
  const li = lastCompleteIndex(aligned);
  const change = changeVsPrevious(aligned, keys);
  const partial = sorted.find((f) => f.partial && f.value !== null);
  const source = def.sourceLinks[0] ?? { label: "Source not recorded", url: "/sources" };
  let changeNote: string | null = null;
  if (li < 0) changeNote = "No complete period is recorded.";
  else if (!change)
    changeNote =
      li === 0
        ? "No earlier period to compare with."
        : `${periodLabel(keys[li - 1]!, def.periodType)} is not recorded as a complete period, so no change is shown.`;
  return {
    id: `metric:${def.id}`,
    topic: def.topic,
    title: def.label,
    unit: def.unit,
    value: li >= 0 ? fmt.full(aligned[li]!.value) : null,
    periodText: li >= 0 ? periodLabel(keys[li]!, def.periodType) : null,
    seriesLabel: "United States",
    changeText: change
      ? `${fmt.delta(change.absolute)}${change.percent === null ? "" : ` (${formatPercentChange(change.percent)})`} vs ${periodLabel(change.previousKey, def.periodType)}`
      : null,
    changeNote,
    changePercent: change?.percent ?? null,
    direction: change ? (change.absolute > 0 ? "up" : change.absolute < 0 ? "down" : "flat") : null,
    completePeriods: aligned.filter((d) => d && d.value !== null && !d.partial).length,
    spark: { series, keys },
    source: { label: source.label, url: source.url },
    href,
    partialNote: partial
      ? `${periodLabel(partial.period, def.periodType)} is a partial period and is not the latest value.`
      : null,
  };
}

/**
 * Tiles that repeat an earlier tile: the same area, the same latest value for the same period and the same change.
 * The board reads one series from the Analytics hub and others from the data layer, and a few of those are the same
 * published figure (e.g. federal civil filings, final rules); the first tile in board order is kept. Partial or
 * unrecorded values never match, so two tiles that merely lack data are not merged.
 */
export function repeatedTileIds(kpis: readonly Kpi[]): Set<string> {
  const seen = new Set<string>();
  const repeats = new Set<string>();
  for (const k of kpis) {
    if (k.value === null || k.periodText === null || k.changePercent === null) continue;
    const key = `${k.topic}|${k.value}|${k.periodText}|${k.changePercent.toFixed(1)}`;
    if (seen.has(key)) repeats.add(k.id);
    else seen.add(key);
  }
  return repeats;
}

/** The rule behind "notable movements", stated on the page. */
export const MOVEMENT_RULE = {
  minCompletePeriods: 5,
  count: 6,
  text: "The largest changes, in percent, between each tile's latest complete period and the period before it, among tiles with at least five complete periods. Partial periods never count; a change from zero has no percentage and is left out.",
} as const;

/** Largest absolute percentage changes among tiles with enough history (deterministic; ties by title). */
export function notableMovements(kpis: readonly Kpi[]): Kpi[] {
  return kpis
    .filter(
      (k) =>
        k.changePercent !== null &&
        Number.isFinite(k.changePercent) &&
        k.completePeriods >= MOVEMENT_RULE.minCompletePeriods,
    )
    .sort(
      (a, b) =>
        Math.abs(b.changePercent!) - Math.abs(a.changePercent!) || a.title.localeCompare(b.title),
    )
    .slice(0, MOVEMENT_RULE.count);
}
