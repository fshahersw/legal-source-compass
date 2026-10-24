/**
 * One signed series over periods: the area above the zero line in one tone, below it in the other, ending exactly on
 * zero where the series crosses. The peak, the lowest value (when negative) and the last complete value are marked and
 * written; one optional annotation explains the turn with a curved arrow. The two tones are the palette's diverging
 * pair (slots 1 and 2); they say which side of zero, never good or bad.
 *
 * A partial period is drawn as a dashed edge and an open dot and is never the "last value". A period the source does
 * not record breaks the area; it is never joined across.
 */
import { useId, useMemo, useState } from "react";
import { ChartCanvas, localPoint, textWidth, type TipSpec } from "../canvas";
import type { ValueFormatter } from "../format";
import { linearScale, niceDomain } from "../scale";
import { alignToAxis, extentValues, type PeriodAxis, type TrendSeriesInput } from "../series";
import { SeriesLegend } from "../recharts/content";
import {
  areaUnder,
  boxesOverlap,
  leaderPath,
  linePath,
  placeCallout,
  segmentHitsBox,
  signedRuns,
  type Box,
  type Placement,
  type Pt,
} from "./geometry";
import {
  Dot,
  HaloText,
  PeriodTicks,
  SmoothNote,
  ValueGrid,
  edgeToEdge,
  nearestIndex,
} from "./parts";

export type DivergingAreaTrendProps = {
  series: TrendSeriesInput;
  axis: PeriodAxis;
  formatter: ValueFormatter;
  smooth?: boolean | undefined;
  /** What above zero means ("Filed more than terminated"); with `negativeLabel` it becomes the key above the chart. */
  positiveLabel?: string | undefined;
  negativeLabel?: string | undefined;
  /** One note with a curved arrow to a period ("First year terminations exceeded filings"). */
  annotation?: { key: string; label: string } | undefined;
  unit?: string | undefined;
  ariaLabel: string;
  height?: number | undefined;
  width?: number | undefined;
  className?: string | undefined;
};

const TOP = 30;
const BOTTOM = 24;

