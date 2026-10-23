/** Pure view helpers for the metric map: legend classes, shading, readouts and the keyboard-reachable data table. */
import {
  classIndex,
  competitionRank,
  formatMapValue,
  NOT_RECORDED,
  quantileBreaks,
  type MapFormat,
} from "@/lib/external/mapMetricsModel";

export type LegendClass = {
  index: number;
  lo: number;
  hi: number;
  label: string;
  /** Percentage of the high-end map colour mixed into the low-end colour. */
  shade: number;
  count: number;
};

/** Shade percentage for class `index` of `n` (lightest 16, darkest 90). */
export function shadeOf(index: number, n: number): number {
  return n <= 1 ? 60 : Math.round(16 + (74 * index) / (n - 1));
}

/** Quantile classes over the values, each with a range label, shade and the number of areas in it. */
export function legendClasses(values: number[], format: MapFormat, classes = 5): LegendClass[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return [];
  const breaks = quantileBreaks(finite, classes);
  const min = Math.min(...finite);
  const counts = breaks.map(() => 0);
  for (const v of finite) {
    const i = classIndex(v, breaks);
    if (i != null) counts[i]!++;
  }
  return breaks.map((hi, index) => {
    const lo = index === 0 ? min : breaks[index - 1]!;
    const label =
      lo === hi
        ? formatMapValue(hi, format)
        : `${formatMapValue(lo, format)} to ${formatMapValue(hi, format)}`;
    return { index, lo, hi, label, shade: shadeOf(index, breaks.length), count: counts[index]! };
  });
}

export type Readout = { name: string; value: string; rank: string | null; detail: string | null };

/** What a hover or focus shows: the area's value in the metric's unit, its rank, and the sentence behind the number. */
export function readout(args: {
  name: string;
  value: number | null | undefined;
  format: MapFormat;
  unit: string;
  rank?: { rank: number; of: number } | undefined;
  rankScope: string;
  detail?: string | undefined;
}): Readout {
  const has = args.value != null && Number.isFinite(args.value);
  return {
    name: args.name,
    value: has ? `${formatMapValue(args.value, args.format)} ${args.unit}`.trim() : NOT_RECORDED,
    rank: has && args.rank ? `Rank ${args.rank.rank} of ${args.rank.of} ${args.rankScope}` : null,
    detail: has && args.detail ? args.detail : null,
  };
}

export type DataRow = { id: string; name: string; value: number; rank: number | null };

/** Rows for the "show data" table: every area with a value, highest first; ranks only for ranked areas. */
export function dataRows(
  names: Map<string, string>,
  values: Record<string, number>,
  rankedScope: Iterable<string>,
): DataRow[] {
  const ranks = competitionRank(values, rankedScope);
  return Object.entries(values)
    .filter(([id]) => names.has(id))
    .map(([id, value]) => ({ id, name: names.get(id)!, value, rank: ranks[id]?.rank ?? null }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
