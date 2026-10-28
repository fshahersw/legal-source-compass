/**
 * Forest plot: one row per product, its observed count against the expected count as a ratio (dot) with the
 * approximate 95% interval of the observed count (whisker), on a log scale with 1× (in line with the source as a whole)
 * marked. A whisker clear of the 1× line is a rise the count's own noise does not explain.
 */
import { useState } from "react";
import { scaleLog } from "d3-scale";
import { ChartCanvas, axisText, type TipSpec } from "@/components/charts/canvas";

export type ForestRow = {
  id: string;
  label: string;
  /** Second line under the label (MDL, actions pending). */
  note?: string | undefined;
  ratio: number;
  lower: number;
  upper: number;
  observed: number;
  expected: number;
  color: string;
};

const ROW = 30;
const TOP = 22;
const BOTTOM = 26;
const n = (v: number) => Math.round(v).toLocaleString("en-US");

export function ForestPlot({
  rows,
  unit,
  ariaLabel,
}: {
  rows: readonly ForestRow[];
  /** "reports", "death reports". */
  unit: string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const height = TOP + rows.length * ROW + BOTTOM;
  const hi = Math.max(2, ...rows.map((r) => r.upper));
  const lo = Math.min(0.5, ...rows.map((r) => r.lower));
  const domain: [number, number] = [
    Math.pow(2, Math.floor(Math.log2(Math.max(lo, 1 / 16)))),
    Math.pow(2, Math.ceil(Math.log2(Math.min(hi, 256)))),
  ];
  const ticks: number[] = [];
  for (let v = domain[0]; v <= domain[1] + 1e-9; v *= 2) ticks.push(v);
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
        return r
          ? `${r.label}: ${n(r.observed)} ${unit} against ${n(r.expected)} expected, ${r.ratio.toFixed(2)} times, interval ${r.lower.toFixed(2)} to ${r.upper.toFixed(2)}.`
          : "";
      }}
    >
      {(w) => {
        const labelW = Math.min(240, Math.max(120, w * 0.36));
        const valueW = 74;
        const x = scaleLog()
          .domain(domain)
          .range([labelW + 8, w - valueW])
          .clamp(true);
        const step = ticks.length > 9 ? 2 : 1;
        const focus = active ?? hover;
        // bold capitals run wider than the axis-text estimate: widen the per-character width by the share of capitals
        const em = (t: string) =>
          0.58 + 0.16 * ((t.match(/[A-Z]/g)?.length ?? 0) / Math.max(1, t.length));
        const fit = (text: string, width: number, size: number) => {
          if (text.length * size * em(text) <= width) return text;
          const chars = Math.max(4, Math.floor(width / (size * em(text))) - 1);
          return `${text.slice(0, chars)}…`;
        };
        const tip: TipSpec | null =
          focus !== null && rows[focus]
            ? {
                x: x(rows[focus]!.ratio),
                y: TOP + focus * ROW,
                content: {
                  title: rows[focus]!.label,
                  ...(rows[focus]!.note ? { subtitle: rows[focus]!.note } : {}),
                  rows: [
                    { key: "o", label: "Last 12 months", value: n(rows[focus]!.observed) },
                    { key: "e", label: "Expected", value: n(rows[focus]!.expected) },
                    {
                      key: "r",
                      label: "Ratio (95% interval)",
                      value: `${rows[focus]!.ratio.toFixed(2)}× (${rows[focus]!.lower.toFixed(2)}–${rows[focus]!.upper.toFixed(2)})`,
                    },
                  ],
                },
              }
            : null;
        const marks = (
          <g>
            {ticks.map((t, i) =>
              i % step ? null : (
                <g key={t}>
                  <line
                    x1={x(t)}
                    x2={x(t)}
                    y1={TOP - 6}
                    y2={height - BOTTOM}
                    stroke={t === 1 ? "var(--chart-reference)" : "var(--chart-gridline)"}
                    strokeDasharray={t === 1 ? "4 3" : undefined}
                    opacity={t === 1 ? 0.6 : 1}
                  />
                  <text x={x(t)} y={height - BOTTOM + 15} textAnchor="middle" {...axisText}>
                    {t < 1 ? `1/${Math.round(1 / t)}×` : `${t}×`}
                  </text>
                </g>
              ),
            )}
            <text x={x(1) + 4} y={TOP - 9} {...axisText}>
              in line
            </text>
            {rows.map((r, i) => {
              const cy = TOP + i * ROW + ROW / 2 - 4;
              const on = focus === i;
              return (
                <g
                  key={r.id}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                >
                  <rect
                    x={0}
                    y={cy - ROW / 2 + 2}
                    width={w}
                    height={ROW - 2}
                    fill={on ? "var(--chart-gridline)" : "transparent"}
                    opacity={0.6}
                  />
                  <text
                    x={labelW}
                    y={r.note ? cy - 1 : cy + 4}
                    textAnchor="end"
                    fontSize={12}
                    fontWeight={600}
                    fill="var(--chart-ink)"
                  >
                    {fit(r.label, labelW - 4, 12)}
                  </text>
                  {r.note ? (
                    <text x={labelW} y={cy + 11} textAnchor="end" {...axisText}>
                      {fit(r.note, labelW - 4, 11)}
                    </text>
                  ) : null}
                  <line
                    x1={x(r.lower)}
                    x2={x(r.upper)}
                    y1={cy}
                    y2={cy}
                    stroke={r.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    opacity={0.55}
                  />
                  <circle
                    cx={x(r.ratio)}
                    cy={cy}
                    r={on ? 6 : 5}
                    fill={r.color}
                    stroke="var(--chart-surface)"
                    strokeWidth={2}
                  />
                  <text
                    x={w - 2}
                    y={cy + 4}
                    textAnchor="end"
                    fontSize={11.5}
                    fontWeight={600}
                    fill="var(--chart-ink)"
                    className="tabular-nums"
                  >
                    {r.ratio >= 10 ? r.ratio.toFixed(0) : r.ratio.toFixed(2)}×
                  </text>
                </g>
              );
            })}
          </g>
        );
        return { marks, tooltip: tip };
      }}
    </ChartCanvas>
  );
}
