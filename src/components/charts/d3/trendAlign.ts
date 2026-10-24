/**
 * Turns several Analytics trend blocks into one set of aligned series for the change-since chart. Only blocks on the
 * same kind of period are combined (calendar years are never mixed with fiscal years); unfinished periods are left
 * out, so a part-year never reads as a fall; a period a source does not record stays null.
 */
import type { TrendBlockData, XKind } from "@/lib/analytics/trend";
import type { Series } from "./maths";

export type AlignedTrends = {
  xKind: XKind;
  series: Series[];
  /** Block ids left out because their period kind differs from the majority. */
  leftOut: string[];
  /** Index of the first period at which every series has a value (the default comparison point), or 0. */
  commonStart: number;
  /** Periods dropped because a source marked them unfinished. */
  partialDropped: string[];
};

export function alignTrends(
  blocks: readonly { id: string; label: string; block: TrendBlockData }[],
  minYears = 3,
): AlignedTrends | null {
  if (!blocks.length) return null;
  const kinds = new Map<XKind, number>();
  for (const b of blocks) kinds.set(b.block.xKind, (kinds.get(b.block.xKind) ?? 0) + 1);
  const xKind = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const used = blocks.filter((b) => b.block.xKind === xKind);
  const leftOut = blocks.filter((b) => b.block.xKind !== xKind).map((b) => b.id);
  const partialDropped = new Set<string>();
  const perSeries = used.map((b) => {
    const s = b.block.series[b.block.primary] ?? b.block.series[0];
    const at = new Map<string, number | null>();
    for (const p of s?.points ?? []) {
      if (p.partial) {
        partialDropped.add(p.x);
        continue;
      }
      at.set(p.x, p.value);
    }
    return { id: b.id, label: b.label, at };
  });
  const xs = [...new Set(perSeries.flatMap((s) => [...s.at.keys()]))].sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true }),
  );
  // keep the span where at least two series are recorded
  const covered = xs.filter((x) => perSeries.filter((s) => s.at.get(x) != null).length >= 2);
  if (covered.length < minYears) return null;
  const first = xs.indexOf(covered[0]!);
  const last = xs.indexOf(covered[covered.length - 1]!);
  const dates = xs.slice(first, last + 1);
  const series: Series[] = perSeries.map((s) => ({
    id: s.id,
    label: s.label,
    points: dates.map((date) => ({ date, value: s.at.get(date) ?? null })),
  }));
  const commonStart = Math.max(
    0,
    dates.findIndex((d) => series.every((s) => (s.points.find((p) => p.date === d)?.value ?? 0) > 0)),
  );
  return { xKind, series, leftOut, commonStart, partialDropped: [...partialDropped].sort() };
}
