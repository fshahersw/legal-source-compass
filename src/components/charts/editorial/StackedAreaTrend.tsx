/**
 * Stacked or 100% areas over periods with the series named inside their own areas (a legend only past four series),
 * the latest total labelled, optional smoothing. A layer too thin for its name gets a label at the right edge with a
 * leader (four series or fewer). A period with any series not recorded is a gap in every layer, never a zero; a
 * partial period is hatched. Hover or the arrow keys read every series at a period.
 *
 * Smoothing is for display only (a monotone curve through the recorded points); the tooltip and the table carry the
 * recorded values.
 */
import { useId, useMemo, useState } from "react";
import { ChartCanvas, localPoint, textWidth, type TipSpec } from "../canvas";
import type { ValueFormatter } from "../format";
import { dodgeLabels, linearScale, niceDomain } from "../scale";
import { alignToAxis, type PeriodAxis, type TrendSeriesInput } from "../series";
import { SeriesLegend } from "../recharts/content";
import {
  areaBetween,
  boundarySegments,
  edgeSpans,
  isolatedPeriods,
  labelSpot,
  stackLayers,
} from "./geometry";
import {
  Dot,
  HaloText,
  PeriodTicks,
  SmoothNote,
  ValueGrid,
  edgeToEdge,
  nearestIndex,
  paintFor,
  type Paint,
} from "./parts";

export type StackedAreaTrendProps = {
  /** Layers from the bottom up. More than six series: fold the tail first (foldSeries) or list them in `otherIds`. */
  series: readonly TrendSeriesInput[];
  axis: PeriodAxis;
  formatter: ValueFormatter;
  /** "stack" shows counts; "percent" shows each period as 100%. */
  mode?: "stack" | "percent" | undefined;
  /** Monotone curve through the points (display only). */
  smooth?: boolean | undefined;
  unit?: string | undefined;
  ariaLabel: string;
  height?: number | undefined;
  width?: number | undefined;
  /** Series ids drawn in the neutral grey ("Other"). */
  otherIds?: readonly string[] | undefined;
  /** Palette slot per series (default: its position); colour follows the entity, never its rank. */
  colorSlot?: ((seriesId: string, index: number) => number) | undefined;
  /** Label the latest complete total above the stack (default: stack mode). */
  showTotal?: boolean | undefined;
  /** Legend above the plot (default: more than four series). */
  legend?: boolean | undefined;
  className?: string | undefined;
};

const MARGIN = { top: 26, bottom: 24, right: 12 };
const LABEL_H = 16;

