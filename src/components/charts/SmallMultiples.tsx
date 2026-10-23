/**
 * Small multiples: one compact line panel per entity, same period axis, one hue (any two panels sit side by side, so
 * the all-pairs colour rule allows no per-panel hues). The value axis is shared by default so panels compare by
 * height; "independent scales" is offered for shape comparisons and says so on every panel.
 */
import { useMemo } from "react";
import type { ValueFormatter } from "./format";
import { LineTrend } from "./LineTrend";
import {
  alignToAxis,
  changeVsPrevious,
  extentValues,
  lastCompleteIndex,
  type PeriodAxis,
  type TrendSeriesInput,
} from "./series";

export function SmallMultiples({
  series,
  axis,
  formatter,
  unit,
  shared = true,
  panelHeight = 110,
  zero = true,
  columns = "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
}: {
  series: readonly TrendSeriesInput[];
  axis: PeriodAxis;
  formatter: ValueFormatter;
  unit?: string | undefined;
  shared?: boolean;
  panelHeight?: number;
  zero?: boolean;
  /** Tailwind grid-cols classes. */
  columns?: string;
}) {
  const domain = useMemo<[number, number] | undefined>(() => {
    if (!shared) return undefined;
    const v = extentValues(series);
    return v.length ? [Math.min(...v), Math.max(...v)] : undefined;
  }, [series, shared]);
  return (
    <ul className={`grid gap-3 ${columns}`} aria-label="Small multiples">
      {series.map((s) => {
        const aligned = alignToAxis(s, axis.keys);
        const li = lastCompleteIndex(aligned);
        const change = changeVsPrevious(aligned, axis.keys);
        return (
          <li key={s.id} className="min-w-0 rounded border border-border/70 px-2 pb-1 pt-1.5">
            <p className="truncate text-xs font-medium" title={s.label}>
              {s.label}
            </p>
            <p className="text-[11px] leading-4 text-muted-foreground">
              {li >= 0 ? (
                <>
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatter.full(aligned[li]!.value)}
                  </span>{" "}
                  {axis.label(axis.keys[li]!)}
                  {change
                    ? ` · ${formatter.delta(change.absolute)} vs ${axis.label(change.previousKey)}`
                    : ""}
                </>
              ) : (
                "No complete period recorded"
              )}
              {!shared ? " · own scale" : ""}
            </p>
            <LineTrend
              series={[s]}
              axis={axis}
              formatter={formatter}
              unit={unit}
              ariaLabel={`${s.label}, ${axis.label(axis.keys[0] ?? "")} to ${axis.label(axis.keys[axis.keys.length - 1] ?? "")}`}
              height={panelHeight}
              compact
              zero={zero}
              yDomain={domain}
            />
          </li>
        );
      })}
    </ul>
  );
}
