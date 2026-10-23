/**
 * Slope chart (value in two periods) and bump chart (rank across periods). Every entity is a thin grey line; the
 * entities that moved most (or the one selected) are drawn in the diverging pair, blue for a rise and orange for a fall,
 * and labelled at both ends. Entities missing a value in a period are left out of that segment, never drawn at zero.
 */
import { useMemo, useState } from "react";
import { ChartCanvas, axisText, localPoint, textWidth, type TipSpec } from "./canvas";
import type { ValueFormatter } from "./format";
import { dodgeLabels, linearScale, niceDomain, pointPositions } from "./scale";

export type SlopeItem = {
  id: string;
  label: string;
  /** Value per period key; null or missing = not recorded. */
  values: Readonly<Record<string, number | null>>;
};

/** Competition ranks (1 = highest value) of the items that record a value in `period`. */
export function ranksIn(items: readonly SlopeItem[], period: string): Map<string, number> {
  const rows = items
    .flatMap((i) => {
      const v = i.values[period];
      return typeof v === "number" && Number.isFinite(v) ? [{ id: i.id, v }] : [];
    })
    .sort((a, b) => b.v - a.v);
  const out = new Map<string, number>();
  rows.forEach((r, k) => {
    const prev = rows[k - 1];
    out.set(r.id, prev && prev.v === r.v ? out.get(prev.id)! : k + 1);
  });
  return out;
}

/** The `n` entities with the largest absolute change between two periods (both recorded), largest first. */
export function topMovers(
  items: readonly SlopeItem[],
  from: string,
  to: string,
  n: number,
  measure: "value" | "rank" = "value",
): string[] {
  const rf = measure === "rank" ? ranksIn(items, from) : null;
  const rt = measure === "rank" ? ranksIn(items, to) : null;
  return items
    .flatMap((i) => {
      const a = rf ? rf.get(i.id) : i.values[from];
      const b = rt ? rt.get(i.id) : i.values[to];
      return typeof a === "number" && typeof b === "number"
        ? [{ id: i.id, d: Math.abs(b - a) }]
        : [];
    })
    .sort((x, y) => y.d - x.d || x.id.localeCompare(y.id))
    .slice(0, n)
    .map((x) => x.id);
}

