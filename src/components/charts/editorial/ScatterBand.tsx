/**
 * Scatter of two measures across entities with a smooth local-regression line and a 95% confidence ribbon, and the
 * entities that sit farthest from the line labelled. Meant for the Insights explorer: it shows the shape of the
 * association (a curve, not only a straight line) and how sure the fit is at each x. It describes the entities
 * plotted (a group-level association), never a cause; the band is the confidence interval of the smooth curve, not a
 * range for one more entity. With fewer than eight points the points stand alone.
 */
import { useMemo, useState } from "react";
import { ChartCanvas, localPoint, textWidth, type TipSpec } from "../canvas";
import type { ValueFormatter } from "../format";
import { linearScale, niceDomain } from "../scale";
import type { ScatterPoint } from "../ScatterCorrelation";
import {
  areaBetween,
  boundarySegments,
  forwardPath,
  logTicks,
  placeCallout,
  type Box,
} from "./geometry";
import { Dot, HaloText } from "./parts";
import { MIN_SMOOTH_POINTS, loess, outlierIndices } from "./smooth";
import { axisText } from "../canvas";

export type ScatterBandProps = {
  points: readonly ScatterPoint[];
  xFormatter: ValueFormatter;
  yFormatter: ValueFormatter;
  xLabel: string;
  yLabel: string;
  ariaLabel: string;
  /** Share of the points each local fit uses (0.2–1; default 0.75). A smaller span follows the data more closely. */
  span?: number | undefined;
  degree?: 1 | 2 | undefined;
  /** Draw the confidence ribbon (default true). */
  showBand?: boolean | undefined;
  /** Log scales (fit and ribbon are computed on the log values; points with a value of zero or less are left out). */
  logX?: boolean | undefined;
  logY?: boolean | undefined;
  /** The ribbon is cut at these values (a measure that cannot be negative: bandFloor 0). */
  bandFloor?: number | undefined;
  bandCeiling?: number | undefined;
  /** Most outliers to label automatically (default 3; those at or beyond 2 standard deviations of the fit). */
  outliers?: number | undefined;
  /** Entities that are always labelled. */
  labelIds?: readonly string[] | undefined;
  selected?: string | null | undefined;
  onSelect?: ((id: string) => void) | undefined;
  height?: number | undefined;
  width?: number | undefined;
  className?: string | undefined;
};

const TOP = 22;
const BOTTOM = 40;

