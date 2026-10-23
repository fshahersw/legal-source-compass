/**
 * Matrix heatmap (entities × periods, metric × metric) and its calendar form (years × months). Sequential shading for
 * magnitude, diverging for signed values such as correlations. A cell the source does not record is hatched, never
 * the lightest shade. Every cell is a hover and keyboard target (row by row).
 */
import { useId, useMemo, useState } from "react";
import { ChartCanvas, textWidth, type TipSpec } from "./canvas";
import type { ValueFormatter } from "./format";
import { divergingFill, sequentialFill } from "./palette";

export type HeatAxisItem = { id: string; label: string };

export type HeatmapProps = {
  rows: readonly HeatAxisItem[];
  columns: readonly HeatAxisItem[];
  /** Value of a cell; null = not recorded. */
  value: (rowId: string, colId: string) => number | null;
  formatter: ValueFormatter;
  ariaLabel: string;
  scale?: "sequential" | "diverging";
  /** Diverging scales are symmetric around 0; default ±max|v|. */
  domain?: readonly [number, number] | undefined;
  /** Write the value inside each cell when it fits. */
  cellLabels?: boolean;
  cellHeight?: number;
  width?: number | undefined;
  /** Extra tooltip line for a cell (e.g. n behind it). */
  cellNote?: ((rowId: string, colId: string) => string | undefined) | undefined;
};

/** Rows of years and columns of months for a monthly series ("YYYY-MM" keys). */
export function calendarMatrix(points: readonly { key: string; value: number | null }[]): {
  rows: HeatAxisItem[];
  columns: HeatAxisItem[];
  lookup: Map<string, number | null>;
} {
  const lookup = new Map<string, number | null>();
  const years = new Set<string>();
  for (const p of points) {
    const m = /^(\d{4})-(\d{2})$/.exec(p.key);
    if (!m) continue;
    years.add(m[1]!);
    lookup.set(p.key, p.value);
  }
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return {
    rows: [...years].sort().map((y) => ({ id: y, label: y })),
    columns: months.map((m, i) => ({ id: String(i + 1).padStart(2, "0"), label: m })),
    lookup,
  };
}