export function SlopeChart({
  items,
  periods,
  periodLabel,
  formatter,
  unit,
  ariaLabel,
  mode = "slope",
  emphasize = 5,
  selected = null,
  height = 320,
  width,
}: {
  items: readonly SlopeItem[];
  /** Two periods for a slope chart; two or more for a bump chart. */
  periods: readonly string[];
  periodLabel: (p: string) => string;
  formatter: ValueFormatter;
  unit?: string | undefined;
  ariaLabel: string;
  mode?: "slope" | "bump";
  /** How many of the largest movers to emphasise. */
  emphasize?: number;
  selected?: string | null;
  height?: number;
  width?: number | undefined;
}) {
  const [active, setActive] = useState<number | null>(null);
  const first = periods[0] ?? "";
  const last = periods[periods.length - 1] ?? "";
  const ranks = useMemo(() => periods.map((p) => ranksIn(items, p)), [items, periods]);
  const movers = useMemo(
    () => new Set(topMovers(items, first, last, emphasize, mode === "bump" ? "rank" : "value")),
    [items, first, last, emphasize, mode],
  );
  const ordered = useMemo(
    () =>
      [...items].sort((a, b) => {
        const ea = a.id === selected || movers.has(a.id) ? 1 : 0;
        const eb = b.id === selected || movers.has(b.id) ? 1 : 0;
        return ea - eb || a.label.localeCompare(b.label);
      }),
    [items, movers, selected],
  );
  const valueAt = (item: SlopeItem, pi: number): number | null => {
    if (mode === "bump") return ranks[pi]!.get(item.id) ?? null;
    const v = item.values[periods[pi]!];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const allValues = ordered.flatMap((it) =>
    periods.map((_, pi) => valueAt(it, pi)).filter((v): v is number => v !== null),
  );
  const nd = niceDomain(allValues, { zero: mode === "slope", count: 4 });
  const maxRank = Math.max(1, ...ranks.map((r) => r.size));
  const describe = (i: number) => {
    const it = ordered[i]!;
    const parts = periods.map((p, pi) => {
      const v = valueAt(it, pi);
      return `${periodLabel(p)}: ${v === null ? "Not recorded" : mode === "bump" ? `rank ${v}` : formatter.full(v)}`;
    });
    return `${it.label}. ${parts.join("; ")}.`;
  };
  const emphasized = (it: SlopeItem) => it.id === selected || movers.has(it.id);
  const labelW = Math.min(
    130,
    Math.max(50, ...ordered.filter(emphasized).map((it) => textWidth(it.label, 10.5) + 40)),
  );
  return (
    <ChartCanvas
      width={width}
      height={height}
      ariaLabel={ariaLabel}
      count={ordered.length}
      active={active}
      onActive={setActive}
      describe={describe}
      orientation="vertical"
    >
      {(w) => {
        const xs = pointPositions(periods.length, [labelW, w - labelW]).map((x, i, arr) =>
          arr.length === 2 ? (i === 0 ? labelW + 20 : w - labelW - 20) : x,
        );
        const y =
          mode === "bump"
            ? linearScale([1, maxRank], [26, height - 10])
            : linearScale(nd.domain, [height - 10, 26]);
        const lineColor = (it: SlopeItem) => {
          if (!emphasized(it)) return "var(--chart-muted-mark)";
          const a = valueAt(it, 0);
          const b = valueAt(it, periods.length - 1);
          if (a === null || b === null) return "var(--chart-axis)";
          const rose = mode === "bump" ? b < a : b > a;
          return b === a ? "var(--chart-axis)" : rose ? "var(--chart-1)" : "var(--chart-2)";
        };
        const emph = ordered.filter(emphasized);
        const leftY = dodgeLabels(
          emph.map((it) => {
            const v = valueAt(it, 0);
            return v === null ? -100 : y(v);
          }),
          12,
          26,
          height - 10,
        );
        const rightY = dodgeLabels(
          emph.map((it) => {
            const v = valueAt(it, periods.length - 1);
            return v === null ? -100 : y(v);
          }),
          12,
          26,
          height - 10,
        );
        const nearest = (px: number, py: number) => {
          let best: number | null = null;
          let bestD = 18;
          ordered.forEach((it, i) => {
            periods.forEach((_, pi) => {
              const v = valueAt(it, pi);
              if (v === null) return;
              const d = Math.hypot(xs[pi]! - px, y(v) - py);
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            });
          });
          return best;
        };
        const marks = (
          <>
            {periods.map((p, pi) => (
              <g key={p}>
                <line x1={xs[pi]} x2={xs[pi]} y1={20} y2={height - 6} stroke="var(--chart-grid)" />
                <text
                  x={xs[pi]}
                  y={11}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--chart-ink)"
                >
                  {periodLabel(p)}
                </text>
              </g>
            ))}
            {ordered.map((it, i) => {
              const c = lineColor(it);
              const strong = emphasized(it) || active === i;
              const pts = periods.map((_, pi) => valueAt(it, pi));
              const segs: string[] = [];
              for (let pi = 0; pi + 1 < periods.length; pi++) {
                const a = pts[pi];
                const b = pts[pi + 1];
                if (a === null || a === undefined || b === null || b === undefined) continue;
                segs.push(`M${xs[pi]},${y(a)}L${xs[pi + 1]},${y(b)}`);
              }
              return (
                <g key={it.id} opacity={active !== null && active !== i && !strong ? 0.5 : 1}>
                  <path
                    d={segs.join("")}
                    fill="none"
                    stroke={active === i ? "var(--chart-ink)" : c}
                    strokeWidth={strong ? 2 : 1}
                    strokeLinecap="round"
                  />
                  {pts.map((v, pi) =>
                    v === null || v === undefined ? null : (
                      <circle
                        key={pi}
                        cx={xs[pi]}
                        cy={y(v)}
                        r={strong ? 3.5 : 2}
                        fill={active === i ? "var(--chart-ink)" : c}
                        stroke="var(--chart-surface)"
                        strokeWidth={strong ? 1.5 : 0.5}
                      />
                    ),
                  )}
                </g>
              );
            })}
            {emph.map((it, k) => {
              const a = valueAt(it, 0);
              const b = valueAt(it, periods.length - 1);
              return (
                <g key={`lab-${it.id}`} fontSize={10.5} fill="var(--chart-ink)">
                  {a !== null ? (
                    <text x={xs[0]! - 8} y={leftY[k]} dy="0.32em" textAnchor="end">
                      {`${truncate(it.label, 14)} ${mode === "bump" ? `#${a}` : formatter.tick(a)}`}
                    </text>
                  ) : null}
                  {b !== null ? (
                    <text x={xs[periods.length - 1]! + 8} y={rightY[k]} dy="0.32em">
                      {`${mode === "bump" ? `#${b}` : formatter.tick(b)} ${truncate(it.label, 14)}`}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <rect
              x={0}
              y={0}
              width={w}
              height={height}
              fill="transparent"
              onPointerMove={(e) => {
                const p = localPoint(e);
                setActive(nearest(p.x, p.y));
              }}
              onPointerLeave={() => setActive(null)}
            />
          </>
        );
        const it = active !== null ? ordered[active] : undefined;
        const tooltip: TipSpec | null = it
          ? {
              x: xs[periods.length - 1]! - 60,
              y: (() => {
                const v = valueAt(it, periods.length - 1) ?? valueAt(it, 0);
                return v === null ? 30 : y(v);
              })(),
              content: {
                title: it.label,
                rows: periods.map((p, pi) => {
                  const v = valueAt(it, pi);
                  const raw = it.values[p];
                  return {
                    key: p,
                    label: periodLabel(p),
                    value:
                      v === null
                        ? "Not recorded"
                        : mode === "bump"
                          ? `#${v} (${formatter.full(typeof raw === "number" ? raw : null)})`
                          : formatter.full(v),
                  };
                }),
                footer: unit,
              },
            }
          : null;
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
