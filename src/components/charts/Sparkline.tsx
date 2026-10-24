/**
 * Word-sized trend for KPI tiles and table rows: one series, no axes, the earlier periods in the de-emphasis grey and
 * an end dot on the latest complete period in the accent. At least 120 × 32 px so the shape is readable. With
 * `format`, the end value is written beside the dot (and the start value before the line with `showStart`), so the
 * line carries numbers, not only a shape. Gaps stay gaps; partial periods are dashed. The line itself is decorative
 * (aria-hidden): the written values and the linked chart's table carry the data.
 */
import { useMemo } from "react";
import { chartTokens } from "./palette";
import { linearScale, niceDomain } from "./scale";
import { alignToAxis, lastCompleteIndex, lineSegments, type TrendSeriesInput } from "./series";

export const SPARK_MIN_WIDTH = 120;
export const SPARK_MIN_HEIGHT = 32;

export function Sparkline({
  series,
  keys,
  width = SPARK_MIN_WIDTH,
  height = SPARK_MIN_HEIGHT,
  zero = false,
  format,
  showStart = false,
}: {
  series: TrendSeriesInput;
  keys: readonly string[];
  width?: number;
  height?: number;
  zero?: boolean;
  /** Writes the end value beside the end dot. */
  format?: ((v: number) => string) | undefined;
  /** Also write the first recorded value before the line (needs `format`). */
  showStart?: boolean;
}) {
  const aligned = useMemo(() => alignToAxis(series, keys), [series, keys]);
  const values = aligned.flatMap((d) => (typeof d?.value === "number" ? [d.value] : []));
  if (values.length < 2) return null;
  const w = Math.max(SPARK_MIN_WIDTH, width);
  const h = Math.max(SPARK_MIN_HEIGHT, height);
  const { domain } = niceDomain(values, { zero, count: 2 });
  const pad = 4;
  const x = (i: number) =>
    keys.length <= 1 ? w / 2 : pad + (i / (keys.length - 1)) * (w - pad * 2);
  const y = linearScale(domain, [h - pad, pad]);
  const last = lastCompleteIndex(aligned);
  const firstIdx = aligned.findIndex((d) => typeof d?.value === "number" && !d.partial);
  const svg = (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
      className="block shrink-0 overflow-visible"
      style={chartTokens}
    >
      {lineSegments(aligned).map((seg, i) => (
        <polyline
          key={i}
          points={seg.indices.map((k) => `${x(k)},${y(aligned[k]!.value as number)}`).join(" ")}
          fill="none"
          stroke="var(--chart-axis)"
          strokeOpacity={0.7}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          {...(seg.dashed ? { strokeDasharray: "3 3" } : {})}
        />
      ))}
      {showStart && firstIdx >= 0 && firstIdx !== last ? (
        <circle
          cx={x(firstIdx)}
          cy={y(aligned[firstIdx]!.value as number)}
          r={2.5}
          fill="var(--chart-axis)"
          stroke="var(--chart-surface)"
          strokeWidth={1.5}
        />
      ) : null}
      {last >= 0 ? (
        <circle
          cx={x(last)}
          cy={y(aligned[last]!.value as number)}
          r={4}
          fill="var(--chart-1)"
          stroke="var(--chart-surface)"
          strokeWidth={2}
        />
      ) : null}
    </svg>
  );
  if (!format || last < 0) return svg;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs leading-4">
      {showStart && firstIdx >= 0 && firstIdx !== last ? (
        <span className="tabular-nums text-muted-foreground">
          {format(aligned[firstIdx]!.value as number)}
        </span>
      ) : null}
      {svg}
      <span className="font-semibold tabular-nums text-foreground">
        {format(aligned[last]!.value as number)}
      </span>
    </span>
  );
}
