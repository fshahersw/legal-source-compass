/**
 * Multi-series line chart over periods. Gaps stay gaps (no line across a period the source does not record), partial
 * periods are dashed, a published margin of error is a light band, reporting changes are marked with a labelled
 * vertical rule. A crosshair snaps to the nearest period and lists every series there; the arrow keys do the same.
 * A single series on a zero baseline carries a faint area down to zero; each line ends in a ringed dot.
 */
import { useMemo, useState } from "react";
import {
  ChartCanvas,
  axisText,
  localPoint,
  textWidth,
  type TipSpec,
  type TooltipContent,
} from "./canvas";
import type { ValueFormatter } from "./format";
import { seriesVar } from "./palette";
import { dodgeLabels, labelStride, linearScale, niceDomain, pointPositions } from "./scale";
import {
  alignToAxis,
  extentValues,
  isolatedIndices,
  lastCompleteIndex,
  lineSegments,
  moeRuns,
  type Annotation,
  type PeriodAxis,
  type TrendDatum,
  type TrendSeriesInput,
} from "./series";

export type LineTrendProps = {
  series: readonly TrendSeriesInput[];
  axis: PeriodAxis;
  formatter: ValueFormatter;
  /** Unit words for the tooltip ("cases"); omit when the formatter already writes the unit. */
  unit?: string | undefined;
  ariaLabel: string;
  height?: number | undefined;
  width?: number | undefined;
  annotations?: readonly Annotation[] | undefined;
  /** Force 0 into the value axis (default true: honest baselines). */
  zero?: boolean | undefined;
  /** Shared value domain (small multiples). */
  yDomain?: readonly [number, number] | undefined;
  /** Palette slot of each series; defaults to its position. Colour follows the entity, never its rank. */
  colorSlot?: ((seriesId: string, index: number) => number) | undefined;
  /** Series to emphasise; the others are drawn in a muted grey. */
  highlight?: string | null | undefined;
  /**
   * Label line ends directly: the last value (one series) or name and last value (two to four series). Default: on
   * when there is room (not compact, at most four series, at least 420 px wide).
   */
  directLabels?: boolean | undefined;
  /** Fewer ticks and no direct labels (sparklines, small multiples). */
  compact?: boolean | undefined;
  /** What the shaded band is ("90% margin of error, as published"). */
  bandLabel?: string | undefined;
  /** Faint area under the line down to zero (default: one series on a zero baseline, not compact). */
  area?: boolean | undefined;
};

const MARGIN = { top: 16, bottom: 22 };

