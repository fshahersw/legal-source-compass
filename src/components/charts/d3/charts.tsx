/**
 * d3 chart forms: d3 modules do the maths, React renders, colours come only from chart tokens. Each chart measures
 * its own width so text stays at its real size (no viewBox shrinking). Wrap each in a ChartCard for title, unit,
 * period, source and the "View data" table.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { scaleBand, scaleLinear, scalePoint } from "d3-scale";
import { arc as d3arc, line as d3line } from "d3-shape";
import {
  divergingDomain,
  rebase,
  spreadLabels,
  stackLayers,
  sunburstLayout,
  type Series,
  type StackRow,
  type TreeNode,
} from "./maths";
import { chartTokens, seriesVar } from "../palette";

const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`;
const TICK = "fill-muted-foreground text-[11px] tabular-nums";

/** Width of the element in CSS pixels, following resizes; `fallback` until the first measurement. */
export function useWidth<T extends Element>(fallback = 640): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setW(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Clip a label to `max` characters with an ellipsis (full text stays in the <title>). */
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…` : s);

// ------------------------------------------------------------------------------------------------ index chart

export function IndexChart({
  series,
  height = 280,
  formatDate = (d: string) => d,
  labelWidth = 150,
  initialIndex = 0,
}: {
  series: readonly Series[];
  height?: number;
  formatDate?: (d: string) => string;
  /** Period the comparison starts at (index into the dates). */
  initialIndex?: number;
  /** Room at the right for the end-of-line labels (CSS px). */
  labelWidth?: number;
}) {
  const [box, W] = useWidth<HTMLDivElement>();
  const dates = series[0]?.points.map((p) => p.date) ?? [];
  const [baseIdx, setBaseIdx] = useState(initialIndex);
  const base = dates[Math.min(baseIdx, Math.max(0, dates.length - 1))] ?? "";
  const data = useMemo(() => rebase(series.slice(0, 6), base), [series, base]);
  const vals = data.flatMap((s) => s.points.map((p) => p.value)).filter((v): v is number => v != null);
  const narrow = W < 400;
  const gutter = narrow ? Math.min(labelWidth, 92) : labelWidth;
  const right = Math.max(120, W - gutter);
  const x = scalePoint<string>().domain(dates).range([44, right]);
  const y = scaleLinear()
    .domain([Math.min(0, ...vals), Math.max(0, ...vals)])
    .nice()
    .range([height - 30, 12]);
  const ln = d3line<{ date: string; value: number | null }>()
    .defined((p) => p.value != null)
    .x((p) => x(p.date) ?? 0)
    .y((p) => y(p.value ?? 0));
  const ends = data.map((s) => [...s.points].reverse().find((p) => p.value != null) ?? null);
  const labelY = spreadLabels(
    ends.map((e) => (e ? y(e.value!) : height - 30)),
    14,
    12,
    height - 30,
  );
  const chars = Math.max(6, Math.floor((gutter - 10) / 6.2));
  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const px = clientX - r.left;
    let best = 0;
    dates.forEach((d, i) => {
      if (Math.abs((x(d) ?? 0) - px) < Math.abs((x(dates[best]!) ?? 0) - px)) best = i;
    });
    if (best !== baseIdx) setBaseIdx(best);
  };
  const bx = x(base) ?? 44;
  const near = (v: number) => Math.abs(bx - v) < 70;
  return (
    <div ref={box} className="min-w-0">
      {dates.length >= 2 && data.length ? (
        <>
          <svg
            style={chartTokens}
            width={W}
            height={height}
            className="block touch-pan-y"
            role="img"
            aria-label={`Change in each series since ${formatDate(base)}`}
            onMouseMove={(e) => pick(e.clientX, e.currentTarget)}
            onTouchMove={(e) => e.touches[0] && pick(e.touches[0].clientX, e.currentTarget)}
          >
            {y.ticks(5).map((t) => (
              <g key={t}>
                <line
                  x1={44}
                  x2={right}
                  y1={y(t)}
                  y2={y(t)}
                  style={{ stroke: t === 0 ? "var(--chart-axis)" : "var(--chart-grid)" }}
                  strokeDasharray={t === 0 ? undefined : "2 3"}
                />
                <text x={38} y={y(t)} dy="0.32em" textAnchor="end" className={TICK}>
                  {pct(t)}
                </text>
              </g>
            ))}
            {near(44) ? null : (
              <text x={44} y={height - 10} className={TICK}>
                {formatDate(dates[0]!)}
              </text>
            )}
            {near(right) ? null : (
              <text x={right} y={height - 10} textAnchor="end" className={TICK}>
                {formatDate(dates[dates.length - 1]!)}
              </text>
            )}
            <line x1={bx} x2={bx} y1={12} y2={height - 30} style={{ stroke: "var(--chart-ink)" }} opacity={0.45} />
            <rect x={bx - 32} y={height - 23} width={64} height={18} rx={4} style={{ fill: "var(--chart-ink)" }} />
            <text x={bx} y={height - 10} textAnchor="middle" style={{ fill: "var(--chart-surface)" }} className="text-[11px] font-medium">
              {formatDate(base)}
            </text>
            {data.map((s, i) => {
              const last = ends[i];
              const label = last ? `${pct(last.value!)} ${s.label}` : `${s.label}: not recorded`;
              return (
                <g key={s.id}>
                  <path d={ln(s.points as never) ?? ""} fill="none" style={{ stroke: seriesVar(i) }} strokeWidth={2} />
                  <text
                    x={right + 6}
                    y={labelY[i]}
                    dy="0.32em"
                    style={last ? { fill: seriesVar(i) } : undefined}
                    className={last ? "text-[11px] font-medium" : "fill-muted-foreground text-[11px] italic"}
                  >
                    <title>{label}</title>
                    {clip(label, chars)}
                  </text>
                </g>
              );
            })}
          </svg>
          <label className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="shrink-0">Compare with</span>
            <input
              type="range"
              min={0}
              max={dates.length - 1}
              value={Math.min(baseIdx, dates.length - 1)}
              onChange={(e) => setBaseIdx(Number(e.target.value))}
              className="w-full accent-brand"
              aria-valuetext={formatDate(base)}
            />
            <span className="w-20 shrink-0 text-right font-medium text-foreground tabular-nums">{formatDate(base)}</span>
          </label>
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ stacked bars

export function StackedBarsOverTime({
  rows,
  keys,
  labels,
  height = 260,
  format = (v: number) => v.toLocaleString("en-US"),
}: {
  rows: readonly StackRow[];
  keys: readonly string[];
  labels?: Record<string, string>;
  height?: number;
  format?: (v: number) => string;
}) {
  const [box, W] = useWidth<HTMLDivElement>();
  const shown = keys.slice(0, 6);
  const { layers, max } = stackLayers(rows, shown);
  const x = scaleBand<string>().domain(rows.map((r) => r.period)).range([52, W - 4]).padding(0.22);
  const y = scaleLinear().domain([0, max || 1]).nice().range([height - 26, 10]);
  const every = Math.max(1, Math.ceil((rows.length * 44) / Math.max(1, W - 56)));
  return (
    <figure ref={box} className="m-0 min-w-0">
      <svg style={chartTokens} width={W} height={height} className="block" role="img" aria-label="Stacked totals by period">
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line x1={52} x2={W - 4} y1={y(t)} y2={y(t)} style={{ stroke: "var(--chart-grid)" }} />
            <text x={46} y={y(t)} dy="0.32em" textAnchor="end" className={TICK}>
              {format(t)}
            </text>
          </g>
        ))}
        {layers.map((l, i) =>
          l.map((d, j) => (
            <rect
              key={`${i}-${j}`}
              x={x(rows[j]!.period)}
              width={x.bandwidth()}
              y={y(d[1])}
              height={Math.max(0, y(d[0]) - y(d[1]))}
              style={{ fill: seriesVar(i) }}
            >
              <title>{`${rows[j]!.period} · ${labels?.[l.key] ?? l.key}: ${
                rows[j]!.values[l.key] == null ? "Not recorded" : format(d[1] - d[0])
              }`}</title>
            </rect>
          )),
        )}
        {rows.map((r, j) =>
          j % every === 0 || j === rows.length - 1 ? (
            <text
              key={r.period}
              x={(x(r.period) ?? 0) + x.bandwidth() / 2}
              y={height - 8}
              textAnchor="middle"
              className={TICK}
            >
              {r.period}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption style={chartTokens} className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {shown.map((k, i) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: seriesVar(i) }} />
            {labels?.[k] ?? k}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------------------------------------ diverging dots

export function DivergingDots({
  items,
  baseline,
  baselineLabel,
  format = (v: number) => v.toLocaleString("en-US"),
  showBaselineValue = true,
  labelWidth = 180,
}: {
  items: readonly { label: string; value: number | null }[];
  baseline: number;
  baselineLabel: string;
  format?: (v: number) => string;
  showBaselineValue?: boolean;
  /** Left gutter for the row labels (CSS px). */
  labelWidth?: number;
}) {
  const [box, W] = useWidth<HTMLDivElement>();
  const row = 26;
  const height = items.length * row + 30;
  const gutter = W < 400 ? Math.min(labelWidth, 120) : labelWidth;
  const x = scaleLinear()
    .domain(divergingDomain(items.map((i) => i.value), baseline))
    .range([gutter + 44, W - 52]);
  const chars = Math.max(8, Math.floor((gutter - 8) / 6.4));
  return (
    <div ref={box} className="min-w-0">
      <svg style={chartTokens} width={W} height={height} className="block" role="img" aria-label={`Values against ${baselineLabel}`}>
        <line x1={x(baseline)} x2={x(baseline)} y1={18} y2={height - 4} style={{ stroke: "var(--chart-axis)" }} />
        <text x={x(baseline)} y={11} textAnchor="middle" className={TICK}>
          {baselineLabel}
          {showBaselineValue ? ` ${format(baseline)}` : ""}
        </text>
        {items.map((it, i) => {
          const cy = 26 + i * row + row / 2;
          const up = it.value != null && it.value >= baseline;
          return (
            <g key={`${it.label}-${i}`}>
              {i % 2 === 0 ? (
                <rect x={0} y={cy - row / 2} width={W} height={row} style={{ fill: "var(--chart-mid)" }} opacity={0.35} />
              ) : null}
              <text x={gutter} y={cy} dy="0.32em" textAnchor="end" className="fill-foreground text-xs">
                <title>{it.label}</title>
                {clip(it.label, chars)}
              </text>
              {it.value == null ? (
                <text x={x(baseline) + 8} y={cy} dy="0.32em" className="fill-muted-foreground text-[11px] italic">
                  Not recorded
                </text>
              ) : (
                <>
                  <line
                    x1={x(baseline)}
                    x2={x(it.value)}
                    y1={cy}
                    y2={cy}
                    style={{ stroke: seriesVar(up ? 0 : 1) }}
                    strokeOpacity={0.35}
                    strokeWidth={3}
                  />
                  <circle cx={x(it.value)} cy={cy} r={5.5} style={{ fill: seriesVar(up ? 0 : 1) }} />
                  <text
                    x={x(it.value) + (up ? 10 : -10)}
                    y={cy}
                    dy="0.32em"
                    textAnchor={up ? "start" : "end"}
                    className="fill-foreground text-[11px] font-medium tabular-nums"
                  >
                    {format(it.value)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ sunburst

export function Sunburst({ root, size = 360 }: { root: TreeNode; size?: number }) {
  const r = size / 2;
  const nodes = useMemo(() => sunburstLayout(root, r), [root, r]);
  const [focus, setFocus] = useState<string | null>(null);
  const a = d3arc<{ x0: number; x1: number; y0: number; y1: number }>()
    .startAngle((d) => d.x0)
    .endAngle((d) => d.x1)
    .innerRadius((d) => d.y0)
    .outerRadius((d) => d.y1 - 1)
    .padAngle(0.004);
  const top = (n: (typeof nodes)[number]) => n.ancestors().reverse()[1];
  const tops = nodes.filter((n) => n.depth === 1);
  const total = nodes[0]?.value ?? 0;
  const shown = focus ? nodes.find((n) => n.data.name === focus && n.depth === 1) : undefined;
  return (
    <svg
      style={chartTokens}
      viewBox={`${-r} ${-r} ${size} ${size}`}
      className="mx-auto block w-full max-w-sm"
      role="img"
      aria-label={`Breakdown of ${root.name}`}
    >
      {nodes
        .filter((n) => n.depth > 0)
        .map((n, i) => {
          const t = top(n);
          const slot = Math.min(5, Math.max(0, tops.indexOf(t!)));
          return (
            <path
              key={i}
              d={a(n) ?? ""}
              style={{ fill: seriesVar(slot) }}
              opacity={focus && t?.data.name !== focus ? 0.25 : 1 - (n.depth - 1) * 0.22}
              onMouseEnter={() => setFocus(t?.data.name ?? null)}
              onMouseLeave={() => setFocus(null)}
            >
              <title>{`${n
                .ancestors()
                .reverse()
                .slice(1)
                .map((x) => x.data.name)
                .join(" › ")}: ${(n.value ?? 0).toLocaleString("en-US")}`}</title>
            </path>
          );
        })}
      <text textAnchor="middle" dy="-0.2em" className="fill-foreground text-sm font-semibold">
        {(shown?.value ?? total).toLocaleString("en-US")}
      </text>
      <text textAnchor="middle" dy="1.2em" className="fill-muted-foreground text-[10px]">
        {shown?.data.name ?? root.name}
      </text>
    </svg>
  );
}

