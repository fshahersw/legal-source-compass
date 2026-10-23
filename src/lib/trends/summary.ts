/**
 * Helpers for charts whose "latest period" would mislead: a sparse series (a few items a decade) or a grouping that is not
 * a time series of activity (master dockets grouped by the year their MDL was filed). Such a card leads with the total over
 * every plotted year, which is a plain sum of what the chart draws, instead of the newest year and its change.
 */
import { compareX, type TrendSeries } from "@/lib/analytics/trend";

/** A one-point series for `assembleBlock({ latestFrom })`: the sum over all the plotted periods. */
export function totalSeries(args: {
  label: string;
  /** The series whose points are summed (partial periods count: they are part of what the chart draws). */
  from: readonly TrendSeries[];
}): TrendSeries | null {
  const xs = [
    ...new Set(args.from.flatMap((s) => s.points.filter((p) => p.value !== null).map((p) => p.x))),
  ].sort(compareX);
  if (!xs.length) return null;
  const value = args.from.reduce(
    (sum, s) => sum + s.points.reduce((n, p) => n + (p.value ?? 0), 0),
    0,
  );
  const span = xs[0] === xs[xs.length - 1] ? xs[0]! : `${xs[0]}–${xs[xs.length - 1]}`;
  return { id: "total", label: args.label, points: [{ x: span, value }] };
}

/** Periods in which no series has a value: the periods "not recorded" for a stack of parts. */
export function emptyPeriods(series: readonly TrendSeries[]): number {
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))];
  return xs.filter((x) =>
    series.every((s) => (s.points.find((p) => p.x === x)?.value ?? null) === null),
  ).length;
}