export function LineTrend({
  series,
  axis,
  formatter,
  unit,
  ariaLabel,
  height = 200,
  width,
  annotations = [],
  zero = true,
  yDomain,
  colorSlot = (_id, i) => i,
  highlight = null,
  directLabels,
  compact = false,
  bandLabel = "margin of error, as published",
  area,
}: LineTrendProps) {
  const [active, setActive] = useState<number | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const aligned = useMemo(() => series.map((s) => alignToAxis(s, axis.keys)), [series, axis.keys]);
  const { domain, ticks } = useMemo(() => {
    if (yDomain) {
      const nd = niceDomain([yDomain[0], yDomain[1]], { zero, count: compact ? 2 : 4 });
      return nd;
    }
    return niceDomain(extentValues(series), { zero, count: compact ? 2 : 4 });
  }, [series, yDomain, zero, compact]);
  const color = (i: number) => {
    const s = series[i]!;
    if (highlight && highlight !== s.id) return "var(--chart-muted-mark)";
    return seriesVar(colorSlot(s.id, i));
  };
  const leftMargin = Math.max(24, ...ticks.map((t) => textWidth(formatter.tick(t)) + 8));
  const describe = (i: number) => {
    const key = axis.keys[i]!;
    const parts = series.map(
      (s, si) => `${s.label}: ${valueText(aligned[si]![i], formatter, unit)}`,
    );
    const partial = aligned.some((a) => a[i]?.partial);
    return `${axis.label(key)}${partial ? " (partial period)" : ""}. ${parts.join("; ")}.`;
  };

  return (
    <ChartCanvas
      width={width}
      height={height}
      ariaLabel={ariaLabel}
      count={axis.keys.length}
      active={active}
      onActive={(i) => {
        setActive(i);
        setPointer(null);
      }}
      describe={describe}
    >
      {(w) => {
        const wantLabels =
          directLabels ?? (!compact && series.length >= 1 && series.length <= 4 && w >= 420);
        const ends0 = series.map((_, si) => lastCompleteIndexOrAny(aligned[si]!));
        const endText = (si: number) => {
          const ei = ends0[si]!;
          if (ei < 0) return "";
          const v = formatter.full(aligned[si]![ei]!.value as number);
          return series.length === 1 ? v : `${truncate(series[si]!.label, 18)} ${v}`;
        };
        const labelRoom = wantLabels
          ? Math.min(
              176,
              Math.max(...series.map((_, si) => textWidth(endText(si), 11.5) * 1.06)) + 18,
            )
          : 8;
        const plotRight = w - labelRoom;
        const xs = pointPositions(axis.keys.length, [leftMargin, plotRight]);
        const y = linearScale(domain, [height - MARGIN.bottom, MARGIN.top]);
        const stride = labelStride(
          axis.keys.length,
          plotRight - leftMargin,
          Math.max(...axis.keys.map((k) => textWidth(axis.tick(k)) + 10), 24),
        );
        const xIndex = (px: number) => {
          if (!xs.length) return null;
          let best = 0;
          for (let i = 1; i < xs.length; i++)
            if (Math.abs(xs[i]! - px) < Math.abs(xs[best]! - px)) best = i;
          return best;
        };
        const ends = ends0;
        const endYs = dodgeLabels(
          ends.map((ei, si) => (ei >= 0 ? y(aligned[si]![ei]!.value as number) : height / 2)),
          14,
          MARGIN.top,
          height - MARGIN.bottom,
        );
        const tip: TipSpec | null =
          active !== null && xs[active] !== undefined
            ? {
                content: tooltipFor(active, axis, series, aligned, formatter, unit, color),
                x: pointer?.x ?? xs[active]!,
                y: pointer?.y ?? MARGIN.top,
              }
            : null;
        const marks = (
          <>
            {/* grid and value axis */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={leftMargin}
                  x2={plotRight}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === domain[0] ? "var(--chart-baseline)" : "var(--chart-grid)"}
                  strokeOpacity={t === domain[0] ? 1 : 0.55}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text x={leftMargin - 6} y={y(t)} dy="0.32em" textAnchor="end" {...axisText}>
                  {formatter.tick(t)}
                </text>
              </g>
            ))}
            {/* period axis */}
            {axis.keys.map((k, i) =>
              (axis.showTick ? axis.showTick(k, i) : i % stride === 0) ? (
                <text key={k} x={xs[i]} y={height - 6} textAnchor="middle" {...axisText}>
                  {axis.tick(k)}
                </text>
              ) : null,
            )}
            {/* annotations: reporting changes */}
            {annotations.map((a) => {
              const i = axis.keys.indexOf(a.key);
              if (i < 0) return null;
              return (
                <g key={`${a.key}-${a.label}`}>
                  <line
                    x1={xs[i]}
                    x2={xs[i]}
                    y1={MARGIN.top - 4}
                    y2={height - MARGIN.bottom}
                    stroke="var(--chart-axis)"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                  />
                  <text
                    x={xs[i]! + 3}
                    y={MARGIN.top - 6}
                    {...axisText}
                    textAnchor={xs[i]! > plotRight - 80 ? "end" : "start"}
                  >
                    {a.label}
                  </text>
                </g>
              );
            })}
            {/* margin-of-error bands */}
            {series.map((s, si) =>
              moeRuns(aligned[si]!).map((run, ri) => {
                if (run.length < 2) {
                  const p = run[0]!;
                  return (
                    <line
                      key={`${s.id}-band-${ri}`}
                      x1={xs[p.index]}
                      x2={xs[p.index]}
                      y1={y(p.lo)}
                      y2={y(p.hi)}
                      stroke={color(si)}
                      strokeOpacity={0.35}
                      strokeWidth={4}
                    />
                  );
                }
                const top = run.map((p) => `${xs[p.index]},${y(p.hi)}`);
                const bottom = [...run].reverse().map((p) => `${xs[p.index]},${y(p.lo)}`);
                return (
                  <polygon
                    key={`${s.id}-band-${ri}`}
                    points={[...top, ...bottom].join(" ")}
                    fill={color(si)}
                    fillOpacity={0.12}
                  >
                    <title>{bandLabel}</title>
                  </polygon>
                );
              }),
            )}
            {/* faint area under a single line, to the zero baseline */}
            {(area ?? (series.length === 1 && !compact)) && domain[0] === 0 && series.length === 1
              ? lineSegments(aligned[0]!).map((seg, gi) =>
                  seg.indices.length > 1 ? (
                    <polygon
                      key={`area-${gi}`}
                      points={[
                        `${xs[seg.indices[0]!]},${y(0)}`,
                        ...seg.indices.map((i) => `${xs[i]},${y(aligned[0]![i]!.value as number)}`),
                        `${xs[seg.indices[seg.indices.length - 1]!]},${y(0)}`,
                      ].join(" ")}
                      fill={color(0)}
                      fillOpacity={0.08}
                      stroke="none"
                    />
                  ) : null,
                )
              : null}
            {/* lines */}
            {series.map((s, si) => {
              const a = aligned[si]!;
              const c = color(si);
              const emphasis = !highlight || highlight === s.id;
              return (
                <g key={s.id} data-series={s.id}>
                  {lineSegments(a).map((seg, gi) => (
                    <polyline
                      key={gi}
                      points={seg.indices
                        .map((i) => `${xs[i]},${y(a[i]!.value as number)}`)
                        .join(" ")}
                      fill="none"
                      stroke={c}
                      strokeWidth={emphasis ? 2 : 1.25}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      {...(seg.dashed ? { strokeDasharray: "4 4" } : {})}
                    />
                  ))}
                  {isolatedIndices(a).map((i) => (
                    <circle
                      key={`iso-${i}`}
                      cx={xs[i]}
                      cy={y(a[i]!.value as number)}
                      r={3}
                      fill={a[i]!.partial ? "var(--chart-surface)" : c}
                      stroke={a[i]!.partial ? c : "var(--chart-surface)"}
                      strokeWidth={a[i]!.partial ? 1.5 : 2}
                    />
                  ))}
                  {ends[si]! >= 0 && !compact ? (
                    <circle
                      cx={xs[ends[si]!]}
                      cy={y(a[ends[si]!]!.value as number)}
                      r={3.5}
                      fill={c}
                      stroke="var(--chart-surface)"
                      strokeWidth={1.5}
                    />
                  ) : null}
                </g>
              );
            })}
            {/* direct labels at line ends */}
            {wantLabels
              ? series.map((s, si) =>
                  ends[si]! >= 0 ? (
                    <text
                      key={`label-${s.id}`}
                      x={plotRight + 8}
                      y={endYs[si]}
                      dy="0.32em"
                      fontSize={11.5}
                      fontWeight={600}
                      fill="var(--chart-ink)"
                      className="tabular-nums"
                    >
                      {endText(si)}
                    </text>
                  ) : null,
                )
              : null}
            {/* crosshair */}
            {active !== null && xs[active] !== undefined ? (
              <g pointerEvents="none">
                <line
                  x1={xs[active]}
                  x2={xs[active]}
                  y1={MARGIN.top}
                  y2={height - MARGIN.bottom}
                  stroke="var(--chart-axis)"
                  strokeOpacity={0.6}
                  strokeWidth={1}
                />
                {series.map((s, si) => {
                  const d = aligned[si]![active];
                  if (!d || d.value === null) return null;
                  return (
                    <circle
                      key={s.id}
                      cx={xs[active]}
                      cy={y(d.value)}
                      r={4}
                      fill={color(si)}
                      stroke="var(--chart-surface)"
                      strokeWidth={1.5}
                    />
                  );
                })}
              </g>
            ) : null}
            <rect
              x={leftMargin}
              y={0}
              width={Math.max(0, plotRight - leftMargin)}
              height={height}
              fill="transparent"
              onPointerMove={(e) => {
                const p = localPoint(e);
                setActive(xIndex(p.x));
                setPointer(p);
              }}
              onPointerLeave={() => {
                setActive(null);
                setPointer(null);
              }}
            />
          </>
        );
        return { marks, tooltip: tip };
      }}
    </ChartCanvas>
  );
}

