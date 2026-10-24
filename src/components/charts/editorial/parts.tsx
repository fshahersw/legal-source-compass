/**
 * Shared pieces of the editorial chart forms: slot paints (fill and label ink), the recessive value grid, the period
 * axis, and a hover tooltip for the HTML forms (the SVG forms use ChartCanvas). Everything reads the chart tokens set
 * by `chartTokens` (palette.ts), so light and dark follow the theme.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChartTooltip, axisText, textWidth, type TooltipContent } from "../canvas";
import { MAX_SERIES, seriesOn, seriesVar } from "../palette";
import { labelStride } from "../scale";
import type { PeriodAxis } from "../series";

/** Fill and the ink for text set on it: a categorical slot, or the neutral "Other". */
export type Paint = { fill: string; ink: string; slot: number | "other" };

export function paintFor(
  index: number,
  options: { other?: boolean; slot?: number | undefined } = {},
): Paint {
  if (options.other) return { fill: "var(--chart-other)", ink: "var(--chart-ink)", slot: "other" };
  const slot = options.slot ?? index;
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SERIES)
    return { fill: "var(--chart-other)", ink: "var(--chart-ink)", slot: "other" };
  return { fill: seriesVar(slot), ink: seriesOn(slot), slot };
}

/** Horizontal hairlines at the value ticks with the tick text at the left; zero a little stronger. */
export function ValueGrid({
  ticks,
  y,
  x0,
  x1,
  format,
}: {
  ticks: readonly number[];
  y: (v: number) => number;
  x0: number;
  x1: number;
  format: (v: number) => string;
}) {
  return (
    <g aria-hidden>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={x0}
            x2={x1}
            y1={y(t)}
            y2={y(t)}
            stroke={t === 0 ? "var(--border-strong)" : "var(--chart-grid)"}
            strokeOpacity={t === 0 ? 1 : 0.6}
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
          <text x={x0 - 6} y={y(t)} dy="0.32em" textAnchor="end" {...axisText}>
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** The period labels under a plot: every label that fits at a regular step, or the axis's own `showTick`. */
export function PeriodTicks({
  axis,
  xs,
  yText,
  x0,
  x1,
}: {
  axis: PeriodAxis;
  xs: readonly number[];
  yText: number;
  x0: number;
  x1: number;
}) {
  const stride = labelStride(
    axis.keys.length,
    x1 - x0,
    Math.max(...axis.keys.map((k) => textWidth(axis.tick(k)) + 12), 24),
  );
  return (
    <g aria-hidden>
      {axis.keys.map((k, i) =>
        (axis.showTick ? axis.showTick(k, i) : i % stride === 0) ? (
          <text
            key={k}
            x={xs[i]}
            y={yText}
            textAnchor={i === 0 ? "start" : i === axis.keys.length - 1 ? "end" : "middle"}
            {...axisText}
          >
            {axis.tick(k)}
          </text>
        ) : null,
      )}
    </g>
  );
}

/** x positions of `n` periods spread edge to edge across [x0, x1] (areas run to both edges of the plot). */
export function edgeToEdge(n: number, x0: number, x1: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [(x0 + x1) / 2];
  return Array.from({ length: n }, (_, i) => x0 + ((x1 - x0) * i) / (n - 1));
}

/** Index of the position in `xs` nearest to `px`. */
export function nearestIndex(xs: readonly number[], px: number): number | null {
  if (!xs.length) return null;
  let best = 0;
  for (let i = 1; i < xs.length; i++)
    if (Math.abs(xs[i]! - px) < Math.abs(xs[best]! - px)) best = i;
  return best;
}

/** The one-line note under a plot drawn with smoothing: the curve is a display choice, the values are as recorded. */
export function SmoothNote() {
  return (
    <p className="m-0 pt-1 text-meta text-muted-foreground">
      Curves smoothed for display; values are as recorded.
    </p>
  );
}

/** A dot with a 2 px surface ring (an end or peak marker). */
export function Dot({ x, y, r = 4, fill }: { x: number; y: number; r?: number; fill: string }) {
  return <circle cx={x} cy={y} r={r} fill={fill} stroke="var(--chart-surface)" strokeWidth={2} />;
}

/** A label on a surface halo, so a line or an edge behind it never cuts the text. */
export function HaloText({
  x,
  y,
  children,
  anchor = "start",
  weight = 600,
  size = 12,
  fill = "var(--chart-ink)",
}: {
  x: number;
  y: number;
  children: ReactNode;
  anchor?: "start" | "middle" | "end";
  weight?: number;
  size?: number;
  fill?: string;
}) {
  return (
    <text
      x={x}
      y={y}
      dy="0.32em"
      textAnchor={anchor}
      fontSize={size}
      fontWeight={weight}
      fill={fill}
      stroke="var(--chart-surface)"
      strokeWidth={3}
      paintOrder="stroke"
      className="tabular-nums"
    >
      {children}
    </text>
  );
}

/**
 * Hover tooltip for the HTML forms: the wrapper is `relative`, `bind(content)` returns the pointer handlers of a mark,
 * and the tooltip follows the pointer inside the wrapper. Keyboard users read the same details from the row's
 * aria-label and the card's View data.
 */
export function useHoverTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: TooltipContent } | null>(null);
  const bind = (content: TooltipContent) => ({
    onPointerMove: (e: ReactPointerEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content });
    },
    onPointerLeave: () => setTip(null),
  });
  const node = tip ? (
    <ChartTooltip
      content={tip.content}
      x={tip.x}
      y={tip.y}
      containerWidth={ref.current?.getBoundingClientRect().width ?? 600}
    />
  ) : null;
  return { ref, bind, node };
}
