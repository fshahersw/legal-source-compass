/**
 * Word-sized trend for KPI tiles: one series, no axes, the latest complete period in the accent colour and the
 * earlier ones in the de-emphasis grey. Gaps stay gaps; partial periods are dashed. Decorative: the tile states the
 * latest value and change in text, and links to the full chart and its table.
 */
import { useMemo } from "react";
import { chartTokens } from "./palette";
import { linearScale, niceDomain } from "./scale";
import { alignToAxis, lastCompleteIndex, lineSegments, type TrendSeriesInput } from "./series";

export function Sparkline({
  series,
  keys,
  width = 120,
  height = 28,
  zero = false,
}: {
  series: TrendSeriesInput;
  keys: readonly string[];
  width?: number;
  height?: number;
  zero?: boolean;
}) {
  const aligned = useMemo(() => alignToAxis(series, keys), [series, keys]);
  const values = aligned.flatMap((d) => (typeof d?.value === "number" ? [d.value] : []));
  if (values.length < 2) return null;
  const { domain } = niceDomain(values, { zero, count: 2 });
  const pad = 3;
  const x = (i: number) =>
    keys.length <= 1 ? width / 2 : pad + (i / (keys.length - 1)) * (width - pad * 2);
  const y = linearScale(domain, [height - pad, pad]);
  const last = lastCompleteIndex(aligned);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
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
          strokeOpacity={0.75}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          {...(seg.dashed ? { strokeDasharray: "3 3" } : {})}
        />
      ))}
      {last >= 0 ? (
        <circle
          cx={x(last)}
          cy={y(aligned[last]!.value as number)}
          r={3}
          fill="var(--chart-1)"
          stroke="var(--chart-surface)"
          strokeWidth={1.5}
        />
      ) : null}
    </svg>
  );
}
