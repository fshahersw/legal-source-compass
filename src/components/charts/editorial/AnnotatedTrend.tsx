/**
 * A line (or area) over periods with the annotations that explain its shape: event rules (a vertical rule with its
 * label at the top), leader-line callouts for the peak, the low or a named break in the series, a labelled partial
 * period, and the last value written at the end of each line (up to four series; a legend beyond that). Nothing is
 * annotated that the caller did not supply or that is not a computed extreme of the plotted values: a callout reads
 * "Peak 241,438 (FY2020)", never an interpretation.
 */
import { useMemo, useState } from "react";
import { ChartCanvas, localPoint, textWidth, type TipSpec } from "../canvas";
import type { ValueFormatter } from "../format";
import { dodgeLabels, linearScale, niceDomain } from "../scale";
import {
  alignToAxis,
  extentValues,
  type PeriodAxis,
  type TrendDatum,
  type TrendSeriesInput,
} from "../series";
import { seriesVar } from "../palette";
import { SeriesLegend } from "../recharts/content";
import {
  areaUnder,
  edgeSpans,
  isolatedPeriods,
  linePath,
  placeCallout,
  staggerLevels,
  type Box,
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

export type TrendEvent = {
  /** Period key the rule stands on. */
  key: string;
  label: string;
  /** "break": the source changed what is counted (drawn with a dashed rule). */
  kind?: "event" | "break" | undefined;
};

/** A callout: the computed peak or low of the primary series, or a named point. */
export type TrendCallout =
  | "peak"
  | "low"
  | {
      key: string;
      seriesId?: string | undefined;
      label: string;
      prefer?: "up" | "down" | undefined;
    };

export type AnnotatedTrendProps = {
  series: readonly TrendSeriesInput[];
  axis: PeriodAxis;
  formatter: ValueFormatter;
  form?: "line" | "area" | undefined;
  smooth?: boolean | undefined;
  events?: readonly TrendEvent[] | undefined;
  callouts?: readonly TrendCallout[] | undefined;
  /** Text of the partial-period label; false leaves it off. */
  partialLabel?: string | false | undefined;
  /** Keep zero on the value axis (default true). */
  zero?: boolean | undefined;
  /** Write each line's last value (and name, with two or more series) at its end (default: four series or fewer). */
  endLabels?: boolean | undefined;
  unit?: string | undefined;
  ariaLabel: string;
  height?: number | undefined;
  width?: number | undefined;
  colorSlot?: ((seriesId: string, index: number) => number) | undefined;
  /** Series to emphasise; the others are drawn in the muted grey. */
  highlight?: string | null | undefined;
  className?: string | undefined;
};

const BOTTOM = 24;
const LABEL_H = 16;
const isNum = (d: TrendDatum | undefined): d is TrendDatum & { value: number } =>
  !!d && typeof d.value === "number" && Number.isFinite(d.value);

export function AnnotatedTrend({
  series,
  axis,
  formatter,
  form = "line",
  smooth = false,
  events = [],
  callouts = [],
  partialLabel = "Partial period",
  zero = true,
  endLabels,
  unit,
  ariaLabel,
  height = 280,
  width,
  colorSlot = (_id, i) => i,
  highlight = null,
  className,
}: AnnotatedTrendProps) {
  const [active, setActive] = useState<number | null>(null);
  const aligned = useMemo(() => series.map((s) => alignToAxis(s, axis.keys)), [series, axis.keys]);
  const n = axis.keys.length;
  const { domain, ticks } = useMemo(
    () => niceDomain(extentValues(series), { zero, count: 4 }),
    [series, zero],
  );
  const color = (si: number) =>
    highlight && highlight !== series[si]!.id
      ? "var(--chart-muted-mark)"
      : seriesVar(Math.min(colorSlot(series[si]!.id, si), 5));
  const showEnd = endLabels ?? series.length <= 4;
  const showLegend = series.length > 4;
  const knownEvents = events.filter((e) => axis.keys.includes(e.key));
  const leftMargin = Math.max(28, ...ticks.map((t) => textWidth(formatter.tick(t)) + 10));
  const lastRecorded = (si: number) => {
    const a = aligned[si]!;
    for (let i = a.length - 1; i >= 0; i--) if (isNum(a[i]) && !a[i]!.partial) return i;
    for (let i = a.length - 1; i >= 0; i--) if (isNum(a[i])) return i;
    return -1;
  };
  const endText = (si: number) => {
    const i = lastRecorded(si);
    if (i < 0) return "";
    const v = formatter.full(aligned[si]![i]!.value as number);
    return series.length === 1 ? v : `${series[si]!.label} ${v}`;
  };
  const describe = (i: number) => {
    const key = axis.keys[i]!;
    const parts = series.map(
      (s, si) =>
        `${s.label}: ${isNum(aligned[si]![i]) ? formatter.full(aligned[si]![i]!.value) : "Not recorded"}`,
    );
    const ev = knownEvents.filter((e) => e.key === key).map((e) => ` ${e.label}.`);
    return `${axis.label(key)}${aligned.some((a) => a[i]?.partial) ? " (partial period)" : ""}. ${parts.join("; ")}.${ev.join("")}`;
  };
  return (
    <div className={className}>
      {showLegend ? (
        <SeriesLegend
          className="pb-2"
          items={series.map((s, si) => ({ id: s.id, label: s.label, color: color(si) }))}
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
          const endRoom = showEnd
            ? Math.min(190, Math.max(...series.map((_, si) => textWidth(endText(si), 12))) + 18)
            : 12;
          const plotRight = w - endRoom;
          const xs = edgeToEdge(n, leftMargin + 4, plotRight);
          // event labels along the top: stagger them so none overlap
          const ordered = [...knownEvents].sort(
            (a, b) => axis.keys.indexOf(a.key) - axis.keys.indexOf(b.key),
          );
          const evBoxes = ordered.map((e) => {
            const x = xs[axis.keys.indexOf(e.key)]!;
            const tw = textWidth(e.label, 12) + 4;
            const left = x > (leftMargin + plotRight) / 2;
            return {
              e,
              x,
              tw,
              left,
              ext: left ? { left: x - 6 - tw, right: x - 6 } : { left: x + 6, right: x + 6 + tw },
            };
          });
          const levels = staggerLevels(evBoxes.map((b) => b.ext));
          const top = 14 + (levels.length ? (Math.max(...levels) + 1) * 18 : 0);
          const y = linearScale(domain, [height - BOTTOM, top]);
          const plot: Box = {
            x: leftMargin,
            y: top - 8,
            w: plotRight - leftMargin,
            h: height - BOTTOM - top + 8,
          };
          const taken: Box[] = evBoxes.map((b, k) => ({
            x: b.ext.left,
            y: 4 + levels[k]! * 18,
            w: b.tw,
            h: LABEL_H,
          }));
          const px = (si: number, i: number) => ({
            x: xs[i]!,
            y: y(aligned[si]![i]!.value as number),
          });
          // the plotted lines: a callout never sits across one
          const lineSegs: [Pt, Pt][] = [];
          series.forEach((_, si) => {
            const a = aligned[si]!;
            for (let i = 0; i + 1 < n; i++)
              if (isNum(a[i]) && isNum(a[i + 1])) lineSegs.push([px(si, i), px(si, i + 1)]);
          });
          // end labels
          const ends = series.map((_, si) => lastRecorded(si));
          const endYs = dodgeLabels(
            ends.map((ei, si) => (ei >= 0 ? px(si, ei).y : height / 2)),
            15,
            top,
            height - BOTTOM,
          );
          if (showEnd)
            ends.forEach((ei, si) => {
              if (ei < 0) return;
              taken.push({ x: plotRight + 6, y: endYs[si]! - 8, w: endRoom - 8, h: 16 });
            });
          // callouts on the primary series
          const prim = 0;
          const primPoints = aligned[prim]!.map((d, i) => ({ d, i })).filter(
            (o): o is { d: TrendDatum & { value: number }; i: number } =>
              isNum(o.d) && !o.d.partial,
          );
          const placed: {
            text: string;
            anchor: { x: number; y: number };
            box: Box;
            si: number;
          }[] = [];
          const placeOne = (si: number, i: number, text: string, prefer: "up" | "down") => {
            const anchor = px(si, i);
            const size = { w: textWidth(text, 12) + 4, h: LABEL_H };
            const spot = placeCallout(
              anchor,
              size,
              plot,
              [...taken, ...placed.map((p) => p.box)],
              prefer,
              16,
              lineSegs,
            );
            if (!spot) return;
            placed.push({ text, anchor, box: spot.box, si });
          };
          for (const c of callouts) {
            if (c === "peak" || c === "low") {
              if (primPoints.length < 3) continue;
              const pick = primPoints.reduce((best, o) =>
                (c === "peak" ? o.d.value > best.d.value : o.d.value < best.d.value) ? o : best,
              );
              // no callout when the extreme is the last or first point: the end label or the axis already says it
              if (pick.i === primPoints[primPoints.length - 1]!.i && showEnd) continue;
              placeOne(
                prim,
                pick.i,
                `${c === "peak" ? "Peak" : "Low"} ${formatter.full(pick.d.value)} (${axis.label(axis.keys[pick.i]!)})`,
                c === "peak" ? "up" : "down",
              );
            } else {
              const i = axis.keys.indexOf(c.key);
              const si = Math.max(
                0,
                series.findIndex((s) => s.id === c.seriesId),
              );
              if (i < 0 || !isNum(aligned[si]![i])) continue;
              placeOne(si, i, c.label, c.prefer ?? "up");
            }
          }
          const partialIdx = aligned[prim]!.findIndex((d) => isNum(d) && d.partial);
          if (partialLabel && partialIdx >= 0) placeOne(prim, partialIdx, partialLabel, "down");
          const floor = y(Math.max(domain[0], Math.min(0, domain[1])));
          const marks = (
            <>
              <ValueGrid
                ticks={ticks}
                y={y}
                x0={leftMargin}
                x1={plotRight}
                format={formatter.tick}
              />
              <PeriodTicks axis={axis} xs={xs} yText={height - 6} x0={leftMargin} x1={plotRight} />
              {series.map((s, si) => {
                const rec = aligned[si]!.map((d) => isNum(d));
                const par = aligned[si]!.map((d) => !!d?.partial);
                const spans = edgeSpans(rec, par);
                const lone = isolatedPeriods(rec);
                return (
                  <g key={s.id} data-series={s.id}>
                    {form === "area"
                      ? spans.map((sp, k) => {
                          const pts = Array.from({ length: sp.to - sp.from + 1 }, (_, j) =>
                            px(si, sp.from + j),
                          );
                          return (
                            <path
                              key={`a${k}`}
                              d={areaUnder(pts, floor, smooth)}
                              fill={color(si)}
                              fillOpacity={sp.partial ? 0.07 : 0.14}
                            />
                          );
                        })
                      : null}
                    {spans.map((sp, k) => {
                      const pts = Array.from({ length: sp.to - sp.from + 1 }, (_, j) =>
                        px(si, sp.from + j),
                      );
                      return (
                        <path
                          key={`l${k}`}
                          d={linePath(pts, smooth)}
                          fill="none"
                          stroke={color(si)}
                          strokeWidth={highlight && highlight !== s.id ? 1.25 : 1.75}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          {...(sp.partial ? { strokeDasharray: "4 4" } : {})}
                        />
                      );
                    })}
                    {lone.map((i) => (
                      <Dot key={`i${i}`} x={px(si, i).x} y={px(si, i).y} r={3} fill={color(si)} />
                    ))}
                  </g>
                );
              })}
              {/* event rules */}
              {evBoxes.map((b, k) => {
                const i = axis.keys.indexOf(b.e.key);
                const ly = 4 + levels[k]! * 18;
                const crossing = aligned.findIndex((a) => isNum(a[i]));
                return (
                  <g key={`${b.e.key}-${b.e.label}`} pointerEvents="none">
                    <line
                      x1={b.x}
                      x2={b.x}
                      y1={ly + LABEL_H / 2}
                      y2={height - BOTTOM}
                      stroke="var(--chart-ink)"
                      strokeOpacity={0.7}
                      strokeWidth={1}
                      {...(b.e.kind === "break" ? { strokeDasharray: "3 3" } : {})}
                    />
                    <circle cx={b.x} cy={ly + LABEL_H / 2} r={2.5} fill="var(--chart-ink)" />
                    <HaloText
                      x={b.left ? b.x - 6 : b.x + 6}
                      y={ly + LABEL_H / 2}
                      anchor={b.left ? "end" : "start"}
                      weight={500}
                      fill="var(--chart-ink)"
                    >
                      {b.e.label}
                    </HaloText>
                    {crossing >= 0 ? (
                      <Dot x={b.x} y={px(crossing, i).y} r={3.5} fill={color(crossing)} />
                    ) : null}
                  </g>
                );
              })}
              {/* callouts */}
              {placed.map((p, k) => {
                const cx = p.box.x + p.box.w / 2;
                const toTop = p.box.y + p.box.h < p.anchor.y;
                const from = {
                  x: Math.min(p.box.x + p.box.w, Math.max(p.box.x, p.anchor.x)),
                  y: toTop ? p.box.y + p.box.h : p.box.y,
                };
                const level = p.anchor.y >= p.box.y && p.anchor.y <= p.box.y + p.box.h;
                const start = level
                  ? { x: p.anchor.x > cx ? p.box.x + p.box.w : p.box.x, y: p.box.y + p.box.h / 2 }
                  : from;
                return (
                  <g key={`c${k}`} pointerEvents="none">
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={p.anchor.x}
                      y2={p.anchor.y}
                      stroke="var(--chart-ink)"
                      strokeOpacity={0.7}
                      strokeWidth={1}
                    />
                    <Dot x={p.anchor.x} y={p.anchor.y} r={4} fill={color(p.si)} />
                    <HaloText x={p.box.x} y={p.box.y + p.box.h / 2} weight={500}>
                      {p.text}
                    </HaloText>
                  </g>
                );
              })}
              {/* the last value at the end of each line */}
              {showEnd
                ? series.map((s, si) =>
                    ends[si]! >= 0 ? (
                      <g key={`e-${s.id}`} pointerEvents="none">
                        <Dot
                          x={px(si, ends[si]!).x}
                          y={px(si, ends[si]!).y}
                          r={3.5}
                          fill={color(si)}
                        />
                        <HaloText x={plotRight + 8} y={endYs[si]!} weight={600}>
                          {endText(si)}
                        </HaloText>
                      </g>
                    ) : null,
                  )
                : null}
              {active !== null && xs[active] !== undefined ? (
                <g pointerEvents="none">
                  <line
                    x1={xs[active]}
                    x2={xs[active]}
                    y1={top}
                    y2={height - BOTTOM}
                    stroke="var(--border-strong)"
                    strokeWidth={1}
                  />
                  {series.map((s, si) =>
                    isNum(aligned[si]![active]) ? (
                      <Dot key={s.id} x={xs[active]!} y={px(si, active).y} r={4} fill={color(si)} />
                    ) : null,
                  )}
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
                  y: top,
                  content: {
                    title: axis.label(axis.keys[active]!),
                    subtitle: aligned.some((a) => a[active]?.partial)
                      ? "Partial period"
                      : undefined,
                    rows: series.map((s, si) => ({
                      key: s.id,
                      label: s.label,
                      value: isNum(aligned[si]![active])
                        ? `${formatter.full(aligned[si]![active]!.value)}${unit && series.length === 1 ? ` ${unit}` : ""}`
                        : "Not recorded",
                      color: series.length > 1 ? color(si) : undefined,
                    })),
                    footer:
                      knownEvents
                        .filter((e) => e.key === axis.keys[active])
                        .map((e) => e.label)
                        .join(" · ") || undefined,
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