export function StackedAreaTrend({
  series,
  axis,
  formatter,
  mode = "stack",
  smooth = false,
  unit,
  ariaLabel,
  height = 280,
  width,
  otherIds = [],
  colorSlot = (_id, i) => i,
  showTotal,
  legend,
  className,
}: StackedAreaTrendProps) {
  const [active, setActive] = useState<number | null>(null);
  const hatch = `sa-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const aligned = useMemo(() => series.map((s) => alignToAxis(s, axis.keys)), [series, axis.keys]);
  const n = axis.keys.length;
  const stacked = useMemo(
    () =>
      stackLayers(
        aligned.map((a) => a.map((d) => (typeof d?.value === "number" ? d.value : null))),
        mode,
      ),
    [aligned, mode],
  );
  const partialAt = useMemo(
    () => axis.keys.map((_, i) => aligned.some((a) => a[i]?.partial)),
    [aligned, axis.keys],
  );
  const paints: Paint[] = series.map((s, i) =>
    paintFor(i, { other: otherIds.includes(s.id) || i >= 6, slot: colorSlot(s.id, i) }),
  );
  const maxTotal = Math.max(0, ...stacked.total.map((t) => t ?? 0));
  const yDomain =
    mode === "percent"
      ? { domain: [0, 100] as [number, number], ticks: [0, 25, 50, 75, 100] }
      : niceDomain([0, maxTotal], { zero: true, count: 4 });
  const fmtTick = (v: number) => (mode === "percent" ? `${v}%` : formatter.tick(v));
  const leftMargin = Math.max(28, ...yDomain.ticks.map((t) => textWidth(fmtTick(t)) + 10));
  const showLegend = legend ?? series.length > 4;
  const wantTotal = (showTotal ?? mode === "stack") && mode === "stack";
  const lastIdx = lastCompleteIndexOf(stacked.drawable, partialAt);
  const describe = (i: number) => {
    const key = axis.keys[i]!;
    if (!stacked.drawable[i])
      return `${axis.label(key)}: not fully recorded, so no layers are drawn.`;
    const parts = series.map((s, si) => {
      const v = aligned[si]![i]!.value as number;
      return `${s.label}: ${formatter.full(v)}${mode === "percent" ? ` (${shareText(v, stacked.total[i]!)})` : ""}`;
    });
    return `${axis.label(key)}${partialAt[i] ? " (partial period)" : ""}. ${parts.join("; ")}. Total ${formatter.full(stacked.total[i]!)}.`;
  };
  return (
    <div className={className}>
      {showLegend ? (
        <SeriesLegend
          mark="swatch"
          className="pb-2"
          items={series.map((s, i) => ({ id: s.id, label: s.label, color: paints[i]!.fill }))}
        />
      ) : null}
      <ChartCanvas
        width={width}
        height={height}
        ariaLabel={`${ariaLabel}${smooth ? " Drawn smoothed for display; values are as recorded." : ""}`}
        count={n}
        active={active}
        onActive={setActive}
        describe={describe}
      >
        {(w) => {
          const labels = series.map((s) => s.label);
          const needOutsideRoom = series.length <= 4;
          const outsideW = Math.min(150, Math.max(...labels.map((l) => textWidth(l, 12) + 4))) + 20;
          const layout = (plotRight: number) => {
            const xs = edgeToEdge(n, leftMargin + 4, plotRight);
            const y = linearScale(yDomain.domain, [height - MARGIN.bottom, MARGIN.top]);
            const topPx = series.map((_, s) =>
              stacked.upper[s]!.map((v) => (v === null ? null : y(v))),
            );
            const botPx = series.map((_, s) =>
              stacked.lower[s]!.map((v) => (v === null ? null : y(v))),
            );
            const spots = series.map((s, si) =>
              // a name never sits across the hatched partial period
              labelSpot(
                xs,
                topPx[si]!.map((v, i) => (partialAt[i] ? null : v)),
                botPx[si]!.map((v, i) => (partialAt[i] ? null : v)),
                textWidth(s.label, 12) * 1.08 + 10,
                LABEL_H,
              ),
            );
            return { xs, y, topPx, botPx, spots };
          };
          // First pass on the full width; reserve right-edge room only when a short series needs an outside label.
          let plotRight = w - MARGIN.right;
          let L = layout(plotRight);
          const outside = needOutsideRoom && L.spots.some((s) => !s || !s.fits);
          if (outside) {
            plotRight = w - MARGIN.right - outsideW;
            L = layout(plotRight);
          }
          const { xs, y, topPx, botPx, spots } = L;
          const recorded = stacked.drawable;
          const spans = edgeSpans(recorded, partialAt);
          const lonely = isolatedPeriods(recorded);
          const marks = (
            <>
              <defs>
                {paints.map((p, i) => (
                  <pattern
                    key={i}
                    id={`${hatch}-${i}`}
                    width="6"
                    height="6"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <rect width="6" height="6" fill={p.fill} fillOpacity={0.4} />
                    <line x1="0" y1="0" x2="0" y2="6" stroke={p.fill} strokeWidth="2.5" />
                  </pattern>
                ))}
              </defs>
              <ValueGrid
                ticks={yDomain.ticks}
                y={y}
                x0={leftMargin}
                x1={plotRight}
                format={fmtTick}
              />
              {series.map((s, si) => (
                <g key={s.id} data-series={s.id}>
                  {spans.map((sp, k) => {
                    const idx = Array.from({ length: sp.to - sp.from + 1 }, (_, j) => sp.from + j);
                    const top = boundarySegments(
                      idx.map((i) => ({ x: xs[i]!, y: topPx[si]![i]! })),
                      smooth,
                    );
                    const bottom = boundarySegments(
                      idx.map((i) => ({ x: xs[i]!, y: botPx[si]![i]! })),
                      smooth,
                    );
                    const d = areaBetween(top, bottom);
                    return (
                      <path
                        key={k}
                        d={d}
                        fill={sp.partial ? `url(#${hatch}-${si})` : paints[si]!.fill}
                        stroke="var(--chart-surface)"
                        strokeWidth={1.25}
                        strokeLinejoin="round"
                      />
                    );
                  })}
                  {lonely.map((i) => (
                    <rect
                      key={`l${i}`}
                      x={xs[i]! - 2}
                      y={topPx[si]![i]!}
                      width={4}
                      height={Math.max(0.5, botPx[si]![i]! - topPx[si]![i]!)}
                      fill={paints[si]!.fill}
                    />
                  ))}
                </g>
              ))}
              {/* a period that is not fully recorded is a gap in every layer: say so on the baseline */}
              {gapRuns(recorded).map((g) => {
                const left = xs[Math.max(0, g.from - 1)]!;
                const right = xs[Math.min(n - 1, g.to + 1)]!;
                const mid = (MARGIN.top + height - MARGIN.bottom) / 2;
                const roomy = right - left >= textWidth("Not recorded", 11) + 10;
                const lines = roomy ? ["Not recorded"] : ["Not", "recorded"];
                return (
                  <g key={`gap${g.from}`}>
                    {lines.map((line, li) => (
                      <HaloText
                        key={line}
                        x={(left + right) / 2}
                        y={mid + (li - (lines.length - 1) / 2) * 13}
                        anchor="middle"
                        weight={500}
                        size={11}
                        fill="var(--chart-axis)"
                      >
                        {line}
                      </HaloText>
                    ))}
                  </g>
                );
              })}
              <PeriodTicks axis={axis} xs={xs} yText={height - 6} x0={leftMargin} x1={plotRight} />
              {/* names inside the areas, or at the right edge with a leader when the layer is too thin */}
              {(() => {
                const outsideIdx = needOutsideRoom
                  ? series.map((_, si) => si).filter((si) => !spots[si] || !spots[si]!.fits)
                  : [];
                const wantY = outsideIdx.map((si) => {
                  const li = lastDrawable(recorded);
                  return li < 0 ? 0 : (topPx[si]![li]! + botPx[si]![li]!) / 2;
                });
                const placed = dodgeLabels(wantY, 16, MARGIN.top + 6, height - MARGIN.bottom - 6);
                return (
                  <g>
                    {series.map((s, si) =>
                      spots[si]?.fits ? (
                        <text
                          key={`in-${s.id}`}
                          x={spots[si]!.x}
                          y={spots[si]!.y}
                          dy="0.32em"
                          textAnchor="middle"
                          fontSize={12}
                          fontWeight={600}
                          fill={paints[si]!.ink}
                          pointerEvents="none"
                        >
                          {s.label}
                        </text>
                      ) : null,
                    )}
                    {outsideIdx.map((si, k) => {
                      const li = lastDrawable(recorded);
                      if (li < 0) return null;
                      const edgeY = (topPx[si]![li]! + botPx[si]![li]!) / 2;
                      return (
                        <g key={`out-${series[si]!.id}`} pointerEvents="none">
                          <line
                            x1={xs[li]! + 2}
                            x2={plotRight + 8}
                            y1={edgeY}
                            y2={placed[k]}
                            stroke="var(--border-strong)"
                            strokeWidth={1}
                          />
                          <rect
                            x={plotRight + 12}
                            y={placed[k]! - 4}
                            width={8}
                            height={8}
                            rx={1.5}
                            fill={paints[si]!.fill}
                          />
                          <text
                            x={plotRight + 24}
                            y={placed[k]}
                            dy="0.32em"
                            fontSize={12}
                            fontWeight={600}
                            fill="var(--chart-ink)"
                          >
                            {series[si]!.label}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              })()}
              {wantTotal && lastIdx >= 0
                ? (() => {
                    const text = `Total ${formatter.full(stacked.total[lastIdx]!)}`;
                    const xEnd = xs[lastIdx]! + 4;
                    const reach = textWidth(text, 12) + 14;
                    // above the highest total under the label, so the text never sits on an area edge
                    let top = y(stacked.total[lastIdx]!);
                    for (let i = 0; i < n; i++)
                      if (xs[i]! >= xEnd - reach && xs[i]! <= xEnd && stacked.total[i] != null)
                        top = Math.min(top, y(stacked.total[i]!));
                    const ty = Math.max(MARGIN.top + 6, top - 12);
                    return (
                      <g pointerEvents="none">
                        <Dot
                          x={xs[lastIdx]!}
                          y={y(stacked.total[lastIdx]!)}
                          r={3.5}
                          fill="var(--chart-ink)"
                        />
                        <HaloText x={xEnd} y={ty} anchor="end">
                          {text}
                        </HaloText>
                      </g>
                    );
                  })()
                : null}
              {active !== null && xs[active] !== undefined ? (
                <g pointerEvents="none">
                  <line
                    x1={xs[active]}
                    x2={xs[active]}
                    y1={MARGIN.top}
                    y2={height - MARGIN.bottom}
                    stroke="var(--chart-ink)"
                    strokeOpacity={0.55}
                    strokeWidth={1}
                  />
                  {stacked.drawable[active]
                    ? series.map((s, si) => (
                        <Dot
                          key={s.id}
                          x={xs[active]!}
                          y={topPx[si]![active]!}
                          r={3.5}
                          fill={paints[si]!.fill}
                        />
                      ))
                    : null}
                </g>
              ) : null}
              <rect
                x={leftMargin}
                y={0}
                width={Math.max(0, plotRight - leftMargin)}
                height={height}
                fill="transparent"
                onPointerMove={(e) => setActive(nearestIndex(xs, localPoint(e).x))}
                onPointerLeave={() => setActive(null)}
              />
            </>
          );
          const tip: TipSpec | null =
            active !== null && xs[active] !== undefined
              ? {
                  x: xs[active]!,
                  y: MARGIN.top,
                  content: {
                    title: axis.label(axis.keys[active]!),
                    subtitle: partialAt[active] ? "Partial period" : undefined,
                    rows: [...series]
                      .map((s, si) => ({ s, si }))
                      .reverse()
                      .map(({ s, si }) => {
                        const d = aligned[si]![active];
                        const v = typeof d?.value === "number" ? d.value : null;
                        return {
                          key: s.id,
                          label: s.label,
                          value:
                            v === null
                              ? "Not recorded"
                              : `${formatter.full(v)}${unit ? ` ${unit}` : ""}${
                                  mode === "percent" && stacked.total[active] != null
                                    ? ` · ${shareText(v, stacked.total[active]!)}`
                                    : ""
                                }`,
                          color: paints[si]!.fill,
                        };
                      }),
                    footer: stacked.drawable[active]
                      ? `Total ${formatter.full(stacked.total[active]!)}${unit ? ` ${unit}` : ""}`
                      : "At least one series is not recorded, so no layers are drawn.",
                  },
                }
              : null;
          return { marks, tooltip: tip };
        }}
      </ChartCanvas>
      {smooth ? <SmoothNote /> : null}
    </div>
  );
}

const shareText = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "Not recorded";

/** Runs of periods that are not fully recorded (each is one gap in every layer). */
function gapRuns(drawable: readonly boolean[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  drawable.forEach((ok, i) => {
    if (ok) return;
    const last = out[out.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else out.push({ from: i, to: i });
  });
  return out;
}

function lastDrawable(drawable: readonly boolean[]): number {
  for (let i = drawable.length - 1; i >= 0; i--) if (drawable[i]) return i;
  return -1;
}

/** Last drawable period that is not partial (the total that may be labelled), or -1. */
function lastCompleteIndexOf(drawable: readonly boolean[], partial: readonly boolean[]): number {
  for (let i = drawable.length - 1; i >= 0; i--) if (drawable[i] && !partial[i]) return i;
  return -1;
}
