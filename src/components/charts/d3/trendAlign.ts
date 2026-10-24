/**
 * Turns several Analytics trend blocks into one set of aligned series for the change-since chart. Only blocks on the
 * same kind of period are combined (calendar years are never mixed with fiscal years); unfinished periods are left
 * out, so a part-year never reads as a fall; a period a source does not record stays null.
 */
import type { TrendBlockData, XKind } from "@/lib/analytics/trend";
import type { Series, StackRow } from "./maths";

export type AlignedTrends = {
  xKind: XKind;
  series: Series[];
  /** Block ids left out because their period kind differs from the majority. */
  leftOut: string[];
  /** Index of the first period at which every series has a value (the default comparison point), or 0. */
  commonStart: number;
  /** Periods dropped because a source marked them unfinished. */
  partialDropped: string[];
  /** Series whose earlier periods are left out because the source marks a change in what is counted. */
  cutAt: { id: string; label: string; x: string; marker: string }[];
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
  const cutAt: AlignedTrends["cutAt"] = [];
  const byNum = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
  const perSeries = used.map((b) => {
    const s = b.block.series[b.block.primary] ?? b.block.series[0];
    const at = new Map<string, number | null>();
    // a marker means what is counted changes there: only the periods from the last marker on are comparable
    const lastMarker = [...b.block.markers].sort((m, n) => byNum(m.x, n.x)).pop();
    if (lastMarker) cutAt.push({ id: b.id, label: b.label, x: lastMarker.x, marker: lastMarker.label });
    for (const p of s?.points ?? []) {
      if (lastMarker && byNum(p.x, lastMarker.x) < 0) continue;
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
  return { xKind, series, leftOut, commonStart, partialDropped: [...partialDropped].sort(), cutAt };
}

/** A block's series as stacked-bar rows (series must be disjoint parts of a whole); unfinished periods keep their flag. */
export function blockStackRows(block: TrendBlockData, label: (x: string) => string = (x) => x): StackRow[] {
  const xs = [...new Set(block.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true }),
  );
  return xs.map((x) => {
    const values: Record<string, number | null> = {};
    let partial = false;
    for (const s of block.series) {
      const p = s.points.find((q) => q.x === x);
      values[s.id] = p?.value ?? null;
      if (p?.partial) partial = true;
    }
    return { period: label(x), values, ...(partial ? { partial } : {}) };
  });
}

/**
 * Splits a total into a recorded subset and the rest ("became law" and "did not"), for a stacked bar whose height is
 * the total. Both parts are null when either figure is missing or the subset exceeds the total, never a guessed split.
 */
export function subsetStackRows(
  block: TrendBlockData,
  totalId: string,
  partId: string,
  label: (x: string) => string = (x) => x,
): StackRow[] {
  const total = block.series.find((s) => s.id === totalId);
  const part = block.series.find((s) => s.id === partId);
  if (!total || !part) return [];
  return total.points.map((t) => {
    const p = part.points.find((q) => q.x === t.x);
    const ok = t.value != null && p?.value != null && p.value <= t.value;
    return {
      period: label(t.x),
      values: { part: ok ? p!.value! : null, rest: ok ? t.value! - p!.value! : null },
      ...(t.partial || p?.partial ? { partial: true } : {}),
    };
  });
}
