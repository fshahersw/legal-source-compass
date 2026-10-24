/**
 * Recharts theme layer: one look for every recharts chart on the platform, matching the SVG chart kit.
 *
 * Recharts finds its axes, grids and tooltips by component type, so they cannot be wrapped in our own components.
 * The theme therefore ships prop factories (`xCategoryAxis`, `yValueAxis`, `gridProps`, `tooltipProps`, `lineProps`,
 * `barProps`, `referenceLineProps`, `valueLabelProps`) to spread onto the recharts elements, plus content components
 * recharts renders for us (content.tsx: `ThemedTooltip`, `ThemedLegend`, `EndLabels` via `<Customized>`) and
 * `SeriesLegend` for a legend drawn above the plot in HTML. charts.tsx builds the common forms from them.
 *
 *   <BarChart data={rows} margin={CHART_MARGIN}>
 *     <CartesianGrid {...gridProps} />
 *     <XAxis dataKey="year" {...xCategoryAxis()} />
 *     <YAxis {...yValueAxis(niceAxisFor(rows, ["filed"]), tickText)} />
 *     <Tooltip {...tooltipProps({ valueFormat: fmt, cursor: "bar" })} />
 *     <Bar dataKey="filed" name="Filed" {...barProps()} />
 *   </BarChart>
 *
 * Standard (WORKER_RULES_UI, dataviz): hairline solid grid, muted 12 px ticks, nice ticks with compact units, a
 * crosshair on lines and per-mark hover on bars, tooltips where the value leads, legends above the plot and direct
 * labels for up to four series, labelled reference lines, thin marks (2 px lines, bars at most 24 px with a 4 px
 * rounded data end), categorical colours in fixed order from palette.ts.
 */
import { createElement, type CSSProperties } from "react";
import { CATEGORICAL_HEX, MAX_SERIES } from "../palette";
import { TICK_FONT, axisWidth, labelWidth, type NiceAxis } from "./axis";
import type { ReferenceSpec } from "./charts";
import { ThemedLegend, ThemedTooltip, type ThemedTooltipProps } from "./content";

/** Categorical colour of slot `index` (0-based), fixed order, never cycled. Works inside and outside a chart root. */
export function seriesColor(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_SERIES)
    throw new RangeError(`Series slot ${index} is outside the ${MAX_SERIES}-slot palette.`);
  return `var(--chart-${index + 1}, ${CATEGORICAL_HEX[index]})`;
}

/** The single-series accent (slot 1). */
export const ACCENT = seriesColor(0);
/** De-emphasised marks: context bars and lines beside the one that matters. */
export const MUTED_MARK = "color-mix(in srgb, var(--muted-foreground) 40%, var(--surface))";
/** A comparison series drawn as context (national total, median district). */
export const CONTEXT_MARK = "var(--muted-foreground)";
/** "Other" (a folded tail): neutral grey, never a categorical slot. */
export const OTHER_MARK = "color-mix(in srgb, var(--muted-foreground) 55%, var(--surface))";

export const TICK = { fontSize: TICK_FONT, fill: "var(--muted-foreground)" } as const;
export const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 } as const;

/** Hairline horizontal grid for columns and lines. */
export const gridProps = {
  stroke: "var(--border)",
  strokeOpacity: 0.8,
  vertical: false,
} as const;

/** Hairline vertical grid for horizontal bars. */
export const gridPropsVertical = {
  stroke: "var(--border)",
  strokeOpacity: 0.8,
  horizontal: false,
} as const;

/** Category (period) axis under columns and lines. */
export function xCategoryAxis(overrides: Record<string, unknown> = {}) {
  return {
    tick: TICK,
    tickLine: false,
    axisLine: { stroke: "var(--border-strong)" },
    tickMargin: 6,
    minTickGap: 14,
    interval: "preserveEnd" as const,
    ...overrides,
  };
}

/** Value axis on the left with nice ticks; width fits the widest tick label. */
export function yValueAxis(
  axis: NiceAxis,
  format: (v: number) => string,
  overrides: Record<string, unknown> = {},
) {
  return {
    type: "number" as const,
    domain: axis.domain,
    ticks: axis.ticks,
    interval: 0 as const,
    tickFormatter: format,
    tick: TICK,
    tickLine: false,
    axisLine: false,
    allowDecimals: true,
    width: axisWidth(axis.ticks, format),
    ...overrides,
  };
}

/** Value axis along the bottom of horizontal bars. */
export function xValueAxis(
  axis: NiceAxis,
  format: (v: number) => string,
  overrides: Record<string, unknown> = {},
) {
  return {
    type: "number" as const,
    domain: axis.domain,
    ticks: axis.ticks,
    interval: 0 as const,
    tickFormatter: format,
    tick: TICK,
    tickLine: false,
    axisLine: false,
    height: 22,
    ...overrides,
  };
}

/** Category axis on the left of horizontal bars (names). */
export function yCategoryAxis(width: number, overrides: Record<string, unknown> = {}) {
  return {
    type: "category" as const,
    tick: { ...TICK, fill: "var(--foreground)" },
    tickLine: false,
    axisLine: false,
    width,
    interval: 0 as const,
    ...overrides,
  };
}

