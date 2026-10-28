/**
 * Ridgeline chart (d3-shape areas): one row per series, each scaled to its own peak and drawn overlapping the row above,
 * so the shape of every series reads at a glance whatever its size. A window of periods (`emphasisFrom` onward, e.g.
 * the last 12 months) is drawn in the row's colour, earlier periods in the base grey. Hover or arrow keys pick a row;
 * the tooltip gives the period under the pointer and its value. Wrap it in a ChartCard for title, unit, source and the
 * "View data" table: the drawing is the shape, the table carries every value.
 *
 *   <RidgelineChart rows={[{ id, label, note: "2.4×", values, color }]} keys={months} keyLabel={formatMonth}
 *     emphasisFrom={24} emphasisLabel="Last 12 months" formatter={metricFormatter("count")} unit="reports" />
 */
import { useId, useMemo, useState } from "react";
import { ChartCanvas, axisText, localPoint, type TipSpec } from "../canvas";
import type { ValueFormatter } from "../format";
import { ridges } from "./layouts";

export type RidgeRow = {
  id: string;
  label: string;
  /** Short text at the row's right end (a ratio, a total). */
  note?: string | undefined;
  values: readonly (number | null)[];
  color: string;
};

const STEP = 30;
const OVERLAP = 1.75;
const BOTTOM = 26;