export function DivergingAreaTrend({
  series,
  axis,
  formatter,
  smooth = false,
  positiveLabel,
  negativeLabel,
  annotation,
  unit,
  ariaLabel,
  height = 280,
  width,
  className,
}: DivergingAreaTrendProps) {
  const [active, setActive] = useState<number | null>(null);
  const arrow = `dv-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const aligned = useMemo(() => alignToAxis(series, axis.keys), [series, axis.keys]);
  const n = axis.keys.length;
  const { domain, ticks } = useMemo(
    () => niceDomain([...extentValues([series]), 0], { zero: true, count: 4 }),
    [series],
  );
  const complete = aligned.map((d) =>
    typeof d?.value === "number" && Number.isFinite(d.value) && !d.partial ? d.value : null,
  );
  const signed = (v: number) =>
    v > 0 ? `+${formatter.full(v)}` : v < 0 ? `−${formatter.full(-v)}` : formatter.full(0);
  const leftMargin = Math.max(28, ...ticks.map((t) => textWidth(formatter.tick(t)) + 10));
  const describe = (i: number) => {
    const d = aligned[i];
    return `${axis.label(axis.keys[i]!)}${d?.partial ? " (partial period)" : ""}: ${typeof d?.value === "number" ? signed(d.value) : "Not recorded"}.`;
  };
  // extremes over complete periods only
  let peakI = -1;
  let lowI = -1;
  let lastI = -1;
  complete.forEach((v, i) => {
    if (v === null) return;
    lastI = i;
    if (peakI < 0 || v > complete[peakI]!) peakI = i;
    if (lowI < 0 || v < complete[lowI]!) lowI = i;
  });
  return (
    <div className={className}>
      {positiveLabel && negativeLabel ? (
        <SeriesLegend
          mark="swatch"
          className="pb-2"
          items={[
            { id: "pos", label: positiveLabel, color: "var(--chart-1)" },
            { id: "neg", label: negativeLabel, color: "var(--chart-2)" },
          ]}
        />
      ) : null}
      <ChartCanvas
        width={width}
        height={height}
        ariaLabel={ariaLabel}
        count={n}
        active={active}
        onActive={setActive}
        describe={describe}
      >
        {(w) => {
          const plotRight = w - 14;
          const xs = edgeToEdge(n, leftMargin + 4, plotRight);
          const y = linearScale(domain, [height - BOTTOM, TOP]);
          const y0 = y(0);
          const plot: Box = {
            x: leftMargin,
            y: TOP - 12,
            w: plotRight - leftMargin,
            h: height - BOTTOM - TOP + 12,
          };
          const runs = signedRuns(xs, complete);
          const px = (i: number) => ({ x: xs[i]!, y: y(complete[i]!) });
          const taken: Box[] = [];
          // peak, low and last labels
          const labelAt = (i: number, above: boolean) => {
            const p = px(i);
            const text = signed(complete[i]!);
            const tw = textWidth(text, 12) + 4;
            const x = Math.min(plotRight - tw, Math.max(leftMargin + 2, p.x - tw / 2));
            const yy = above ? p.y - 14 : p.y + 16;
            return { x, y: yy, text, box: { x, y: yy - 8, w: tw, h: 16 } };
          };
          // the peak, then the last value, then the low: a label that would sit on another is left out (its dot stays)
          const wanted: { i: number; above: boolean; tone: 1 | 2 }[] = [];
          if (peakI >= 0 && complete[peakI]! > 0) wanted.push({ i: peakI, above: true, tone: 1 });
          if (lastI >= 0 && lastI !== peakI)
            wanted.push({
              i: lastI,
              above: complete[lastI]! >= 0,
              tone: complete[lastI]! >= 0 ? 1 : 2,
            });
          if (lowI >= 0 && complete[lowI]! < 0 && lowI !== lastI)
            wanted.push({ i: lowI, above: false, tone: 2 });
          const labelled: (ReturnType<typeof labelAt> & {
            i: number;
            tone: 1 | 2;
            show: boolean;
          })[] = [];
          for (const m of wanted) {
            const l = labelAt(m.i, m.above);
            const show = !taken.some((t) => boxesOverlap(l.box, t, 2));
            if (show) taken.push(l.box);
            labelled.push({ ...l, i: m.i, tone: m.tone, show });
          }
          // the plotted line: an annotation never sits across it
          const lineSegs: [Pt, Pt][] = [];
          for (let i = 0; i + 1 < n; i++)
            if (complete[i] !== null && complete[i + 1] !== null) lineSegs.push([px(i), px(i + 1)]);
          // the annotation: a curved arrow from its label to the period
          const ai = annotation ? axis.keys.indexOf(annotation.key) : -1;
          const aPoint = ai >= 0 && complete[ai] !== null ? px(ai) : null;
          const aSize = annotation
            ? { w: Math.min(190, textWidth(annotation.label, 12) + 4), h: 16 }
            : null;
          // the arrow runs from the label's near edge to the period; it must not cross a value label
          const leaderOf = (spot: Placement, to: Pt): [Pt, Pt] => [
            {
              x: spot.box.x + (to.x > spot.box.x + spot.box.w / 2 ? spot.box.w : 0),
              y: spot.box.y + spot.box.h / 2,
            },
            to,
          ];
          const crossesLabel = (spot: Placement, to: Pt) => {
            const [from, end] = leaderOf(spot, to);
            return labelled.some((m) => m.show && segmentHitsBox(from, end, m.box, 2));
          };
          const place = (prefer: "up" | "down" | "side") =>
            aPoint && aSize ? placeCallout(aPoint, aSize, plot, taken, prefer, 40, lineSegs) : null;
          let aSpot = place(complete[ai] !== null && complete[ai]! >= 0 ? "up" : "down");
          if (aSpot && aPoint && crossesLabel(aSpot, aPoint)) {
            const beside = place("side");
            if (beside && !crossesLabel(beside, aPoint)) aSpot = beside;
            else
              for (const m of labelled)
                if (m.show && segmentHitsBox(...leaderOf(aSpot, aPoint), m.box, 2)) m.show = false;
          }
          const partialIdx = aligned.findIndex((d) => typeof d?.value === "number" && d.partial);
          const pointsFor = (run: { pts: { x: number; v: number }[] }) =>
            run.pts.map((p) => ({ x: p.x, y: y(p.v) }));
          const chart = (
            <>
              <defs>
                <marker
                  id={arrow}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill="var(--chart-ink)" />
                </marker>
              </defs>
              <ValueGrid
                ticks={ticks}
                y={y}
                x0={leftMargin}
                x1={plotRight}
                format={formatter.tick}
              />
              {runs.map((run, k) => {
                const pts = pointsFor(run);
                const tone = run.sign === 1 ? "var(--chart-1)" : "var(--chart-2)";
                return (
                  <g key={k}>
                    <path d={areaUnder(pts, y0, smooth)} fill={tone} fillOpacity={0.22} />
                    <path
                      d={linePath(pts, smooth)}
                      fill="none"
                      stroke={tone}
                      strokeWidth={1.75}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}
              {partialIdx > 0 && complete[partialIdx - 1] != null ? (
                <g pointerEvents="none">
                  <line
                    x1={xs[partialIdx - 1]}
                    y1={y(complete[partialIdx - 1]!)}
                    x2={xs[partialIdx]}
                    y2={y(aligned[partialIdx]!.value as number)}
                    stroke="var(--chart-ink)"
                    strokeOpacity={0.6}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />
                  <circle
                    cx={xs[partialIdx]}
                    cy={y(aligned[partialIdx]!.value as number)}
                    r={3.5}
                    fill="var(--chart-surface)"
                    stroke="var(--chart-ink)"
                    strokeWidth={1.5}
                  />
                  <text
                    x={xs[partialIdx]! - 6}
                    y={
                      y(aligned[partialIdx]!.value as number) +
                      (aligned[partialIdx]!.value! >= 0 ? -10 : 16)
                    }
                    textAnchor="end"
                    fontSize={11}
                    fill="var(--chart-axis)"
                  >
                    Partial period
                  </text>
                </g>
              ) : null}
              <PeriodTicks axis={axis} xs={xs} yText={height - 6} x0={leftMargin} x1={plotRight} />
              {labelled.map((m) => (
                <g key={`m${m.i}`} pointerEvents="none">
                  <Dot
                    x={px(m.i).x}
                    y={px(m.i).y}
                    r={4.5}
                    fill={m.tone === 1 ? "var(--chart-1)" : "var(--chart-2)"}
                  />
                  {m.show ? (
                    <HaloText x={m.x} y={m.y} anchor="start">
                      {m.text}
                    </HaloText>
                  ) : null}
                </g>
              ))}
              {aSpot && aPoint && annotation ? (
                <g pointerEvents="none">
                  <path
                    d={leaderPath(
                      {
                        x:
                          aSpot.box.x +
                          (aPoint.x > aSpot.box.x + aSpot.box.w / 2 ? aSpot.box.w : 0),
                        y: aSpot.box.y + aSpot.box.h / 2,
                      },
                      { x: aPoint.x, y: aPoint.y + (aPoint.y < aSpot.box.y ? 4 : -4) },
                      aPoint.x > aSpot.box.x ? -0.28 : 0.28,
                    )}
                    fill="none"
                    stroke="var(--chart-ink)"
                    strokeOpacity={0.75}
                    strokeWidth={1}
                    markerEnd={`url(#${arrow})`}
                  />
                  <HaloText x={aSpot.box.x} y={aSpot.box.y + aSpot.box.h / 2} weight={500}>
                    {annotation.label}
                  </HaloText>
                </g>
              ) : null}
              {active !== null && xs[active] !== undefined ? (
                <g pointerEvents="none">
                  <line
                    x1={xs[active]}
                    x2={xs[active]}
                    y1={TOP}
                    y2={height - BOTTOM}
                    stroke="var(--border-strong)"
                    strokeWidth={1}
                  />
                  {typeof aligned[active]?.value === "number" ? (
                    <Dot
                      x={xs[active]!}
                      y={y(aligned[active]!.value as number)}
                      r={4}
                      fill={
                        (aligned[active]!.value as number) >= 0
                          ? "var(--chart-1)"
                          : "var(--chart-2)"
                      }
                    />
                  ) : null}
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
                  y: TOP,
                  content: {
                    title: axis.label(axis.keys[active]!),
                    subtitle: aligned[active]?.partial ? "Partial period" : undefined,
                    rows: [
                      {
                        key: series.id,
                        label: series.label,
                        value:
                          typeof aligned[active]?.value === "number"
                            ? `${signed(aligned[active]!.value as number)}${unit ? ` ${unit}` : ""}`
                            : "Not recorded",
                      },
                    ],
                    footer:
                      typeof aligned[active]?.value === "number" && positiveLabel && negativeLabel
                        ? (aligned[active]!.value as number) > 0
                          ? positiveLabel
                          : (aligned[active]!.value as number) < 0
                            ? negativeLabel
                            : undefined
                        : undefined,
                  },
                }
              : null;
          return { marks: chart, tooltip: tip };
        }}
      </ChartCanvas>
      {smooth ? <SmoothNote /> : null}
    </div>
  );
}
