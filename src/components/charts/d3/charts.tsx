/** d3 chart forms (maths via d3 modules, rendering via React, colours via chart tokens only). Wrap each in ChartFrame
 * for title, unit, period, source and table view. */
import { useMemo, useState } from "react";
import { scaleBand, scaleLinear, scalePoint } from "d3-scale";
import { arc as d3arc, line as d3line } from "d3-shape";
import { divergingDomain, rebase, stackLayers, sunburstLayout, type Series, type StackRow, type TreeNode } from "./maths";
import { chartTokens, seriesVar } from "../palette";

const W = 640;
const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`;

export function IndexChart({ series, height = 280 }: { series: readonly Series[]; height?: number }) {
  const dates = series[0]?.points.map((p) => p.date) ?? [];
  const [base, setBase] = useState(dates[0] ?? "");
  const data = useMemo(() => rebase(series.slice(0, 6), base), [series, base]);
  const vals = data.flatMap((s) => s.points.map((p) => p.value)).filter((v): v is number => v != null);
  const x = scalePoint<string>().domain(dates).range([40, W - 90]);
  const y = scaleLinear().domain([Math.min(0, ...vals), Math.max(0, ...vals)]).nice().range([height - 24, 12]);
  const ln = d3line<{ date: string; value: number | null }>()
    .defined((p) => p.value != null)
    .x((p) => x(p.date) ?? 0)
    .y((p) => y(p.value ?? 0));
  return (
    <svg style={chartTokens} viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={`Change since ${base}`}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * W;
        const near = dates.reduce((a, d) => (Math.abs((x(d) ?? 0) - px) < Math.abs((x(a) ?? 0) - px) ? d : a), base);
        if (near !== base) setBase(near);
      }}>
      {y.ticks(5).map((t) => (
        <g key={t}>
          <line x1={40} x2={W - 90} y1={y(t)} y2={y(t)} style={{ stroke: "var(--border)" }} strokeDasharray={t === 0 ? undefined : "2 3"} />
          <text x={34} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px]">{pct(t)}</text>
        </g>
      ))}
      <line x1={x(base)} x2={x(base)} y1={12} y2={height - 24} style={{ stroke: "var(--foreground)" }} opacity={0.4} />
      <text x={x(base)} y={height - 8} textAnchor="middle" className="fill-foreground text-[10px] font-medium">{base}</text>
      {data.map((s, i) => {
        const last = [...s.points].reverse().find((p) => p.value != null);
        return (
          <g key={s.id}>
            <path d={ln(s.points as never) ?? ""} fill="none" style={{ stroke: seriesVar(i) }} strokeWidth={2} />
            {last && <text x={(x(last.date) ?? 0) + 6} y={y(last.value!)} dy="0.32em" style={{ fill: seriesVar(i) }} className="text-[10px] font-medium">{s.label} {pct(last.value!)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function StackedBarsOverTime({ rows, keys, labels, height = 260 }: { rows: readonly StackRow[]; keys: readonly string[]; labels?: Record<string, string>; height?: number }) {
  const { layers, max } = stackLayers(rows, keys.slice(0, 6));
  const x = scaleBand<string>().domain(rows.map((r) => r.period)).range([40, W - 10]).padding(0.2);
  const y = scaleLinear().domain([0, max || 1]).nice().range([height - 40, 10]);
  return (
    <figure>
      <svg style={chartTokens} viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Stacked totals by period">
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line x1={40} x2={W - 10} y1={y(t)} y2={y(t)} style={{ stroke: "var(--border)" }} />
            <text x={34} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px]">{t.toLocaleString()}</text>
          </g>
        ))}
        {layers.map((l, i) => l.map((d, j) => (
          <rect key={`${i}-${j}`} x={x(rows[j]!.period)} width={x.bandwidth()} y={y(d[1])} height={Math.max(0, y(d[0]) - y(d[1]))} style={{ fill: seriesVar(i) }} rx={1}>
            <title>{`${rows[j]!.period} · ${labels?.[l.key] ?? l.key}: ${rows[j]!.values[l.key] == null ? "Not recorded" : (d[1] - d[0]).toLocaleString()}`}</title>
          </rect>
        )))}
        {rows.map((r) => <text key={r.period} x={(x(r.period) ?? 0) + x.bandwidth() / 2} y={height - 24} textAnchor="middle" className="fill-muted-foreground text-[10px]">{r.period}</text>)}
      </svg>
      <figcaption style={chartTokens} className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {keys.slice(0, 6).map((k, i) => <span key={k} className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: seriesVar(i) }} />{labels?.[k] ?? k}</span>)}
      </figcaption>
    </figure>
  );
}

export function DivergingDots({ items, baseline, baselineLabel, format = (v: number) => v.toLocaleString() }: { items: readonly { label: string; value: number | null }[]; baseline: number; baselineLabel: string; format?: (v: number) => string }) {
  const row = 22;
  const height = items.length * row + 30;
  const x = scaleLinear().domain(divergingDomain(items.map((i) => i.value), baseline)).range([170, W - 50]);
  return (
    <svg style={chartTokens} viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={`Values against ${baselineLabel}`}>
      <line x1={x(baseline)} x2={x(baseline)} y1={14} y2={height - 6} style={{ stroke: "var(--foreground)" }} opacity={0.5} />
      <text x={x(baseline)} y={10} textAnchor="middle" className="fill-muted-foreground text-[10px]">{baselineLabel} {format(baseline)}</text>
      {items.map((it, i) => {
        const cy = 24 + i * row + row / 2;
        return (
          <g key={it.label}>
            <text x={164} y={cy} dy="0.32em" textAnchor="end" className="fill-foreground text-[11px]">{it.label}</text>
            {it.value == null ? (
              <text x={x(baseline) + 6} y={cy} dy="0.32em" className="fill-muted-foreground text-[10px] italic">Not recorded</text>
            ) : (
              <>
                <line x1={x(baseline)} x2={x(it.value)} y1={cy} y2={cy} style={{ stroke: "var(--border)" }} strokeWidth={2} />
                <circle cx={x(it.value)} cy={cy} r={5} style={{ fill: seriesVar(it.value >= baseline ? 0 : 1) }} />
                <text x={x(it.value) + (it.value >= baseline ? 9 : -9)} y={cy} dy="0.32em" textAnchor={it.value >= baseline ? "start" : "end"} className="fill-muted-foreground text-[10px]">{format(it.value)}</text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function Sunburst({ root, size = 360 }: { root: TreeNode; size?: number }) {
  const r = size / 2;
  const nodes = useMemo(() => sunburstLayout(root, r), [root, r]);
  const [focus, setFocus] = useState<string | null>(null);
  const a = d3arc<{ x0: number; x1: number; y0: number; y1: number }>()
    .startAngle((d) => d.x0).endAngle((d) => d.x1).innerRadius((d) => d.y0).outerRadius((d) => d.y1 - 1).padAngle(0.004);
  const top = (n: (typeof nodes)[number]) => n.ancestors().reverse()[1];
  const tops = nodes.filter((n) => n.depth === 1);
  const total = nodes[0]?.value ?? 0;
  const shown = focus ? nodes.find((n) => n.data.name === focus && n.depth === 1) : undefined;
  return (
    <svg style={chartTokens} viewBox={`${-r} ${-r} ${size} ${size}`} className="mx-auto w-full max-w-sm" role="img" aria-label={`Breakdown of ${root.name}`}>
      {nodes.filter((n) => n.depth > 0).map((n, i) => {
        const t = top(n);
        const slot = Math.min(5, tops.indexOf(t!));
        return (
          <path key={i} d={a(n) ?? ""} style={{ fill: seriesVar(slot < 0 ? 0 : slot) }} opacity={focus && t?.data.name !== focus ? 0.25 : 1 - (n.depth - 1) * 0.22}
            onMouseEnter={() => setFocus(t?.data.name ?? null)} onMouseLeave={() => setFocus(null)}>
            <title>{`${n.ancestors().reverse().slice(1).map((x) => x.data.name).join(" › ")}: ${(n.value ?? 0).toLocaleString()}`}</title>
          </path>
        );
      })}
      <text textAnchor="middle" dy="-0.2em" className="fill-foreground text-sm font-semibold">{(shown?.value ?? total).toLocaleString()}</text>
      <text textAnchor="middle" dy="1.2em" className="fill-muted-foreground text-[10px]">{shown?.data.name ?? root.name}</text>
    </svg>
  );
}