function lastCompleteIndexOrAny(aligned: readonly (TrendDatum | undefined)[]): number {
  const i = lastCompleteIndex(aligned);
  if (i >= 0) return i;
  for (let k = aligned.length - 1; k >= 0; k--) if (typeof aligned[k]?.value === "number") return k;
  return -1;
}

export function valueText(
  d: TrendDatum | undefined,
  formatter: ValueFormatter,
  unit?: string | undefined,
): string {
  if (!d || d.value === null || !Number.isFinite(d.value)) return "Not recorded";
  const moe =
    typeof d.moe === "number" && Number.isFinite(d.moe) ? ` ± ${formatter.full(d.moe)}` : "";
  return `${formatter.full(d.value)}${moe}${unit ? ` ${unit}` : ""}`;
}

function tooltipFor(
  i: number,
  axis: PeriodAxis,
  series: readonly TrendSeriesInput[],
  aligned: readonly (TrendDatum | undefined)[][],
  formatter: ValueFormatter,
  unit: string | undefined,
  color: (si: number) => string,
): TooltipContent {
  const key = axis.keys[i]!;
  const partial = aligned.some((a) => a[i]?.partial);
  return {
    title: axis.label(key),
    subtitle: partial ? "Partial period" : undefined,
    rows: series.map((s, si) => {
      const d = aligned[si]![i];
      return {
        key: s.id,
        label: s.label,
        value: valueText(d, formatter, series.length === 1 ? unit : undefined),
        color: series.length > 1 ? color(si) : undefined,
        note: typeof d?.n === "number" ? `n = ${d.n.toLocaleString("en-US")}` : undefined,
      };
    }),
  };
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
