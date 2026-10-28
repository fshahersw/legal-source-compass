/**
 * Shared series model for period charts (line, bar, sparkline, small multiples). Pure and tested (series.test.ts).
 *
 * A series lists one datum per period key. `value: null` means the source does not record the period: it is drawn as
 * a gap and listed as "Not recorded", never as zero. `partial` marks a period still in progress or only partly covered:
 * every line segment touching it is dashed and a bar for it is drawn hatched. Nothing is interpolated: a segment joins
 * two neighbouring recorded periods only.
 */

export type TrendDatum = {
  key: string;
  value: number | null;
  partial?: boolean | undefined;
  /** Published margin of error (e.g. Census ACS 90% MOE), drawn as a band. */
  moe?: number | null | undefined;
  /** Count behind a rate or median, shown in the tooltip and table. */
  n?: number | null | undefined;
};

export type TrendSeriesInput = {
  id: string;
  label: string;
  points: readonly TrendDatum[];
};

/** Labels for a period axis: the ordered keys (with every gap period present), and how to write each one. */
export type PeriodAxis = {
  keys: readonly string[];
  label: (key: string) => string;
  tick: (key: string) => string;
  /**
   * Which keys get an axis label. Default: every label that fits, else every n-th at a regular step. A long monthly
   * axis passes e.g. "January of every fifth year" so a label never repeats.
   */
  showTick?: ((key: string, index: number) => boolean) | undefined;
};

export type Annotation = {
  key: string;
  label: string;
};

export type Segment = { dashed: boolean; indices: number[] };

/** The value at every axis key (undefined when the series has no datum for the key). */
export function alignToAxis(
  series: TrendSeriesInput,
  keys: readonly string[],
): (TrendDatum | undefined)[] {
  const by = new Map(series.points.map((p) => [p.key, p] as const));
  return keys.map((k) => by.get(k));
}

const recorded = (d: TrendDatum | undefined): d is TrendDatum & { value: number } =>
  !!d && typeof d.value === "number" && Number.isFinite(d.value);

/**
 * Line segments over aligned data: an edge joins neighbours i and i + 1 when both are recorded; it is dashed when
 * either end is partial. Consecutive edges of the same style merge into one polyline.
 */
export function lineSegments(aligned: readonly (TrendDatum | undefined)[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < aligned.length; i++) {
    const a = aligned[i];
    const b = aligned[i + 1];
    if (!recorded(a) || !recorded(b)) continue;
    const dashed = !!a.partial || !!b.partial;
    const last = out[out.length - 1];
    if (last && last.dashed === dashed && last.indices[last.indices.length - 1] === i)
      last.indices.push(i + 1);
    else out.push({ dashed, indices: [i, i + 1] });
  }
  return out;
}

/** Recorded points with no recorded neighbour: a line draws nothing for them, so they get a dot. */
export function isolatedIndices(aligned: readonly (TrendDatum | undefined)[]): number[] {
  const out: number[] = [];
  aligned.forEach((d, i) => {
    if (!recorded(d)) return;
    if (!recorded(aligned[i - 1]) && !recorded(aligned[i + 1])) out.push(i);
  });
  return out;
}

/** Runs of consecutive points that carry a margin of error, for the shaded band. */
export function moeRuns(
  aligned: readonly (TrendDatum | undefined)[],
): { index: number; lo: number; hi: number }[][] {
  const runs: { index: number; lo: number; hi: number }[][] = [];
  let run: { index: number; lo: number; hi: number }[] = [];
  aligned.forEach((d, i) => {
    if (recorded(d) && typeof d.moe === "number" && Number.isFinite(d.moe) && d.moe >= 0) {
      run.push({ index: i, lo: d.value - d.moe, hi: d.value + d.moe });
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);
  return runs;
}

/** Index of the last recorded, complete point (the "latest value" a change may be computed from), or -1. */
export function lastCompleteIndex(aligned: readonly (TrendDatum | undefined)[]): number {
  for (let i = aligned.length - 1; i >= 0; i--) {
    const d = aligned[i];
    if (recorded(d) && !d.partial) return i;
  }
  return -1;
}

/** Every value a chart's y axis must hold (MOE band edges included). */
export function extentValues(series: readonly TrendSeriesInput[]): number[] {
  const out: number[] = [];
  for (const s of series)
    for (const p of s.points) {
      if (!recorded(p)) continue;
      out.push(p.value);
      if (typeof p.moe === "number" && Number.isFinite(p.moe))
        out.push(p.value - p.moe, p.value + p.moe);
    }
  return out;
}

export type ChangeSummary = {
  latestKey: string;
  latest: number;
  previousKey: string;
  previous: number;
  absolute: number;
  /** null when the earlier value is zero. */
  percent: number | null;
};

/**
 * Latest complete value against the period immediately before it on the axis. Withheld (null) when that earlier
 * period is not recorded or is partial: a change is only ever between two complete, recorded neighbours.
 */
export function changeVsPrevious(
  aligned: readonly (TrendDatum | undefined)[],
  keys: readonly string[],
  /** How many periods back the comparison period sits (2 compares a year with the same year of the last Congress). */
  lag = 1,
): ChangeSummary | null {
  const i = lastCompleteIndex(aligned);
  if (i < lag) return null;
  const cur = aligned[i]!;
  const prev = aligned[i - lag];
  if (!recorded(prev) || prev.partial) return null;
  const absolute = (cur.value as number) - prev.value;
  return {
    latestKey: keys[i]!,
    latest: cur.value as number,
    previousKey: keys[i - lag]!,
    previous: prev.value,
    absolute,
    percent: prev.value === 0 ? null : (absolute / Math.abs(prev.value)) * 100,
  };
}

/** Number of axis periods a series does not record. */
export function gapCount(aligned: readonly (TrendDatum | undefined)[]): number {
  return aligned.filter((d) => !recorded(d)).length;
}

/** Table rows: one per axis key, a cell per series ("Not recorded" for a gap), partial periods marked with *. */
export function tableRows(
  series: readonly TrendSeriesInput[],
  axis: PeriodAxis,
  full: (v: number | null) => string,
): { key: string; period: string; cells: string[] }[] {
  const aligned = series.map((s) => alignToAxis(s, axis.keys));
  return axis.keys.map((key, i) => {
    const partial = aligned.some((a) => a[i]?.partial);
    return {
      key,
      period: `${axis.label(key)}${partial ? "*" : ""}`,
      cells: aligned.map((a) => {
        const d = a[i];
        if (!recorded(d)) return "Not recorded";
        const moe = typeof d.moe === "number" && Number.isFinite(d.moe) ? ` ± ${full(d.moe)}` : "";
        return `${full(d.value)}${moe}`;
      }),
    };
  });
}
