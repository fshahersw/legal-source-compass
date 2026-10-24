/**
 * Content components of the recharts theme layer: the tooltip box, the legend (HTML above the plot, or as recharts
 * legend content), direct end labels for lines and the partial-period key. See theme.ts for the prop factories.
 */
import type { ReactNode } from "react";
import { NOT_RECORDED } from "../format";
import { dodgeLabels } from "../scale";
import { TICK_FONT } from "./axis";
import { cn } from "@/lib/utils";

type TooltipEntry = {
  name?: string | number;
  value?: unknown;
  color?: string;
  stroke?: string;
  fill?: string;
  dataKey?: string | number | ((d: unknown) => unknown);
  payload?: Record<string, unknown>;
};

export type ThemedTooltipProps = {
  active?: boolean | undefined;
  payload?: readonly TooltipEntry[] | undefined;
  label?: unknown;
  /** Value text for one entry ("1,204 cases", "12.0%"). */
  valueFormat?: ((value: number, key: string, row: Record<string, unknown>) => string) | undefined;
  /** Title text for the hovered category or period. */
  labelFormat?: ((label: unknown, row: Record<string, unknown> | undefined) => string) | undefined;
  /** Hide the series colour key (single-series charts). */
  hideKey?: boolean | undefined;
  /** Order rows by value, largest first (stacks with many parts). */
  sortByValue?: boolean | undefined;
  /** Extra line(s) under the rows (partial period, n). */
  footer?: ((row: Record<string, unknown> | undefined) => ReactNode) | undefined;
  /** Leave out entries whose dataKey matches (helper keys such as partial-period twins). */
  omit?: ((key: string, row: Record<string, unknown> | undefined) => boolean) | undefined;
  /** Total row for stacks. */
  total?: ((row: Record<string, unknown> | undefined) => string | null) | undefined;
};

