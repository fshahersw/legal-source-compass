/**
 * Ranked horizontal bars, sorted, with the value written at each bar end, optional reference lines (national value,
 * peer median) labelled inline, and a focus highlight: with `highlight`, that bar keeps the accent and the others are
 * muted, so "where does this one sit" reads at a glance. Entities without a value are not drawn as zero: they are
 * listed under the chart as not recorded. Values may be negative (residuals): bars then grow from a zero line, the
 * negative arm in the diverging orange. Ranks use competition ranking (ties share a rank).
 */
import { useMemo, useState } from "react";
import { ChartCanvas, axisText, textWidth, type TipSpec } from "./canvas";
import type { ValueFormatter } from "./format";
import { seriesVar } from "./palette";
import { linearScale, niceDomain } from "./scale";

export type RankedItem = {
  id: string;
  label: string;
  value: number | null;
  note?: string | undefined;
};

export type ReferenceLine = { label: string; value: number };

export type RankedRow = RankedItem & { value: number; rank: number };

/** Sort by value (descending unless `ascending`), competition-ranked; items without a value are returned apart. */
export function rankItems(
  items: readonly RankedItem[],
  ascending = false,
): { ranked: RankedRow[]; missing: RankedItem[] } {
  const ranked = items
    .filter(
      (i): i is RankedItem & { value: number } =>
        typeof i.value === "number" && Number.isFinite(i.value),
    )
    .sort(
      (a, b) =>
        (ascending ? a.value - b.value : b.value - a.value) || a.label.localeCompare(b.label),
    );
  const out: RankedRow[] = [];
  ranked.forEach((r, i) => {
    const prev = out[i - 1];
    out.push({ ...r, rank: prev && prev.value === r.value ? prev.rank : i + 1 });
  });
  return {
    ranked: out,
    missing: items.filter((i) => !(typeof i.value === "number" && Number.isFinite(i.value))),
  };
}