/** A 2 px line, no dots unless the series is short, a ringed active dot. Gaps stay gaps. */
export function lineProps(
  color: string,
  options: {
    dashed?: boolean | undefined;
    dots?: boolean | undefined;
    muted?: boolean | undefined;
  } = {},
) {
  return {
    type: "linear" as const,
    stroke: color,
    strokeWidth: options.muted ? 1.5 : 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...(options.dashed ? { strokeDasharray: "4 3" } : {}),
    dot: options.dots ? { r: 2.5, fill: color, stroke: "var(--surface)", strokeWidth: 1 } : false,
    activeDot: { r: 4, fill: color, stroke: "var(--surface)", strokeWidth: 2 },
    isAnimationActive: false,
    connectNulls: false,
  };
}

/**
 * Bar marks: at most 24 px thick, 4 px rounded data end, square at the baseline. In a stack only the top segment is
 * rounded and a 1 px surface stroke on each segment leaves the 2 px gap between neighbours.
 */
export function barProps(
  options: {
    color?: string | undefined;
    horizontal?: boolean | undefined;
    stacked?: boolean | undefined;
    top?: boolean | undefined;
    maxBarSize?: number | undefined;
  } = {},
) {
  const round = !options.stacked || options.top;
  const radius = round
    ? options.horizontal
      ? ([0, 4, 4, 0] as [number, number, number, number])
      : ([4, 4, 0, 0] as [number, number, number, number])
    : 0;
  return {
    fill: options.color ?? ACCENT,
    radius,
    maxBarSize: options.maxBarSize ?? 24,
    isAnimationActive: false,
    ...(options.stacked ? { stroke: "var(--surface)", strokeWidth: 1 } : {}),
  };
}

/** Value labels at the bar end (LabelList props). */
export function valueLabelProps(
  format: (v: number) => string,
  position: "right" | "top" | "insideRight" = "right",
) {
  return {
    position,
    offset: 6,
    fontSize: TICK_FONT,
    fill: "var(--foreground)",
    className: "tabular-nums",
    formatter: (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? format(v) : ""),
  };
}

type RefViewBox = { x?: number; y?: number; width?: number; height?: number };

/**
 * Inline label of a reference line, on a surface halo so lines and marks never cut through it. Horizontal lines
 * (y = value) are labelled just above the line at the left edge of the plot; vertical lines (x = value) above the plot,
 * anchored so the text stays inside it.
 */
function refLabel(text: string, orientation: "horizontal" | "vertical") {
  function RefLabel(props: { viewBox?: unknown }) {
    const vb = (props.viewBox ?? {}) as RefViewBox;
    const x0 = vb.x ?? 0;
    const y0 = vb.y ?? 0;
    const common = {
      fontSize: 11,
      fill: "var(--foreground)",
      stroke: "var(--surface)",
      strokeWidth: 3,
      paintOrder: "stroke" as const,
      className: "tabular-nums",
    };
    if (orientation === "horizontal")
      return createElement("text", { ...common, x: x0 + 4, y: y0 - 4 }, text);
    return createElement("text", { ...common, x: x0, y: y0 - 6, textAnchor: "middle" }, text);
  }
  return RefLabel;
}

/**
 * A labelled reference line (median, national value, the year a rule changed): ink at reduced opacity with a short
 * dash so it never reads as a gridline; the label sits inline on a surface halo. Pass `orientation: "vertical"` for an
 * `x =` line (rankings, a marked period).
 */
export function referenceLineProps(
  label: string,
  options: { orientation?: "horizontal" | "vertical" | undefined } = {},
) {
  return {
    stroke: "var(--foreground)",
    strokeOpacity: 0.55,
    strokeWidth: 1,
    strokeDasharray: "4 3",
    ifOverflow: "extendDomain" as const,
    label: { content: refLabel(label, options.orientation ?? "horizontal") },
  };
}

/**
 * Tooltip props: our content, a hairline crosshair on lines and a soft band on bars, no animation. Pass the same
 * formatting options ThemedTooltip takes.
 */
export function tooltipProps(
  options: Omit<ThemedTooltipProps, "active" | "payload" | "label"> & {
    cursor?: "line" | "bar" | "none" | undefined;
  } = {},
) {
  const { cursor = "line", ...content } = options;
  return {
    content: createElement(ThemedTooltip, content),
    cursor:
      cursor === "none"
        ? (false as const)
        : cursor === "bar"
          ? { fill: "var(--muted)", fillOpacity: 0.7 }
          : { stroke: "var(--border-strong)", strokeWidth: 1 },
    isAnimationActive: false,
    wrapperStyle: { outline: "none", zIndex: 20 } as CSSProperties,
  };
}

/** Props for a recharts `<Legend>` placed above the plot, left-aligned. */
export function legendProps(mark: "line" | "swatch" = "line") {
  return {
    verticalAlign: "top" as const,
    align: "left" as const,
    content: createElement(ThemedLegend, { mark }),
  };
}

/** Right margin that leaves room for EndLabels text ("Filed 37,443"). */
export function endLabelMargin(labels: readonly string[], fontSize = TICK_FONT): number {
  return Math.ceil(Math.min(170, Math.max(24, ...labels.map((l) => labelWidth(l, fontSize))) + 14));
}

/** A labelled benchmark reference ("Median district 7.9") for RankBars, TrendLines and TrendColumns; none when the
 * benchmark is not recorded. */
export function benchmark(
  label: string,
  value: number | null | undefined,
  format: (v: number) => string,
): ReferenceSpec[] {
  return typeof value === "number" && Number.isFinite(value)
    ? [{ value, label: `${label} ${format(value)}` }]
    : [];
}