export function ScatterBand({
  points,
  xFormatter,
  yFormatter,
  xLabel,
  yLabel,
  ariaLabel,
  span = 0.75,
  degree = 1,
  showBand = true,
  logX = false,
  logY = false,
  bandFloor,
  bandCeiling,
  outliers = 3,
  labelIds = [],
  selected = null,
  onSelect,
  height = 340,
  width,
  className,
}: ScatterBandProps) {
  const [active, setActive] = useState<number | null>(null);
  const tx = (v: number) => (logX ? Math.log10(v) : v);
  const ty = (v: number) => (logY ? Math.log10(v) : v);
  const all = useMemo(
    () => points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    [points],
  );
  const sorted = useMemo(
    () =>
      all
        .filter((p) => (!logX || p.x > 0) && (!logY || p.y > 0))
        .sort((a, b) => a.x - b.x || a.y - b.y),
    [all, logX, logY],
  );
  const dropped = all.length - sorted.length;
  const fit = useMemo(
    () =>
      loess(
        sorted.map((p) => (logX ? Math.log10(p.x) : p.x)),
        sorted.map((p) => (logY ? Math.log10(p.y) : p.y)),
        { span, degree },
      ),
    [sorted, span, degree, logX, logY],
  );
  // the ribbon in plotted space, cut at the floor and ceiling the measure allows
  const band = useMemo(() => {
    if (!fit) return null;
    const lo = bandFloor !== undefined && (!logY || bandFloor > 0) ? ty(bandFloor) : -Infinity;
    const hi = bandCeiling !== undefined && (!logY || bandCeiling > 0) ? ty(bandCeiling) : Infinity;
    return fit.grid.map((g) => ({
      x: g.x,
      fit: g.fit,
      lo: Math.max(lo, g.lo),
      hi: Math.min(hi, g.hi),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, bandFloor, bandCeiling, logY]);
  const labelled = useMemo(() => {
    const ids = new Set<string>(labelIds);
    if (fit)
      for (const i of outlierIndices(
        sorted.map((p) => (logY ? Math.log10(p.y) : p.y)),
        fit.fitted,
        fit.sigma,
        { max: outliers },
      ))
        ids.add(sorted[i]!.id);
    if (selected) ids.add(selected);
    return ids;
  }, [fit, sorted, labelIds, outliers, selected, logY]);
  const axisFor = (vals: number[], log: boolean) => {
    const plotted = vals.map((v) => (log ? Math.log10(v) : v));
    return log
      ? logTicks(Math.min(...plotted), Math.max(...plotted))
      : niceDomain(plotted, { zero: false, count: 5 });
  };
  const xd = axisFor(
    sorted.map((p) => p.x),
    logX,
  );
  const yd = (() => {
    const base = axisFor(
      sorted.map((p) => p.y),
      logY,
    );
    if (!band || !showBand) return base;
    const edges = band.flatMap((g) => [g.lo, g.hi]).filter(Number.isFinite);
    const lo = Math.min(...edges, base.domain[0]);
    const hi = Math.max(...edges, base.domain[1]);
    return logY
      ? logTicks(lo, hi)
      : niceDomain([lo, hi, ...sorted.map((p) => p.y)], { zero: false, count: 5 });
  })();
  const fmtX = (t: number) => xFormatter.tick(logX ? Number((10 ** t).toPrecision(12)) : t);
  const fmtY = (t: number) => yFormatter.tick(logY ? Number((10 ** t).toPrecision(12)) : t);
  const leftMargin = Math.max(36, ...yd.ticks.map((t) => textWidth(fmtY(t)) + 10));
  const describe = (i: number) => {
    const p = sorted[i]!;
    return `${p.label}: ${xLabel} ${xFormatter.full(p.x)}, ${yLabel} ${yFormatter.full(p.y)}.`;
  };
  return (
    <div className={className}>
      <ChartCanvas
        width={width}
        height={height}
        ariaLabel={ariaLabel}
        count={sorted.length}
        active={active}
        onActive={setActive}
        describe={describe}
      >
        {(w) => {
          const right = w - 14;
          const x = linearScale(xd.domain, [leftMargin, right]);
          const y = linearScale(yd.domain, [height - BOTTOM, TOP]);
          const area: Box = {
            x: leftMargin,
            y: TOP,
            w: right - leftMargin,
            h: height - BOTTOM - TOP,
          };
          const nearest = (px: number, py: number) => {
            let best: number | null = null;
            let bestD = 24;
            sorted.forEach((p, i) => {
              const d = Math.hypot(x(tx(p.x)) - px, y(ty(p.y)) - py);
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            });
            return best;
          };
          const taken: Box[] = [];
          const labels = sorted
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => labelled.has(p.id))
            .map(({ p, i }) => {
              const size = { w: textWidth(p.label, 12) + 4, h: 16 };
              const spot = placeCallout(
                { x: x(tx(p.x)), y: y(ty(p.y)) },
                size,
                area,
                taken,
                "up",
                8,
              );
              if (spot) taken.push(spot.box);
              return { p, i, box: spot?.box ?? null };
            });
          const ribbon = band
            ? (() => {
                const hi = boundarySegments(
                  band.map((g) => ({ x: x(g.x), y: y(g.hi) })),
                  true,
                );
                const lo = boundarySegments(
                  band.map((g) => ({ x: x(g.x), y: y(g.lo) })),
                  true,
                );
                return {
                  ribbon: areaBetween(hi, lo),
                  line: forwardPath(
                    boundarySegments(
                      band.map((g) => ({ x: x(g.x), y: y(g.fit) })),
                      true,
                    ),
                  ),
                };
              })()
            : null;
          const marks = (
            <>
              <g aria-hidden>
                {yd.ticks.map((t) => (
                  <g key={`y${t}`}>
                    <line
                      x1={leftMargin}
                      x2={right}
                      y1={y(t)}
                      y2={y(t)}
                      stroke="var(--chart-grid)"
                      strokeOpacity={0.6}
                      shapeRendering="crispEdges"
                    />
                    <text x={leftMargin - 6} y={y(t)} dy="0.32em" textAnchor="end" {...axisText}>
                      {fmtY(t)}
                    </text>
                  </g>
                ))}
                {xd.ticks.map((t) => (
                  <g key={`x${t}`}>
                    <line
                      x1={x(t)}
                      x2={x(t)}
                      y1={TOP}
                      y2={height - BOTTOM}
                      stroke="var(--chart-grid)"
                      strokeOpacity={0.35}
                      shapeRendering="crispEdges"
                    />
                    <text x={x(t)} y={height - BOTTOM + 15} textAnchor="middle" {...axisText}>
                      {fmtX(t)}
                    </text>
                  </g>
                ))}
                <text x={leftMargin} y={12} fontSize={12} fill="var(--chart-axis)">
                  {yLabel}
                </text>
                <text
                  x={right}
                  y={height - 4}
                  textAnchor="end"
                  fontSize={12}
                  fill="var(--chart-axis)"
                >
                  {xLabel}
                </text>
              </g>
              {ribbon && showBand ? (
                <path d={ribbon.ribbon} fill="var(--chart-1)" fillOpacity={0.16} />
              ) : null}
              {sorted.map((p, i) => {
                const hot = active === i || p.id === selected;
                return (
                  <circle
                    key={p.id}
                    cx={x(tx(p.x))}
                    cy={y(ty(p.y))}
                    r={hot ? 5 : 3.5}
                    fill={hot ? "var(--chart-1)" : "var(--chart-ink)"}
                    fillOpacity={hot ? 1 : 0.62}
                    stroke="var(--chart-surface)"
                    strokeWidth={1}
                    onClick={onSelect ? () => onSelect(p.id) : undefined}
                    style={onSelect ? { cursor: "pointer" } : undefined}
                  />
                );
              })}
              {ribbon ? (
                <path
                  d={ribbon.line}
                  fill="none"
                  stroke="var(--chart-1)"
                  strokeWidth={2.25}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              ) : null}
              {labels.map((l) =>
                l.box ? (
                  <HaloText
                    key={l.p.id}
                    x={l.box.x}
                    y={l.box.y + l.box.h / 2}
                    weight={l.p.id === selected ? 700 : 500}
                  >
                    {l.p.label}
                  </HaloText>
                ) : null,
              )}
              {active !== null && sorted[active] ? (
                <Dot
                  x={x(sorted[active]!.x)}
                  y={y(sorted[active]!.y)}
                  r={5.5}
                  fill="var(--chart-1)"
                />
              ) : null}
              <rect
                x={leftMargin}
                y={TOP}
                width={Math.max(0, right - leftMargin)}
                height={Math.max(0, height - BOTTOM - TOP)}
                fill="transparent"
                onPointerMove={(e) => {
                  const p = localPoint(e);
                  setActive(nearest(p.x, p.y));
                }}
                onPointerLeave={() => setActive(null)}
              />
            </>
          );
          const a = active !== null ? sorted[active] : undefined;
          const tip: TipSpec | null = a
            ? {
                x: x(tx(a.x)),
                y: y(ty(a.y)),
                content: {
                  title: a.label,
                  rows: [
                    { key: "x", label: xLabel, value: xFormatter.full(a.x) },
                    { key: "y", label: yLabel, value: yFormatter.full(a.y) },
                  ],
                  footer:
                    fit && active !== null
                      ? `Smooth line at this x: ${yFormatter.full(logY ? 10 ** fit.fitted[active]! : fit.fitted[active]!)}`
                      : undefined,
                },
              }
            : null;
          return { marks, tooltip: tip };
        }}
      </ChartCanvas>
      <p className="pt-1 text-meta text-muted-foreground">
        {fit
          ? `n = ${sorted.length}. Line: local regression over ${Math.round(span * 100)}% of the points at each x. Band: its 95% confidence interval.${logX || logY ? ` Log scale on ${logX && logY ? "both axes" : logX ? "the x axis" : "the y axis"}.` : ""}${dropped ? ` ${dropped} point${dropped === 1 ? "" : "s"} at zero or below cannot sit on a log axis and ${dropped === 1 ? "is" : "are"} left out.` : ""}`
          : `n = ${sorted.length}. Too few points for a smooth line (at least ${MIN_SMOOTH_POINTS}, with three distinct x values).`}
      </p>
    </div>
  );
}
