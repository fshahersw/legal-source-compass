/**
 * Column chart over periods: one series, grouped series, or stacked parts of one whole. Bars are at most 24px wide
 * with a rounded data end and a square baseline; a partial period is drawn hatched; a period the source does not record
 * gets a short hatched grey stub at the baseline so it never reads as zero. Each period is one hover/keyboard target.
 */
import { useId, useMemo, useState, type ReactNode } from "react";
import { ChartCanvas, axisText, localPoint, textWidth, type TipSpec } from "./canvas";
import type { ValueFormatter } from "./format";
import { valueText } from "./LineTrend";
import { seriesVar } from "./palette";
import { bands, labelStride, linearScale, niceDomain } from "./scale";
import { alignToAxis, type Annotation, type PeriodAxis, type TrendSeriesInput } from "./series";

export type BarTrendProps = {
  series: readonly TrendSeriesInput[];
  axis: PeriodAxis;
  formatter: ValueFormatter;
  unit?: string | undefined;
  ariaLabel: string;
  stacked?: boolean | undefined;
  height?: number | undefined;
  width?: number | undefined;
  annotations?: readonly Annotation[] | undefined;
  colorSlot?: ((seriesId: string, index: number) => number) | undefined;
};

const MARGIN = { top: 16, bottom: 22, right: 8 };
const MAX_BAR = 24;
const GAP = 2;