export function RankedBars({
  items,
  formatter,
  unit,
  ariaLabel,
  references = [],
  highlight = null,
  ascending = false,
  diverging = false,
  rowHeight = 22,
  width,
  onSelect,
  limit,
}: {
  items: readonly RankedItem[];
  formatter: ValueFormatter;
  unit?: string | undefined;
  ariaLabel: string;
  references?: readonly ReferenceLine[];
  highlight?: string | null;
  ascending?: boolean;
  /** Colour by sign (residuals) instead of one hue. */
  diverging?: boolean;
  rowHeight?: number;
  width?: number | undefined;
  onSelect?: ((id: string) => void) | undefined;
  /** Show the top N only (the table still lists every row). */
  limit?: number | undefined;
}) {
  const [active, setActive] = useState<number | null>(null);
  const { ranked, missing } = useMemo(() => rankItems(items, ascending), [items, ascending]);
  // With a limit: the top rows; for signed values (diverging) the largest at each end.
  const shown =
    !limit || ranked.length <= limit
      ? ranked
      : diverging
        ? [
            ...ranked.slice(0, Math.ceil(limit / 2)),
            ...ranked.slice(ranked.length - Math.floor(limit / 2)),
          ]
        : ranked.slice(0, limit);
  const values = [...shown.map((r) => r.value), ...references.map((r) => r.value)];
  const domainFor = (plot: number) =>
    niceDomain(values, { zero: true, count: Math.max(2, Math.min(5, Math.floor(plot / 70))) });
  const labelW = Math.min(190, Math.max(60, ...shown.map((r) => textWidth(r.label, 12) + 28)));
  const valueW = Math.max(44, ...shown.map((r) => textWidth(formatter.full(r.value), 12) + 10));
  const top = references.length ? 14 + references.length * 13 : 8;
  const height = top + shown.length * rowHeight + 22;
  const describe = (i: number) => {
    const r = shown[i]!;
    return `Rank ${r.rank} of ${ranked.length}: ${r.label}, ${formatter.full(r.value)}${unit ? ` ${unit}` : ""}.`;
  };
  return (
    <div className="min-w-0">
      <ChartCanvas
        width={width}
        height={height}
        ariaLabel={ariaLabel}
        count={shown.length}
        active={active}
        onActive={setActive}
        describe={describe}
        orientation="vertical"
      >
        {(w) => {
          const { domain, ticks } = domainFor(w - labelW - valueW);
          const x = linearScale(domain, [labelW, Math.max(labelW + 40, w - valueW)]);
          const zeroX = x(0);
          const marks = (
            <>
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={x(t)}
                    x2={x(t)}
                    y1={top - 4}
                    y2={height - 18}
                    stroke={t === 0 ? "var(--border-strong)" : "var(--chart-grid)"}
                    shapeRendering="crispEdges"
                  />
                  <text x={x(t)} y={height - 6} textAnchor="middle" {...axisText}>
                    {formatter.tick(t)}
                  </text>
                </g>
              ))}
              {shown.map((r, i) => {
                const yy = top + i * rowHeight;
                const bh = Math.min(24, rowHeight - 8);
                const x1 = x(r.value);
                const isHi = highlight === r.id;
                const fill = diverging
                  ? r.value < 0
                    ? "var(--chart-2)"
                    : "var(--chart-1)"
                  : highlight && !isHi
                    ? "var(--chart-muted-mark)"
                    : "var(--chart-1)";
                const left = Math.min(zeroX, x1);
                const bw = Math.abs(x1 - zeroX);
                const by = yy + (rowHeight - bh) / 2;
                return (
                  <g
                    key={r.id}
                    onPointerEnter={() => setActive(i)}
                    onPointerLeave={() => setActive(null)}
                    onClick={() => onSelect?.(r.id)}
                    style={onSelect ? { cursor: "pointer" } : undefined}
                  >
                    <rect
                      x={0}
                      y={yy}
                      width={w}
                      height={rowHeight}
                      fill={active === i ? "var(--muted)" : "transparent"}
                    />
                    <text
                      x={4}
                      y={yy + rowHeight / 2}
                      dy="0.32em"
                      fontSize={11}
                      fill="var(--chart-axis)"
                      className="tabular-nums"
                    >
                      {r.rank}
                    </text>
                    <text
                      x={24}
                      y={yy + rowHeight / 2}
                      dy="0.32em"
                      fontSize={12}
                      fontWeight={isHi ? 600 : 400}
                      fill="var(--chart-ink)"
                    >
                      {truncate(r.label, Math.floor((labelW - 28) / 6.7))}
                    </text>
                    {bw >= 0.5 ? (
                      <path
                        d={barPath(left, by, bw, bh, r.value < 0 ? "left" : "right")}
                        fill={fill}
                      />
                    ) : null}
                    <text
                      x={r.value < 0 ? left - 5 : Math.max(x1, zeroX) + 5}
                      y={yy + rowHeight / 2}
                      dy="0.32em"
                      fontSize={12}
                      fontWeight={isHi ? 600 : 400}
                      textAnchor={r.value < 0 ? "end" : "start"}
                      fill="var(--chart-ink)"
                      stroke="var(--chart-surface)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      className="tabular-nums"
                    >
                      {formatter.full(r.value)}
                    </text>
                  </g>
                );
              })}
              {references.map((ref, ri) => (
                <g key={ref.label} pointerEvents="none">
                  <line
                    x1={x(ref.value)}
                    x2={x(ref.value)}
                    y1={top - 6}
                    y2={height - 18}
                    stroke="var(--chart-reference)"
                    strokeWidth={1.25}
                    strokeDasharray={ri === 0 ? undefined : "4 3"}
                  />
                  <text
                    x={x(ref.value)}
                    y={10 + ri * 13}
                    textAnchor={x(ref.value) > w - 120 ? "end" : "middle"}
                    fontSize={11}
                    fill="var(--chart-ink)"
                  >
                    {`${ref.label}: ${formatter.full(ref.value)}`}
                  </text>
                </g>
              ))}
            </>
          );
          const r = active !== null ? shown[active] : undefined;
          const tooltip: TipSpec | null = r
            ? {
                x: Math.min(x(r.value), w - 40),
                y: top + (active ?? 0) * rowHeight + rowHeight,
                content: {
                  title: r.label,
                  subtitle: `Rank ${r.rank} of ${ranked.length}`,
                  rows: [
                    { key: "v", label: unit ?? "", value: formatter.full(r.value) },
                    ...references.map((ref) => ({
                      key: ref.label,
                      label: ref.label,
                      value: `${formatter.delta(r.value - ref.value)}`,
                      note: "difference",
                    })),
                  ],
                  footer: r.note,
                },
              }
            : null;
          return { marks, tooltip };
        }}
      </ChartCanvas>
      {limit && ranked.length > limit ? (
        <p className="pt-1 text-[11px] text-muted-foreground">
          {diverging
            ? `The ${Math.ceil(limit / 2)} highest and ${Math.floor(limit / 2)} lowest of ${ranked.length} shown; the data table lists every row.`
            : `Top ${limit} of ${ranked.length} shown; the data table lists every row.`}
        </p>
      ) : null}
      {missing.length ? (
        <p className="pt-1 text-[11px] leading-4 text-muted-foreground">
          Not recorded ({missing.length}): {missing.map((m) => m.label).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

/** A horizontal bar with a 4 px rounded data end and a square baseline end. */
function barPath(x: number, y: number, w: number, h: number, end: "left" | "right"): string {
  const r = Math.min(4, w, h / 2);
  if (end === "right")
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
}

const truncate = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s;