/** Tooltip box: the value leads in strong ink, the series name follows muted; series keyed by a short line. */
export function ThemedTooltip({
  active,
  payload,
  label,
  valueFormat,
  labelFormat,
  hideKey,
  sortByValue,
  footer,
  omit,
  total,
}: ThemedTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const entries = payload.filter((e) => !omit?.(String(e.dataKey ?? ""), row));
  const seen = new Set<string>();
  const uniq = entries.filter((e) => {
    const k = String(e.dataKey ?? e.name ?? "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const rows = sortByValue
    ? [...uniq].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
    : uniq;
  const title = labelFormat ? labelFormat(label, row) : String(label ?? "");
  const totalText = total?.(row) ?? null;
  return (
    <div
      data-chart-tooltip=""
      className="pointer-events-none min-w-32 max-w-[260px] rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs leading-4 text-popover-foreground shadow-md"
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <ul className="mt-1 space-y-0.5">
        {rows.map((e) => {
          const key = String(e.dataKey ?? e.name ?? "");
          const v = typeof e.value === "number" && Number.isFinite(e.value) ? e.value : null;
          const color = e.color ?? e.stroke ?? e.fill;
          return (
            <li key={key} className="flex items-baseline gap-1.5">
              {!hideKey && color ? (
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-2.5 shrink-0 translate-y-[-3px] rounded-full"
                  style={{ background: color }}
                />
              ) : null}
              <span className="font-semibold tabular-nums">
                {v === null
                  ? NOT_RECORDED
                  : valueFormat
                    ? valueFormat(v, key, row ?? {})
                    : v.toLocaleString("en-US")}
              </span>
              {hideKey && rows.length === 1 ? null : (
                <span className="min-w-0 truncate text-muted-foreground">
                  {String(e.name ?? key)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {totalText ? (
        <p className="mt-1 border-t border-border/70 pt-1">
          <span className="font-semibold tabular-nums">{totalText}</span>{" "}
          <span className="text-muted-foreground">total</span>
        </p>
      ) : null}
      {footer ? <div className="mt-1 text-muted-foreground">{footer(row)}</div> : null}
    </div>
  );
}

export type LegendItem = {
  id: string;
  label: string;
  color: string;
  dashed?: boolean | undefined;
  /** A short annotation after the label ("13", "partial"). */
  note?: string | undefined;
};

/**
 * Legend above the plot, in HTML: a short line for lines, a swatch for bars and areas. For two or more series only
 * (a single series is named by the title).
 */
export function SeriesLegend({
  items,
  mark = "line",
  className,
  force = false,
}: {
  items: readonly LegendItem[];
  mark?: "line" | "swatch";
  className?: string | undefined;
  /** Draw even for one item (a key that explains a mark, such as a partial period). */
  force?: boolean;
}) {
  if (items.length < 2 && !force) return null;
  return (
    <ul
      aria-label="Legend"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-4 text-muted-foreground",
        className,
      )}
    >
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-1.5">
          {mark === "line" ? (
            <svg width="16" height="6" aria-hidden className="shrink-0">
              <line
                x1="1"
                y1="3"
                x2="15"
                y2="3"
                stroke={it.color}
                strokeWidth="2"
                strokeLinecap="round"
                {...(it.dashed ? { strokeDasharray: "3 3" } : {})}
              />
            </svg>
          ) : (
            <span
              aria-hidden
              className="inline-block size-2.5 shrink-0 rounded-[3px]"
              style={{ background: it.color }}
            />
          )}
          <span className="text-foreground">{it.label}</span>
          {it.note ? <span className="tabular-nums">{it.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

type LegendPayload = {
  value?: unknown;
  color?: string;
  type?: string;
  dataKey?: unknown;
  payload?: { strokeDasharray?: string | number };
};

/** Content for a recharts `<Legend>`: same look as SeriesLegend. Prefer SeriesLegend above the chart. */
export function ThemedLegend({
  payload,
  mark = "line",
}: {
  payload?: readonly LegendPayload[];
  mark?: "line" | "swatch";
}) {
  if (!payload?.length) return null;
  return (
    <SeriesLegend
      className="pb-2"
      mark={mark}
      force
      items={payload.map((p, i) => ({
        id: `${String(p.dataKey ?? p.value)}-${i}`,
        label: String(p.value ?? ""),
        color: p.color ?? "var(--muted-foreground)",
        dashed: Boolean(p.payload?.strokeDasharray),
      }))}
    />
  );
}

type FormattedItem = {
  item?: { type?: { displayName?: string }; props?: Record<string, unknown> };
  props?: {
    points?: readonly { x?: number; y?: number | null; value?: unknown; payload?: unknown }[];
    dataKey?: unknown;
    name?: unknown;
    stroke?: unknown;
    hide?: boolean;
  };
};

export type EndLabelsProps = {
  /** Value text at the line end. */
  format: (v: number) => string;
  /** Print the series name before the value (default: when two or more lines are drawn). */
  names?: boolean | undefined;
  /** Keys to label (default: every line). */
  keys?: readonly string[] | undefined;
  /** Short display name per key (defaults to the line's `name`). */
  labelFor?: ((key: string) => string) | undefined;
  // injected by recharts <Customized>
  formattedGraphicalItems?: readonly FormattedItem[];
  offset?: { top?: number; height?: number; left?: number; width?: number };
};

/**
 * Direct labels at the end of each line (name and last value), dodged so they never overlap, with a short leader when
 * a label had to move. Use inside a LineChart/ComposedChart as `<Customized component={<EndLabels format={fmt} />} />`
 * and leave right margin for the text (`endLabelMargin`). Only for up to four series; beyond that use the legend and
 * tooltip or small multiples.
 */
export function EndLabels({
  format,
  names,
  keys,
  labelFor,
  formattedGraphicalItems,
  offset,
}: EndLabelsProps) {
  const lines = (formattedGraphicalItems ?? []).filter(
    (g) =>
      g.item?.type?.displayName === "Line" &&
      !g.props?.hide &&
      (!keys || keys.includes(String(g.props?.dataKey ?? ""))),
  );
  if (!lines.length || lines.length > 4) return null;
  const withNames = names ?? lines.length > 1;
  const ends = lines
    .map((g) => {
      const pts = g.props?.points ?? [];
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i]!;
        if (typeof p.value === "number" && Number.isFinite(p.value) && typeof p.y === "number")
          return {
            key: String(g.props?.dataKey ?? ""),
            name: String(g.props?.name ?? g.props?.dataKey ?? ""),
            x: p.x ?? 0,
            y: p.y,
            value: p.value,
          };
      }
      return null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  if (!ends.length) return null;
  const top = offset?.top ?? 0;
  const bottom = top + (offset?.height ?? 200);
  const ys = dodgeLabels(
    ends.map((e) => e.y),
    14,
    top + 4,
    bottom - 4,
  );
  return (
    <g className="recharts-end-labels" aria-hidden>
      {ends.map((e, i) => {
        const label = withNames
          ? `${labelFor ? labelFor(e.key) : e.name} ${format(e.value)}`
          : format(e.value);
        return (
          <g key={e.key}>
            {Math.abs(ys[i]! - e.y) > 3 ? (
              <line
                x1={e.x + 3}
                x2={e.x + 7}
                y1={e.y}
                y2={ys[i]}
                stroke="var(--border-strong)"
                strokeWidth={1}
              />
            ) : null}
            <text
              x={e.x + 8}
              y={ys[i]}
              dy="0.32em"
              fontSize={TICK_FONT}
              fill="var(--foreground)"
              className="tabular-nums"
              stroke="var(--surface)"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * A neutral "partial period" key for charts that hatch or dash an incomplete period, so the mark's meaning is stated
 * next to the chart, not only in a note.
 */
export function PartialKey({ label = "Partial period" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <svg width="16" height="6" aria-hidden className="shrink-0">
        <line
          x1="1"
          y1="3"
          x2="15"
          y2="3"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="3 3"
        />
      </svg>
      {label}
    </span>
  );
}