export function Heatmap({
  rows,
  columns,
  value,
  formatter,
  ariaLabel,
  scale = "sequential",
  domain,
  cellLabels = false,
  cellHeight = 18,
  width,
  cellNote,
}: HeatmapProps) {
  const hatch = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [active, setActive] = useState<number | null>(null);
  const values = useMemo(() => {
    const out: (number | null)[] = [];
    for (const r of rows) for (const c of columns) out.push(value(r.id, c.id));
    return out;
  }, [rows, columns, value]);
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const lo = domain ? domain[0] : finite.length ? Math.min(...finite) : 0;
  const hi = domain ? domain[1] : finite.length ? Math.max(...finite) : 1;
  const maxAbs = domain
    ? Math.max(Math.abs(domain[0]), Math.abs(domain[1]))
    : Math.max(...finite.map(Math.abs), 1e-9);
  const t = (v: number) =>
    scale === "diverging" ? v / maxAbs : hi > lo ? (v - lo) / (hi - lo) : 0.5;
  const fill = (v: number | null) =>
    v === null || !Number.isFinite(v)
      ? `url(#${hatch})`
      : scale === "diverging"
        ? divergingFill(t(v))
        : sequentialFill(t(v));
  const labelW = Math.min(180, Math.max(40, ...rows.map((r) => textWidth(r.label, 10.5) + 10)));
  const headerH = Math.max(
    18,
    Math.min(70, Math.max(...columns.map((c) => textWidth(c.label, 10))) * 0.75 + 8),
  );
  const height = headerH + rows.length * cellHeight + 30;
  const n = rows.length * columns.length;
  const describe = (i: number) => {
    const r = rows[Math.floor(i / columns.length)]!;
    const c = columns[i % columns.length]!;
    return `${r.label}, ${c.label}: ${formatter.full(values[i] ?? null)}.`;
  };
  return (
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
        const cw = Math.max(6, (w - labelW - 4) / Math.max(1, columns.length));
        const rotate = columns.some((c) => textWidth(c.label, 10) > cw - 2);
        const legendY = headerH + rows.length * cellHeight + 12;
        const marks = (
          <>
            <defs>
              <pattern
                id={hatch}
                width="5"
                height="5"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="5" height="5" fill="var(--muted)" />
                <line x1="0" y1="0" x2="0" y2="5" stroke="var(--chart-axis)" strokeOpacity={0.45} />
              </pattern>
              <linearGradient id={`${hatch}-g`}>
                {[0, 0.25, 0.5, 0.75, 1].map((s) => (
                  <stop
                    key={s}
                    offset={s}
                    stopColor={scale === "diverging" ? divergingFill(s * 2 - 1) : sequentialFill(s)}
                  />
                ))}
              </linearGradient>
            </defs>
            {columns.map((c, ci) => {
              const cx = labelW + ci * cw + cw / 2;
              return rotate ? (
                <text
                  key={c.id}
                  transform={`translate(${cx},${headerH - 4}) rotate(-45)`}
                  fontSize={10}
                  fill="var(--chart-axis)"
                >
                  {c.label.length > 14 ? `${c.label.slice(0, 13)}…` : c.label}
                </text>
              ) : (
                <text
                  key={c.id}
                  x={cx}
                  y={headerH - 5}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--chart-axis)"
                >
                  {c.label}
                </text>
              );
            })}
            {rows.map((r, ri) => (
              <g key={r.id}>
                <text
                  x={labelW - 6}
                  y={headerH + ri * cellHeight + cellHeight / 2}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={10.5}
                  fill="var(--chart-ink)"
                >
                  {r.label}
                </text>
                {columns.map((c, ci) => {
                  const idx = ri * columns.length + ci;
                  const v = values[idx] ?? null;
                  const x0 = labelW + ci * cw;
                  const y0 = headerH + ri * cellHeight;
                  const tv = v === null ? 0 : Math.abs(t(v));
                  return (
                    <g
                      key={c.id}
                      onPointerEnter={() => setActive(idx)}
                      onPointerLeave={() => setActive(null)}
                    >
                      <rect
                        x={x0 + 1}
                        y={y0 + 1}
                        width={Math.max(1, cw - 2)}
                        height={cellHeight - 2}
                        rx={2}
                        fill={fill(v)}
                        stroke={active === idx ? "var(--chart-ink)" : "none"}
                        strokeWidth={1.5}
                      />
                      {cellLabels && v !== null && textWidth(formatter.tick(v), 9.5) < cw - 4 ? (
                        <text
                          x={x0 + cw / 2}
                          y={y0 + cellHeight / 2}
                          dy="0.32em"
                          textAnchor="middle"
                          fontSize={9.5}
                          fill={tv > 0.55 ? "var(--primary-foreground)" : "var(--chart-ink)"}
                          pointerEvents="none"
                        >
                          {formatter.tick(v)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            ))}
            <g transform={`translate(${labelW},${legendY})`} fontSize={10} fill="var(--chart-axis)">
              <text x={0} y={4} dy="0.32em">
                {formatter.tick(scale === "diverging" ? -maxAbs : lo)}
              </text>
              <rect x={40} y={0} width={90} height={8} rx={2} fill={`url(#${hatch}-g)`} />
              <text x={136} y={4} dy="0.32em">
                {formatter.tick(scale === "diverging" ? maxAbs : hi)}
              </text>
              <rect
                x={190}
                y={0}
                width={14}
                height={8}
                fill={`url(#${hatch})`}
                stroke="var(--border)"
              />
              <text x={208} y={4} dy="0.32em">
                Not recorded
              </text>
            </g>
          </>
        );
        const tooltip: TipSpec | null =
          active !== null
            ? (() => {
                const ri = Math.floor(active / columns.length);
                const ci = active % columns.length;
                const r = rows[ri]!;
                const c = columns[ci]!;
                return {
                  x: labelW + ci * cw + cw / 2,
                  y: headerH + ri * cellHeight + cellHeight,
                  content: {
                    title: r.label,
                    subtitle: c.label,
                    rows: [{ key: "v", label: "", value: formatter.full(values[active] ?? null) }],
                    footer: cellNote?.(r.id, c.id),
                  },
                };
              })()
            : null;
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}
