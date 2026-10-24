/**
 * Context primitives: the forms that turn a bare number into an answer.
 *
 * - `RankBars`: sorted horizontal bars with the value at each bar end, the focus item highlighted (the rest muted) and
 *   a labelled benchmark line (median, national). "Where does this one sit?"
 * - `SmallMultiplesGrid`: one compact line panel per entity on a shared value axis, an optional context series (the
 *   national or median line) in every panel, latest value and change on each panel. "How do these compare over time?"
 * - `TimelineStrip`: a compact column strip of a count over periods, the latest complete period in the accent, with
 *   first/last labels and the latest value. Replaces a bare count with its history.
 *
 * Benchmarks: pass `benchmark(label, value, format)` (theme.ts; a labelled reference) to RankBars, TrendLines or
 * TrendColumns.
 */
import { useMemo, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { niceAxis, plottedValues, tickText, categoryAxisWidth, fitText, labelWidth } from "./axis";
import type { ReferenceSpec } from "./charts";
import {
  ACCENT,
  CONTEXT_MARK,
  MUTED_MARK,
  TICK,
  barProps,
  gridProps,
  lineProps,
  referenceLineProps,
  tooltipProps,
} from "./theme";
import { lastChange, peakOf, rankRows, type RankRowInput, type TakeawayPoint } from "../takeaway";
import { NOT_RECORDED } from "../format";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type RankBarsProps = {
  items: readonly RankRowInput[];
  /** Full value text at the bar end and in the tooltip. */
  format: (v: number) => string;
  /** Item to highlight; the other bars are muted. */
  focusId?: string | null | undefined;
  /** Benchmark lines (median, national), labelled inline at the top. */
  references?: readonly ReferenceSpec[] | undefined;
  /** Lowest first ("fastest"). */
  ascending?: boolean | undefined;
  /** Show the top N (the focus row is always kept). */
  limit?: number | undefined;
  /** Row height in px (bar at most 24 px). */
  rowHeight?: number | undefined;
  /** Width cap of the name column. */
  labelWidth?: number | undefined;
  /** Show the rank number before each name. */
  showRank?: boolean | undefined;
  /** Extra tooltip line for an item. */
  note?: ((id: string) => ReactNode) | undefined;
  onSelect?: ((id: string) => void) | undefined;
  ariaLabel: string;
  className?: string | undefined;
};

export function RankBars({
  items,
  format,
  focusId = null,
  references = [],
  ascending = false,
  limit,
  rowHeight = 26,
  labelWidth: maxLabel = 200,
  showRank = false,
  note,
  onSelect,
  ariaLabel,
  className,
}: RankBarsProps) {
  const { rows, total, missing } = useMemo(
    () => rankRows(items, { ascending, limit, focusId }),
    [items, ascending, limit, focusId],
  );
  if (!rows.length)
    return (
      <p className={cn("text-xs text-muted-foreground", className)} role="status">
        {NOT_RECORDED}: no item carries a value.
      </p>
    );
  const axis = niceAxis(
    rows.map((r) => r.value),
    { include: references.map((r) => r.value) },
  );
  const name = (r: { label: string; rank: number }) =>
    showRank ? `${r.rank}. ${r.label}` : r.label;
  const nameW = categoryAxisWidth(rows.map(name), { max: maxLabel });
  const valueW = Math.ceil(Math.max(...rows.map((r) => labelWidth(format(r.value)))) + 12);
  const top = references.length ? 20 : 4;
  const height = top + rows.length * rowHeight + 6;
  const hasNegative = rows.some((r) => r.value < 0);
  const data = rows.map((r) => ({ ...r, name: name(r) }));
  return (
    <div className={className}>
      <div style={{ height }} role="figure" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top, right: valueW, bottom: 0, left: 0 }}
            barCategoryGap={Math.max(2, rowHeight - 18)}
            accessibilityLayer
          >
            <XAxis type="number" domain={axis.domain} ticks={axis.ticks} hide />
            <YAxis
              type="category"
              dataKey="name"
              width={nameW}
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={(p: {
                x?: number;
                y?: number;
                payload?: { value?: string; index?: number };
              }) => {
                const row = data[p.payload?.index ?? -1];
                return (
                  <text
                    x={(p.x ?? 0) - 6}
                    y={p.y ?? 0}
                    dy="0.32em"
                    textAnchor="end"
                    fontSize={TICK.fontSize}
                    fontWeight={row?.focus ? 600 : 400}
                    fill="var(--foreground)"
                  >
                    {fitText(String(p.payload?.value ?? ""), nameW - 8)}
                  </text>
                );
              }}
            />
            <Tooltip
              {...tooltipProps({
                cursor: "bar",
                hideKey: true,
                valueFormat: (v) => format(v),
                labelFormat: (_l, row) => String(row?.["label"] ?? ""),
                footer: (row) => {
                  const r = row as (typeof data)[number] | undefined;
                  if (!r) return null;
                  return (
                    <>
                      <p>{`Rank ${r.rank} of ${total}`}</p>
                      {references.map((ref) => (
                        <p key={ref.label}>
                          {`${r.value >= ref.value ? "+" : "−"}${format(Math.abs(r.value - ref.value))} vs ${ref.label}`}
                        </p>
                      ))}
                      {note ? <div>{note(r.id)}</div> : null}
                    </>
                  );
                },
              })}
            />
            {hasNegative ? <ReferenceLine x={0} stroke="var(--border-strong)" /> : null}
            {references.map((r) => (
              <ReferenceLine
                key={r.label}
                x={r.value}
                {...referenceLineProps(r.label, { orientation: "vertical" })}
              />
            ))}
            <Bar
              dataKey="value"
              name={ariaLabel}
              {...barProps({ horizontal: true })}
              {...(onSelect
                ? {
                    onClick: (d: { id?: string }) => {
                      if (d.id) onSelect(d.id);
                    },
                    style: { cursor: "pointer" },
                  }
                : {})}
            >
              {data.map((r) => (
                <Cell key={r.id} fill={focusId == null || r.focus ? ACCENT : MUTED_MARK} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                offset={6}
                content={(p: {
                  x?: number | string | undefined;
                  y?: number | string | undefined;
                  width?: number | string | undefined;
                  height?: number | string | undefined;
                  value?: unknown;
                  index?: number | undefined;
                }) => {
                  if (!isNum(p.value)) return null;
                  const x = Number(p.x) + Math.max(0, Number(p.width)) + 6;
                  const y = Number(p.y) + Number(p.height) / 2;
                  const focus = data[p.index ?? -1]?.focus;
                  return (
                    <text
                      x={x}
                      y={y}
                      dy="0.32em"
                      fontSize={TICK.fontSize}
                      fontWeight={focus ? 600 : 400}
                      fill="var(--foreground)"
                      stroke="var(--surface)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      className="tabular-nums"
                    >
                      {format(p.value)}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {limit && total > rows.length ? (
        <p className="pt-1 text-xs text-muted-foreground">
          {`Top ${focusId && rows.some((r) => r.focus && r.rank > limit) ? limit - 1 : limit} of ${total} shown${focusId && rows.some((r) => r.focus && r.rank > limit) ? ", with the selected item" : ""}; the table view lists every row.`}
        </p>
      ) : null}
      {missing.length ? (
        <p className="pt-1 text-xs leading-4 text-muted-foreground">
          {`${NOT_RECORDED} (${missing.length}): ${missing
            .slice(0, 8)
            .map((m) => m.label)
            .join(", ")}${missing.length > 8 ? ", …" : ""}.`}
        </p>
      ) : null}
    </div>
  );
}

export type MultiplePanel = {
  /** Row key of this panel's series. */
  key: string;
  label: string;
};

export type SmallMultiplesGridProps = {
  rows: readonly Record<string, unknown>[];
  xKey: string;
  panels: readonly MultiplePanel[];
  format: (v: number) => string;
  tick?: ((v: number) => string) | undefined;
  /** Context series drawn thin and grey in every panel (national, median). */
  context?: { key: string; label: string } | undefined;
  /** Panel to emphasise (selected entity). */
  focusKey?: string | null | undefined;
  /** Shared value axis (default true): panels compare by height. */
  shared?: boolean | undefined;
  zero?: boolean | undefined;
  panelHeight?: number | undefined;
  /** Tailwind grid-cols classes. */
  columns?: string | undefined;
  /** Change line under each title (default: latest vs previous recorded period). */
  changeText?: ((points: readonly TakeawayPoint[]) => string | null) | undefined;
  ariaLabel: string;
  className?: string | undefined;
};

export function SmallMultiplesGrid({
  rows,
  xKey,
  panels,
  format,
  tick = (v) => tickText(v),
  context,
  focusKey = null,
  shared = true,
  zero = true,
  panelHeight = 96,
  columns = "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
  changeText,
  ariaLabel,
  className,
}: SmallMultiplesGridProps) {
  const allKeys = [...panels.map((p) => p.key), ...(context ? [context.key] : [])];
  const sharedAxis = shared ? niceAxis(plottedValues(rows, allKeys), { zero, count: 2 }) : null;
  const first = rows[0]?.[xKey];
  const last = rows[rows.length - 1]?.[xKey];
  return (
    <div className={className}>
      {context ? (
        <p className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
          <svg width="16" height="6" aria-hidden>
            <line
              x1="1"
              y1="3"
              x2="15"
              y2="3"
              stroke={CONTEXT_MARK}
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
          </svg>
          {`${context.label}, in every panel`}
          {shared ? " · shared scale" : " · each panel on its own scale"}
        </p>
      ) : (
        <p className="pb-2 text-xs text-muted-foreground">
          {shared ? "Shared scale: panels compare by height." : "Each panel on its own scale."}
        </p>
      )}
      <ul className={cn("grid gap-2", columns)} aria-label={ariaLabel}>
        {panels.map((p) => {
          const points: TakeawayPoint[] = rows.map((r) => ({
            label: String(r[xKey]),
            value: isNum(r[p.key]) ? (r[p.key] as number) : null,
          }));
          const lc = lastChange(points);
          const latest =
            lc?.to ?? (points.filter((x) => isNum(x.value)).at(-1) as TakeawayPoint | undefined);
          const axis =
            sharedAxis ??
            niceAxis(plottedValues(rows, [p.key, ...(context ? [context.key] : [])]), {
              zero,
              count: 2,
            });
          const focus = focusKey === p.key;
          const change =
            changeText?.(points) ??
            (lc
              ? `${lc.absolute > 0 ? "+" : lc.absolute < 0 ? "−" : "±"}${format(Math.abs(lc.absolute))} vs ${lc.from.label}`
              : null);
          return (
            <li
              key={p.key}
              className={cn(
                "min-w-0 rounded-lg border px-3 pb-1.5 pt-2",
                focus ? "border-foreground/40 ring-1 ring-foreground/15" : "border-border/70",
              )}
            >
              <p className="truncate text-xs font-medium text-foreground" title={p.label}>
                {p.label}
              </p>
              <p className="text-xs leading-4 text-muted-foreground">
                {latest && isNum(latest.value) ? (
                  <>
                    <span className="text-sm font-semibold text-foreground">
                      {format(latest.value)}
                    </span>{" "}
                    {latest.label}
                    {change ? ` · ${change}` : ""}
                  </>
                ) : (
                  NOT_RECORDED
                )}
              </p>
              <div style={{ height: panelHeight }} aria-hidden>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={rows as Record<string, unknown>[]}
                    margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid {...gridProps} />
                    <XAxis
                      dataKey={xKey}
                      tick={TICK}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border-strong)" }}
                      {...(first !== undefined && last !== undefined
                        ? { ticks: [first as string, last as string] }
                        : {})}
                      interval={0}
                      tickMargin={4}
                      height={18}
                    />
                    <YAxis
                      type="number"
                      domain={axis.domain}
                      ticks={[axis.ticks[0]!, axis.ticks[axis.ticks.length - 1]!]}
                      tick={TICK}
                      tickFormatter={tick}
                      tickLine={false}
                      axisLine={false}
                      width={Math.ceil(
                        Math.max(
                          ...[axis.ticks[0]!, axis.ticks.at(-1)!].map((t) => labelWidth(tick(t))),
                        ) + 8,
                      )}
                      interval={0}
                    />
                    <Tooltip
                      {...tooltipProps({
                        valueFormat: (v) => format(v),
                        hideKey: !context,
                      })}
                    />
                    {context ? (
                      <Line
                        dataKey={context.key}
                        name={context.label}
                        {...lineProps(CONTEXT_MARK, { dashed: true, muted: true })}
                      />
                    ) : null}
                    <Line dataKey={p.key} name={p.label} {...lineProps(ACCENT)} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type TimelineStripProps = {
  points: readonly TakeawayPoint[];
  format: (v: number) => string;
  /** Strip height in px (columns only; labels sit below). */
  height?: number | undefined;
  /** What one column counts, for the accessible summary ("recalls per year"). */
  what: string;
  className?: string | undefined;
};

/**
 * Compact history of a count: one thin column per period, earlier periods muted, the latest complete period in the
 * accent, partial periods hatched, missing periods as a hairline stub (never a zero column). First and last period
 * labels under the strip, the latest value beside it. Hover a column for its value.
 */
export function TimelineStrip({
  points,
  format,
  height = 36,
  what,
  className,
}: TimelineStripProps) {
  const recorded = points.filter((p) => isNum(p.value));
  if (recorded.length < 2) return null;
  const max = Math.max(...recorded.map((p) => Math.max(0, p.value as number)), 0);
  let lastIdx = -1;
  for (let i = points.length - 1; i >= 0; i--)
    if (isNum(points[i]!.value) && !points[i]!.partial) {
      lastIdx = i;
      break;
    }
  const peak = peakOf(points);
  const latest = lastIdx >= 0 ? points[lastIdx]! : null;
  const summary = `${what}, ${points[0]!.label} to ${points[points.length - 1]!.label}: latest ${latest ? `${format(latest.value as number)} (${latest.label})` : NOT_RECORDED}${peak ? `, highest ${format(peak.value)} (${peak.label})` : ""}.`;
  return (
    <figure className={cn("min-w-0", className)} aria-label={summary} role="img">
      <div className="flex items-end gap-3">
        <div className="flex min-w-0 flex-1 items-end gap-px" style={{ height }}>
          {points.map((p, i) => {
            const v = isNum(p.value) ? Math.max(0, p.value) : null;
            const h = v === null ? 1 : max > 0 ? Math.max(1.5, (v / max) * height) : 1.5;
            return (
              <span
                key={`${p.label}-${i}`}
                title={`${p.label}: ${v === null ? NOT_RECORDED : format(p.value as number)}${p.partial ? " (partial period)" : ""}`}
                className={cn("min-w-px flex-1 rounded-t-[2px]", v === null && "bg-border")}
                style={{
                  height: h,
                  ...(v === null
                    ? {}
                    : p.partial
                      ? {
                          background: `repeating-linear-gradient(135deg, ${ACCENT} 0 2px, transparent 2px 4px)`,
                          boxShadow: `inset 0 0 0 1px ${ACCENT}`,
                        }
                      : { background: i === lastIdx ? ACCENT : MUTED_MARK }),
                }}
              />
            );
          })}
        </div>
        {latest ? (
          <span className="shrink-0 text-sm font-semibold leading-none text-foreground">
            {format(latest.value as number)}
          </span>
        ) : null}
      </div>
      <figcaption
        className="mt-1 flex justify-between text-[11px] leading-4 text-muted-foreground"
        aria-hidden
      >
        <span>{points[0]!.label}</span>
        <span>{points[points.length - 1]!.label}</span>
      </figcaption>
    </figure>
  );
}
