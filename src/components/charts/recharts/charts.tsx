/**
 * Themed recharts building blocks for the two forms most charts need: lines over periods (`TrendLines`) and columns
 * over periods, single, grouped or stacked (`TrendColumns`). They apply the theme layer (theme.tsx) so a caller passes
 * rows, keys and formatters and gets the standard: nice ticks with compact units, hairline grid, legend above for two
 * or more series, direct end labels for up to four lines, the latest value on the last column, labelled reference
 * lines, a crosshair (lines) or per-column hover (bars), keyboard access (arrow keys move the tooltip), partial
 * periods dashed or hatched, gaps kept as gaps.
 */
import { useId, useMemo, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Customized,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { niceAxis, plottedValues, tickText } from "./axis";
import { EndLabels, SeriesLegend, type LegendItem } from "./content";
import {
  CHART_MARGIN,
  barProps,
  endLabelMargin,
  gridProps,
  lineProps,
  referenceLineProps,
  seriesColor,
  tooltipProps,
  xCategoryAxis,
  yValueAxis,
} from "./theme";

export type ChartSeriesSpec = {
  /** Row key holding this series' values. */
  key: string;
  /** Name in the legend and tooltip. */
  label: string;
  /** Short name for direct end labels (defaults to the label, cut to 18 characters). */
  short?: string | undefined;
  /** Mark colour; defaults to the categorical slot of the series' position. */
  color?: string | undefined;
  /** Context series (national, median): thinner and dashed. */
  context?: boolean | undefined;
};

export type ReferenceSpec = { value: number; label: string };
export type MarkerSpec = { x: string | number; label: string };

type Row = Record<string, unknown>;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const short = (s: ChartSeriesSpec) =>
  s.short ?? (s.label.length > 18 ? `${s.label.slice(0, 17)}…` : s.label);

function colorOf(s: ChartSeriesSpec, i: number) {
  return s.color ?? seriesColor(Math.min(i, 5));
}

function lastIndexWithValue(rows: readonly Row[], key: string, partialKey?: string): number {
  for (let i = rows.length - 1; i >= 0; i--)
    if (isNum(rows[i]![key]) && !(partialKey && rows[i]![partialKey])) return i;
  return -1;
}

export type TrendLinesProps = {
  rows: readonly Row[];
  /** Row key of the period label. */
  xKey: string;
  series: readonly ChartSeriesSpec[];
  /** Full value text (tooltip, end labels): "1,204", "12.0%", "$4.1M". */
  format: (v: number) => string;
  /** Axis tick text (default compact: 50K, 1.2M). */
  tick?: ((v: number) => string) | undefined;
  /** Period tick text ("’25"). */
  xTick?: ((v: string) => string) | undefined;
  /** Tooltip title from the period label and its row. */
  tooltipTitle?: ((label: string, row: Row | undefined) => string) | undefined;
  /** Extra tooltip line (n, partial note). */
  tooltipFooter?: ((row: Row | undefined) => ReactNode) | undefined;
  height?: number | undefined;
  /** Keep zero on the value axis (default true). */
  zero?: boolean | undefined;
  references?: readonly ReferenceSpec[] | undefined;
  markers?: readonly MarkerSpec[] | undefined;
  /** Row key of a boolean that marks a partial period: drawn dashed, left out of end labels. */
  partialKey?: string | undefined;
  /** Direct labels at line ends (default: four or fewer series). */
  endLabels?: boolean | undefined;
  /** Legend above the plot (default: two or more series). */
  legend?: boolean | undefined;
  /** Dots on every point (default: twelve or fewer periods). */
  dots?: boolean | undefined;
  /** Target number of value intervals (default 4). */
  tickCount?: number | undefined;
  ariaLabel: string;
  className?: string | undefined;
};

export function TrendLines({
  rows,
  xKey,
  series,
  format,
  tick = (v) => tickText(v),
  xTick,
  tooltipTitle,
  tooltipFooter,
  height = 220,
  zero = true,
  references = [],
  markers = [],
  partialKey,
  endLabels,
  legend,
  dots,
  tickCount,
  ariaLabel,
  className,
}: TrendLinesProps) {
  // Partial periods: the complete line stops at the last complete period; a dashed twin carries it on.
  const { data, partialKeys } = useMemo(() => {
    if (!partialKey) return { data: rows as Row[], partialKeys: new Set<string>() };
    const pk = new Set<string>();
    const out = rows.map((r) => ({ ...r }) as Row);
    for (const s of series) {
      const lastComplete = lastIndexWithValue(rows, s.key, partialKey);
      let any = false;
      rows.forEach((r, i) => {
        const partial = Boolean(r[partialKey]);
        if (partial) {
          out[i]![s.key] = null;
          if (isNum(r[s.key])) any = true;
        }
        out[i]![`${s.key}__p`] =
          (partial || i === lastComplete) && isNum(r[s.key]) ? r[s.key] : null;
      });
      if (any) pk.add(s.key);
    }
    return { data: out, partialKeys: pk };
  }, [rows, series, partialKey]);
  const values = plottedValues(
    rows,
    series.map((s) => s.key),
  );
  const axis = niceAxis(values, {
    zero,
    count: tickCount ?? 4,
    include: references.map((r) => r.value),
  });
  const showEnd = endLabels ?? series.length <= 4;
  const showLegend = legend ?? series.length >= 2;
  const withDots = dots ?? rows.length <= 12;
  const endTexts = series.map((s) => {
    const i = lastIndexWithValue(rows, s.key, partialKey);
    if (i < 0) return "";
    const v = format(rows[i]![s.key] as number);
    return series.length > 1 ? `${short(s)} ${v}` : v;
  });
  const legendItems: LegendItem[] = series.map((s, i) => ({
    id: s.key,
    label: s.label,
    color: colorOf(s, i),
    dashed: s.context,
  }));
  return (
    <div className={className}>
      {showLegend ? <SeriesLegend items={legendItems} className="pb-2" /> : null}
      <div style={{ height }} role="figure" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{
              ...CHART_MARGIN,
              top: markers.length || references.length ? 18 : CHART_MARGIN.top,
              right: showEnd ? endLabelMargin(endTexts) : CHART_MARGIN.right + 4,
            }}
            accessibilityLayer
          >
            <CartesianGrid {...gridProps} />
            <XAxis dataKey={xKey} {...xCategoryAxis(xTick ? { tickFormatter: xTick } : {})} />
            <YAxis {...yValueAxis(axis, tick)} />
            <Tooltip
              {...tooltipProps({
                valueFormat: (v) => format(v),
                labelFormat: (l, row) => (tooltipTitle ? tooltipTitle(String(l), row) : String(l)),
                hideKey: series.length === 1,
                omit: (k, row) => {
                  const partial = Boolean(partialKey && row?.[partialKey]);
                  if (k.endsWith("__p")) return !partial;
                  return partial && partialKeys.has(k);
                },
                footer: tooltipFooter,
              })}
            />
            {references.map((r) => (
              <ReferenceLine key={`ref-${r.label}`} y={r.value} {...referenceLineProps(r.label)} />
            ))}
            {markers.map((m) => (
              <ReferenceLine
                key={`mark-${m.label}-${m.x}`}
                x={m.x}
                {...referenceLineProps(m.label, { orientation: "vertical" })}
                strokeDasharray={undefined}
                strokeOpacity={0.35}
              />
            ))}
            {series.map((s, i) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                {...lineProps(colorOf(s, i), {
                  dots: withDots,
                  dashed: s.context,
                  muted: s.context,
                })}
              />
            ))}
            {series
              .filter((s) => partialKeys.has(s.key))
              .map((s) => (
                <Line
                  key={`${s.key}__p`}
                  dataKey={`${s.key}__p`}
                  name={`${s.label} (partial period)`}
                  legendType="none"
                  {...lineProps(colorOf(s, series.indexOf(s)), { dashed: true, dots: true })}
                  activeDot={false}
                />
              ))}
            {showEnd ? (
              <Customized
                component={
                  <EndLabels
                    format={format}
                    keys={series.map((s) => s.key)}
                    labelFor={(k) => short(series.find((s) => s.key === k)!)}
                  />
                }
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export type TrendColumnsProps = {
  rows: readonly Row[];
  xKey: string;
  series: readonly ChartSeriesSpec[];
  format: (v: number) => string;
  tick?: ((v: number) => string) | undefined;
  xTick?: ((v: string) => string) | undefined;
  tooltipTitle?: ((label: string, row: Row | undefined) => string) | undefined;
  tooltipFooter?: ((row: Row | undefined) => ReactNode) | undefined;
  /** Stack the series as parts of one whole (tooltip shows the total). */
  stacked?: boolean | undefined;
  height?: number | undefined;
  references?: readonly ReferenceSpec[] | undefined;
  /** Row key of a boolean that marks a partial period: drawn hatched. */
  partialKey?: string | undefined;
  /** Period to emphasise (one series): the others are muted. */
  highlightX?: string | number | undefined;
  /** Value on the cap of the latest complete column (default: one series). */
  lastValue?: boolean | undefined;
  legend?: boolean | undefined;
  tickCount?: number | undefined;
  ariaLabel: string;
  className?: string | undefined;
};

export function TrendColumns({
  rows,
  xKey,
  series,
  format,
  tick = (v) => tickText(v),
  xTick,
  tooltipTitle,
  tooltipFooter,
  stacked = false,
  height = 220,
  references = [],
  partialKey,
  highlightX,
  lastValue,
  legend,
  tickCount,
  ariaLabel,
  className,
}: TrendColumnsProps) {
  const hatch = useId().replace(/[^a-zA-Z0-9]/g, "");
  const keys = series.map((s) => s.key);
  const axis = niceAxis(plottedValues(rows, keys, stacked), {
    count: tickCount ?? 4,
    include: references.map((r) => r.value),
  });
  const showLegend = legend ?? series.length >= 2;
  const single = series.length === 1;
  const showLast = lastValue ?? (single && !stacked);
  const lastIdx = single ? lastIndexWithValue(rows, series[0]!.key, partialKey) : -1;
  const anyPartial = Boolean(partialKey && rows.some((r) => r[partialKey]));
  const legendItems: LegendItem[] = series.map((s, i) => ({
    id: s.key,
    label: s.label,
    color: colorOf(s, i),
  }));
  return (
    <div className={className}>
      {showLegend ? <SeriesLegend items={legendItems} mark="swatch" className="pb-2" /> : null}
      <div style={{ height }} role="figure" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows as Row[]}
            margin={{ ...CHART_MARGIN, top: showLast || references.length ? 18 : CHART_MARGIN.top }}
            barCategoryGap="22%"
            barGap={2}
            accessibilityLayer
          >
            {anyPartial ? (
              <defs>
                {series.map((s, i) => (
                  <pattern
                    key={s.key}
                    id={`${hatch}-${i}`}
                    width="5"
                    height="5"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <rect width="5" height="5" fill={colorOf(s, i)} fillOpacity={0.22} />
                    <line x1="0" y1="0" x2="0" y2="5" stroke={colorOf(s, i)} strokeWidth="2" />
                  </pattern>
                ))}
              </defs>
            ) : null}
            <CartesianGrid {...gridProps} />
            <XAxis dataKey={xKey} {...xCategoryAxis(xTick ? { tickFormatter: xTick } : {})} />
            <YAxis {...yValueAxis(axis, tick)} />
            <Tooltip
              {...tooltipProps({
                cursor: "bar",
                valueFormat: (v) => format(v),
                labelFormat: (l, row) => {
                  const t = tooltipTitle ? tooltipTitle(String(l), row) : String(l);
                  return partialKey && row?.[partialKey] ? `${t} (partial period)` : t;
                },
                hideKey: single,
                sortByValue: stacked && series.length > 3,
                total: stacked
                  ? (row) => {
                      const vals = keys.map((k) => row?.[k]).filter(isNum);
                      return vals.length === keys.length
                        ? format(vals.reduce((a, v) => a + v, 0))
                        : null;
                    }
                  : undefined,
                footer: tooltipFooter,
              })}
            />
            {references.map((r) => (
              <ReferenceLine key={`ref-${r.label}`} y={r.value} {...referenceLineProps(r.label)} />
            ))}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                {...(stacked ? { stackId: "stack" } : {})}
                {...barProps({
                  color: colorOf(s, i),
                  stacked,
                  top: stacked && i === series.length - 1,
                })}
              >
                {(rows as Row[]).map((r, ri) => {
                  const partial = Boolean(partialKey && r[partialKey]);
                  const muted =
                    single && highlightX !== undefined && r[xKey] !== highlightX && !partial;
                  return (
                    <Cell
                      key={ri}
                      fill={
                        partial
                          ? `url(#${hatch}-${i})`
                          : muted
                            ? "color-mix(in srgb, var(--muted-foreground) 35%, var(--surface))"
                            : colorOf(s, i)
                      }
                    />
                  );
                })}
                {showLast && i === 0 && lastIdx >= 0 ? (
                  <LabelList
                    dataKey={s.key}
                    content={(p: {
                      index?: number | undefined;
                      x?: number | string | undefined;
                      y?: number | string | undefined;
                      width?: number | string | undefined;
                      value?: unknown;
                    }) =>
                      p.index === lastIdx && isNum(p.value) ? (
                        <text
                          x={Number(p.x) + Number(p.width) / 2}
                          y={Number(p.y) - 5}
                          textAnchor="middle"
                          fontSize={12}
                          fontWeight={600}
                          fill="var(--foreground)"
                          stroke="var(--surface)"
                          strokeWidth={3}
                          paintOrder="stroke"
                          className="tabular-nums"
                        >
                          {tick(p.value)}
                        </text>
                      ) : null
                    }
                  />
                ) : null}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