export function RidgelineChart({
  rows,
  keys,
  keyLabel,
  tickLabel = keyLabel,
  emphasisFrom,
  emphasisLabel,
  formatter,
  unit,
  ariaLabel,
  onSelect,
}: {
  rows: readonly RidgeRow[];
  keys: readonly string[];
  keyLabel: (key: string) => string;
  tickLabel?: ((key: string) => string) | undefined;
  /** Index of the first emphasised period (all rows share the keys). */
  emphasisFrom?: number | undefined;
  emphasisLabel?: string | undefined;
  formatter: ValueFormatter;
  unit: string;
  ariaLabel: string;
  onSelect?: ((id: string) => void) | undefined;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [active, setActive] = useState<number | null>(null);
  const [hover, setHover] = useState<{ row: number; i: number } | null>(null);
  const top = STEP * OVERLAP - STEP + 8;
  const height = top + rows.length * STEP + BOTTOM;
  const inputs = useMemo(() => rows.map((r) => ({ id: r.id, values: r.values })), [rows]);
  return (
    <ChartCanvas
      height={height}
      ariaLabel={ariaLabel}
      count={rows.length}
      active={active}
      onActive={setActive}
      orientation="vertical"
      describe={(i) => {
        const r = rows[i];
        if (!r) return "";
        const vals = r.values.filter((v): v is number => typeof v === "number");
        return `${r.label}${r.note ? `, ${r.note}` : ""}: from ${formatter.full(vals[0] ?? null)} to ${formatter.full(vals.at(-1) ?? null)} ${unit}, peak ${formatter.full(Math.max(0, ...vals))}.`;
      }}
    >
      {(w) => {
        const labelW = Math.min(200, Math.max(110, w * 0.24));
        const noteW = rows.some((r) => r.note) ? 58 : 8;
        const x0 = labelW + 10;
        const x1 = w - noteW;
        const geo = ridges(inputs, { x0, x1, top, step: STEP, overlap: OVERLAP });
        const n = keys.length;
        const xAt = (i: number) => (n > 1 ? x0 + (i / (n - 1)) * (x1 - x0) : (x0 + x1) / 2);
        const split =
          emphasisFrom !== undefined && emphasisFrom > 0 && emphasisFrom < n
            ? xAt(emphasisFrom - 0.5)
            : null;
        const focusRow = active ?? hover?.row ?? null;
        // bold capitals run wider than the axis-text estimate: widen the per-character width by the share of capitals
        const em = (t: string) =>
          0.58 + 0.16 * ((t.match(/[A-Z]/g)?.length ?? 0) / Math.max(1, t.length));
        const fit = (t: string, width: number) => {
          if (t.length * 12 * em(t) <= width) return t;
          return `${t.slice(0, Math.max(4, Math.floor(width / (12 * em(t))) - 1))}…`;
        };
        const onMove = (e: React.PointerEvent<SVGRectElement>) => {
          const { x, y } = localPoint(e);
          // the row whose baseline is the first at or below the pointer owns it
          let row = geo.findIndex((g) => y <= g.base + 2);
          if (row < 0) row = geo.length - 1;
          const i = Math.max(
            0,
            Math.min(n - 1, Math.round(((x - x0) / Math.max(1, x1 - x0)) * (n - 1))),
          );
          setHover({ row, i });
        };
        const tipRow = hover ? rows[hover.row] : focusRow !== null ? rows[focusRow] : undefined;
        const tipGeo = hover ? geo[hover.row] : focusRow !== null ? geo[focusRow] : undefined;
        const tipIndex = hover?.i ?? n - 1;
        const tipPoint = tipGeo?.points[tipIndex];
        const tooltip: TipSpec | null =
          tipRow && tipGeo && tipPoint
            ? {
                x: tipPoint.x,
                y: tipPoint.y,
                content: {
                  title: tipRow.label,
                  subtitle: keyLabel(keys[tipIndex] ?? ""),
                  rows: [
                    { key: "v", label: unit, value: formatter.full(tipPoint.value) },
                    { key: "p", label: "Row peak", value: formatter.full(tipGeo.peak) },
                  ],
                  ...(onSelect ? { footer: "Click to open" } : {}),
                },
              }
            : null;
        const ticks: number[] = [];
        const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((x1 - x0) / 70))));
        for (let i = 0; i < n; i += every) ticks.push(i);
        const marks = (
          <g>
            <defs>
              {rows.map((r, i) => (
                <linearGradient
                  key={r.id}
                  id={`${uid}-g${i}`}
                  gradientUnits="userSpaceOnUse"
                  x1={x0}
                  x2={x1}
                  y1={0}
                  y2={0}
                >
                  {split !== null ? (
                    <>
                      <stop
                        offset={(split - x0) / Math.max(1, x1 - x0)}
                        stopColor="var(--chart-base)"
                      />
                      <stop offset={(split - x0) / Math.max(1, x1 - x0)} stopColor={r.color} />
                    </>
                  ) : (
                    <stop offset={0} stopColor={r.color} />
                  )}
                  <stop offset={1} stopColor={r.color} />
                </linearGradient>
              ))}
            </defs>
            {split !== null ? (
              <g>
                <rect
                  x={split}
                  y={4}
                  width={x1 - split}
                  height={height - BOTTOM - 4}
                  fill="var(--chart-1)"
                  opacity={0.045}
                />
                <line
                  x1={split}
                  x2={split}
                  y1={4}
                  y2={height - BOTTOM}
                  stroke="var(--chart-reference)"
                  strokeDasharray="3 3"
                  opacity={0.45}
                />
                {emphasisLabel ? (
                  <text x={split + 4} y={12} {...axisText} fontWeight={600}>
                    {emphasisLabel}
                  </text>
                ) : null}
              </g>
            ) : null}
            {geo.map((g, i) => {
              const r = rows[i]!;
              const dim = focusRow !== null && focusRow !== i;
              return (
                <g key={g.id} opacity={dim ? 0.35 : 1} style={{ transition: "opacity 160ms" }}>
                  {/* the surface fill hides the row behind, as a ridge in front would */}
                  <path d={g.area} fill="var(--chart-surface)" />
                  <path d={g.area} fill={`url(#${uid}-g${i})`} fillOpacity={0.28} />
                  <path
                    d={g.line}
                    fill="none"
                    stroke={`url(#${uid}-g${i})`}
                    strokeWidth={focusRow === i ? 2.2 : 1.6}
                  />
                  <line
                    x1={x0}
                    x2={x1}
                    y1={g.base + 0.5}
                    y2={g.base + 0.5}
                    stroke="var(--chart-baseline)"
                    opacity={0.5}
                  />
                  <text
                    x={labelW}
                    y={g.base - 3}
                    textAnchor="end"
                    fontSize={12}
                    fontWeight={focusRow === i ? 700 : 600}
                    fill="var(--chart-ink)"
                  >
                    {fit(r.label, labelW - 6)}
                  </text>
                  {r.note ? (
                    <text
                      x={w - 2}
                      y={g.base - 3}
                      textAnchor="end"
                      fontSize={11.5}
                      fontWeight={600}
                      fill="var(--chart-ink)"
                      className="tabular-nums"
                    >
                      {r.note}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {ticks.map((i) => (
              <text key={i} x={xAt(i)} y={height - BOTTOM + 15} textAnchor="middle" {...axisText}>
                {tickLabel(keys[i] ?? "")}
              </text>
            ))}
            {hover && tipPoint ? (
              <g pointerEvents="none">
                <line
                  x1={tipPoint.x}
                  x2={tipPoint.x}
                  y1={4}
                  y2={height - BOTTOM}
                  stroke="var(--chart-ink)"
                  opacity={0.25}
                />
                <circle
                  cx={tipPoint.x}
                  cy={tipPoint.y}
                  r={4}
                  fill={rows[hover.row]?.color}
                  stroke="var(--chart-surface)"
                  strokeWidth={2}
                />
              </g>
            ) : null}
            <rect
              x={0}
              y={0}
              width={w}
              height={height - BOTTOM}
              fill="transparent"
              className={onSelect ? "cursor-pointer" : undefined}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
              onClick={() => {
                const r = hover ? rows[hover.row] : undefined;
                if (r && onSelect) onSelect(r.id);
              }}
            />
          </g>
        );
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}