/** Path of a column with a rounded top (or bottom for negatives) and a square baseline end. */
export function columnPath(x: number, w: number, y0: number, y1: number, r = 4): string {
  const h = Math.abs(y1 - y0);
  if (h < 0.5 || w <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  if (y1 < y0) {
    // grows upward: data end at y1 (top)
    return `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 - rr}V${y0}Z`;
}

export function BarTrend({
  series,
  axis,
  formatter,
  unit,
  ariaLabel,
  stacked = false,
  height = 200,
  width,
  annotations = [],
  colorSlot = (_id, i) => i,
}: BarTrendProps) {
  const [active, setActive] = useState<number | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const hatch = useId().replace(/[^a-zA-Z0-9]/g, "");
  const aligned = useMemo(() => series.map((s) => alignToAxis(s, axis.keys)), [series, axis.keys]);
  const extent = useMemo(() => {
    const vals: number[] = [];
    axis.keys.forEach((_, i) => {
      if (stacked) {
        let pos = 0;
        let neg = 0;
        for (const a of aligned) {
          const v = a[i]?.value;
          if (typeof v === "number") {
            if (v >= 0) pos += v;
            else neg += v;
          }
        }
        vals.push(pos, neg);
      } else for (const a of aligned) if (typeof a[i]?.value === "number") vals.push(a[i]!.value!);
    });
    return vals;
  }, [aligned, axis.keys, stacked]);
  const { domain, ticks } = useMemo(() => niceDomain(extent, { zero: true, count: 4 }), [extent]);
  const color = (si: number) => seriesVar(colorSlot(series[si]!.id, si));
  const leftMargin = Math.max(24, ...ticks.map((t) => textWidth(formatter.tick(t)) + 8));
  const describe = (i: number) => {
    const partial = aligned.some((a) => a[i]?.partial);
    return `${axis.label(axis.keys[i]!)}${partial ? " (partial period)" : ""}. ${series
      .map((s, si) => `${s.label}: ${valueText(aligned[si]![i], formatter, unit)}`)
      .join("; ")}.`;
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
        const plotRight = w - MARGIN.right;
        const band = bands(axis.keys.length, [leftMargin, plotRight], 0.25);
        const y = linearScale(domain, [height - MARGIN.bottom, MARGIN.top]);
        const groups = stacked ? 1 : series.length;
        const barW = Math.max(
          1,
          Math.min(MAX_BAR, (band.width - GAP * (groups - 1)) / Math.max(1, groups)),
        );
        const groupW = barW * groups + GAP * (groups - 1);
        const stride = labelStride(
          axis.keys.length,
          plotRight - leftMargin,
          Math.max(...axis.keys.map((k) => textWidth(axis.tick(k)) + 10), 24),
        );
        const centre = (i: number) => band.start(i) + band.width / 2;
        const marks = (
          <>
            <defs>
              {series.map((_, si) => (
                <pattern
                  key={si}
                  id={`${hatch}-p${si}`}
                  width="5"
                  height="5"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="5" height="5" fill={color(si)} fillOpacity={0.25} />
                  <line x1="0" y1="0" x2="0" y2="5" stroke={color(si)} strokeWidth="2" />
                </pattern>
              ))}
              <pattern
                id={`${hatch}-nr`}
                width="4"
                height="4"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="4" height="4" fill="var(--muted)" />
                <line x1="0" y1="0" x2="0" y2="4" stroke="var(--chart-axis)" strokeOpacity={0.5} />
              </pattern>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={leftMargin}
                  x2={plotRight}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 ? "var(--border-strong)" : "var(--chart-grid)"}
                  shapeRendering="crispEdges"
                />
                <text x={leftMargin - 6} y={y(t)} dy="0.32em" textAnchor="end" {...axisText}>
                  {formatter.tick(t)}
                </text>
              </g>
            ))}
            {axis.keys.map((k, i) =>
              (axis.showTick ? axis.showTick(k, i) : i % stride === 0) ? (
                <text key={k} x={centre(i)} y={height - 6} textAnchor="middle" {...axisText}>
                  {axis.tick(k)}
                </text>
              ) : null,
            )}
            {active !== null ? (
              <rect
                x={band.start(active) - band.step * 0.1}
                y={MARGIN.top}
                width={band.width + band.step * 0.2}
                height={height - MARGIN.top - MARGIN.bottom}
                fill="var(--muted)"
                fillOpacity={0.7}
              />
            ) : null}
            {axis.keys.map((k, i) => {
              const x0 = centre(i) - groupW / 2;
              let posBase = 0;
              let negBase = 0;
              const allMissing = aligned.every((a) => typeof a[i]?.value !== "number");
              return (
                <g key={k}>
                  {allMissing ? (
                    <rect
                      x={centre(i) - Math.min(barW, 10) / 2}
                      y={y(0) - 4}
                      width={Math.min(barW, 10)}
                      height={4}
                      fill={`url(#${hatch}-nr)`}
                    >
                      <title>{`${axis.label(k)}: Not recorded`}</title>
                    </rect>
                  ) : null}
                  {series.map((s, si) => {
                    const d = aligned[si]![i];
                    const v = d?.value;
                    if (typeof v !== "number" || v === 0) return null;
                    let from: number;
                    let to: number;
                    if (stacked) {
                      from = v >= 0 ? posBase : negBase;
                      to = from + v;
                      if (v >= 0) posBase = to;
                      else negBase = to;
                    } else {
                      from = 0;
                      to = v;
                    }
                    const bx = stacked ? x0 : x0 + si * (barW + GAP);
                    const y0 = y(from);
                    const y1 = y(to);
                    // a 2px surface gap between stacked segments
                    const gapAdj = stacked && from !== 0 ? (v >= 0 ? -GAP : GAP) : 0;
                    const topSegment =
                      !stacked ||
                      aligned
                        .slice(si + 1)
                        .every(
                          (a) =>
                            typeof a[i]?.value !== "number" ||
                            Math.sign(a[i]!.value!) !== Math.sign(v),
                        );
                    return (
                      <path
                        key={s.id}
                        d={columnPath(bx, barW, y0 + gapAdj, y1, topSegment ? 4 : 0)}
                        fill={d?.partial ? `url(#${hatch}-p${si})` : color(si)}
                      />
                    );
                  })}
                  {stacked &&
                  !allMissing &&
                  aligned.some((a) => typeof a[i]?.value !== "number") ? (
                    // a part of the whole is not recorded: a hatched cap says so, and no total is implied
                    <rect
                      x={x0}
                      y={y(aligned.reduce((sum, a) => sum + Math.max(0, a[i]?.value ?? 0), 0)) - 6}
                      width={barW}
                      height={4}
                      fill={`url(#${hatch}-nr)`}
                    >
                      <title>{`${axis.label(k)}: ${series
                        .filter((_, si) => typeof aligned[si]![i]?.value !== "number")
                        .map((s) => s.label)
                        .join(", ")} not recorded`}</title>
                    </rect>
                  ) : null}
                </g>
              );
            })}
            {lastLabel(aligned, stacked, series.length, (li, v) => (
              <text
                x={centre(li)}
                y={y(Math.max(0, v)) - 5}
                textAnchor="middle"
                fontSize={12}
                fontWeight={600}
                fill="var(--chart-ink)"
                stroke="var(--chart-surface)"
                strokeWidth={3}
                paintOrder="stroke"
                className="tabular-nums"
                pointerEvents="none"
              >
                {formatter.tick(v)}
              </text>
            ))}
            {annotations.map((a) => {
              const i = axis.keys.indexOf(a.key);
              if (i < 0) return null;
              const x = band.start(i) - (band.step - band.width) / 2;
              return (
                <g key={`${a.key}-${a.label}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={MARGIN.top - 4}
                    y2={height - MARGIN.bottom}
                    stroke="var(--chart-axis)"
                    strokeDasharray="3 3"
                  />
                  <text x={x + 3} y={MARGIN.top - 6} {...axisText}>
                    {a.label}
                  </text>
                </g>
              );
            })}
            <rect
              x={leftMargin}
              y={0}
              width={Math.max(0, plotRight - leftMargin)}
              height={height}
              fill="transparent"
              onPointerMove={(e) => {
                const p = localPoint(e);
                const i = Math.floor((p.x - leftMargin) / Math.max(1, band.step));
                setActive(i >= 0 && i < axis.keys.length ? i : null);
                setPointer(p);
              }}
              onPointerLeave={() => {
                setActive(null);
                setPointer(null);
              }}
            />
          </>
        );
        const tooltip: TipSpec | null =
          active !== null
            ? {
                x: pointer?.x ?? centre(active),
                y: pointer?.y ?? MARGIN.top,
                content: {
                  title: axis.label(axis.keys[active]!),
                  subtitle: aligned.some((a) => a[active]?.partial) ? "Partial period" : undefined,
                  rows: series.map((s, si) => ({
                    key: s.id,
                    label: s.label,
                    value: valueText(
                      aligned[si]![active],
                      formatter,
                      series.length === 1 ? unit : undefined,
                    ),
                    color: series.length > 1 ? color(si) : undefined,
                  })),
                  footer:
                    stacked && series.length > 1
                      ? aligned.every((a) => typeof a[active]?.value === "number")
                        ? `Total: ${formatter.full(
                            aligned.reduce((sum, a) => sum + (a[active]!.value as number), 0),
                          )}`
                        : "Total not shown: a part is not recorded."
                      : undefined,
                },
              }
            : null;
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}

/** The latest complete value of a single-series column chart gets its value on the cap (one label, never all). */
function lastLabel(
  aligned: readonly (readonly (
    { value: number | null; partial?: boolean | undefined } | undefined
  )[])[],
  stacked: boolean,
  seriesCount: number,
  draw: (index: number, value: number) => ReactNode,
): ReactNode {
  if (stacked || seriesCount !== 1) return null;
  const a = aligned[0]!;
  for (let k = a.length - 1; k >= 0; k--) {
    const d = a[k];
    if (d && typeof d.value === "number" && !d.partial) return draw(k, d.value);
  }
  return null;
}
