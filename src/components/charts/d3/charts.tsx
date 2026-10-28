/**
 * d3 chart forms: d3 modules do the maths, React renders, colours come only from chart tokens. Each chart measures
 * its own width so text stays at its real size (no viewBox shrinking). Wrap each in a ChartCard for title, unit,
 * period, source and the "View data" table.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { scaleBand, scaleLinear, scalePoint } from "d3-scale";
import { arc as d3arc, line as d3line } from "d3-shape";
import {
  divergingDomain,
  fitLabel,
  rebase,
  ringLabelFits,
  ringVisible,
  spreadLabels,
  stackLayers,
  sunburstLayout,
  zoomArc,
  type RingArc,
  type Series,
  type StackRow,
  type TreeNode,
} from "./maths";
import { chartTokens, seriesVar } from "../palette";

const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`;
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
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
const clip = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…` : s;

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
  const vals = data
    .flatMap((s) => s.points.map((p) => p.value))
    .filter((v): v is number => v != null);
  const narrow = W < 400;
  const gutter = narrow ? Math.min(labelWidth, 92) : labelWidth;
  const right = Math.max(120, W - gutter);
  const x = scalePoint<string>().domain(dates).range([56, right]);
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
  const bx = x(base) ?? 56;
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
                  x1={56}
                  x2={right}
                  y1={y(t)}
                  y2={y(t)}
                  style={{ stroke: t === 0 ? "var(--chart-axis)" : "var(--chart-grid)" }}
                  strokeDasharray={t === 0 ? undefined : "2 3"}
                />
                <text x={50} y={y(t)} dy="0.32em" textAnchor="end" className={TICK}>
                  {pct(t)}
                </text>
              </g>
            ))}
            {near(56) ? null : (
              <text x={56} y={height - 10} className={TICK}>
                {formatDate(dates[0]!)}
              </text>
            )}
            {near(right) ? null : (
              <text x={right} y={height - 10} textAnchor="end" className={TICK}>
                {formatDate(dates[dates.length - 1]!)}
              </text>
            )}
            <line
              x1={bx}
              x2={bx}
              y1={12}
              y2={height - 30}
              style={{ stroke: "var(--chart-ink)" }}
              opacity={0.45}
            />
            <rect
              x={bx - 32}
              y={height - 23}
              width={64}
              height={18}
              rx={4}
              style={{ fill: "var(--chart-ink)" }}
            />
            <text
              x={bx}
              y={height - 10}
              textAnchor="middle"
              style={{ fill: "var(--chart-surface)" }}
              className="text-[11px] font-medium"
            >
              {formatDate(base)}
            </text>
            {data.map((s, i) => {
              const last = ends[i];
              const label = last ? `${pct(last.value!)} ${s.label}` : `${s.label}: not recorded`;
              return (
                <g key={s.id}>
                  <path
                    d={ln(s.points as never) ?? ""}
                    fill="none"
                    style={{ stroke: seriesVar(i) }}
                    strokeWidth={2}
                  />
                  <text
                    x={right + 6}
                    y={labelY[i]}
                    dy="0.32em"
                    style={last ? { fill: seriesVar(i) } : undefined}
                    className={
                      last ? "text-[11px] font-medium" : "fill-muted-foreground text-[11px] italic"
                    }
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
            <span className="w-20 shrink-0 text-right font-medium text-foreground tabular-nums">
              {formatDate(base)}
            </span>
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
  fills,
}: {
  rows: readonly StackRow[];
  keys: readonly string[];
  labels?: Record<string, string>;
  height?: number;
  format?: (v: number) => string;
  /** Per-key fill (chart-token expressions), e.g. a sequential ramp for ordered size bands; default = series slots. */
  fills?: Record<string, string> | undefined;
}) {
  const [box, W] = useWidth<HTMLDivElement>();
  const shown = keys.slice(0, 6);
  const fillOf = (k: string, i: number) => fills?.[k] ?? seriesVar(i);
  const { layers, max } = stackLayers(rows, shown);
  const y = scaleLinear()
    .domain([0, max || 1])
    .nice()
    .range([height - 26, 10]);
  // Axis ticks in compact form for large totals (exact values stay in each bar's title and the table).
  const tickText = (v: number) => (max >= 10_000 ? COMPACT.format(v) : format(v));
  const ticks = y.ticks(4);
  const left = Math.max(36, Math.max(...ticks.map((t) => tickText(t).length)) * 6.6 + 12);
  const x = scaleBand<string>()
    .domain(rows.map((r) => r.period))
    .range([left, W - 14])
    .padding(0.22);
  const longest = Math.max(1, ...rows.map((r) => r.period.length + (r.partial ? 1 : 0)));
  const every = Math.max(
    1,
    Math.ceil((rows.length * (longest * 6.4 + 10)) / Math.max(1, W - left - 14)),
  );
  return (
    <figure ref={box} className="m-0 min-w-0">
      <svg
        style={chartTokens}
        width={W}
        height={height}
        className="block"
        role="img"
        aria-label="Stacked totals by period"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={left}
              x2={W - 4}
              y1={y(t)}
              y2={y(t)}
              style={{ stroke: "var(--chart-grid)" }}
            />
            <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" className={TICK}>
              {tickText(t)}
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
              style={{ fill: fillOf(l.key, i), opacity: rows[j]!.partial ? 0.4 : 1 }}
            >
              <title>{`${rows[j]!.period}${rows[j]!.partial ? " (unfinished)" : ""} · ${labels?.[l.key] ?? l.key}: ${
                rows[j]!.values[l.key] == null ? "Not recorded" : format(d[1] - d[0])
              }`}</title>
            </rect>
          )),
        )}
        {rows.map((r, j) =>
          // The last period is always labelled; a regular label too close to it is skipped.
          (j % every === 0 && rows.length - 1 - j >= every) || j === rows.length - 1 ? (
            <text
              key={r.period}
              x={(x(r.period) ?? 0) + x.bandwidth() / 2}
              y={height - 8}
              textAnchor="middle"
              className={TICK}
            >
              {r.period}
              {r.partial ? "*" : ""}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption
        style={chartTokens}
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      >
        {shown.map((k, i) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: fillOf(k, i) }} />
            {labels?.[k] ?? k}
          </span>
        ))}
        {rows.some((r) => r.partial) ? <span>* unfinished period, drawn faded</span> : null}
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
  onNavigate,
}: {
  /**
   * `href` makes the row label a link (client-side via `onNavigate`, a real href for open-in-new-tab); `note` is the
   * hover text of an unlinked label ("No court page recorded").
   */
  items: readonly { label: string; value: number | null; href?: string; note?: string }[];
  onNavigate?: (href: string) => void;
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
  const gutter = Math.min(labelWidth, Math.max(110, Math.round(W * 0.42)));
  const x = scaleLinear()
    .domain(
      divergingDomain(
        items.map((i) => i.value),
        baseline,
      ),
    )
    .range([gutter + 44, W - 52]);
  const chars = Math.max(8, Math.floor((gutter - 8) / 6.4));
  return (
    <div ref={box} className="min-w-0">
      <svg
        style={chartTokens}
        width={W}
        height={height}
        className="block"
        role="img"
        aria-label={`Values against ${baselineLabel}`}
      >
        <line
          x1={x(baseline)}
          x2={x(baseline)}
          y1={18}
          y2={height - 4}
          // The reference ink (foreground), dashed, so the baseline reads in both themes like other charts' references.
          style={{ stroke: "var(--chart-reference, var(--chart-axis))", strokeWidth: 1.25 }}
          strokeDasharray="4 3"
        />
        <text
          x={x(baseline)}
          y={11}
          textAnchor="middle"
          className="fill-foreground text-[11px] font-medium tabular-nums"
        >
          {baselineLabel}
          {showBaselineValue ? ` ${format(baseline)}` : ""}
        </text>
        {items.map((it, i) => {
          const cy = 26 + i * row + row / 2;
          const up = it.value != null && it.value >= baseline;
          return (
            <g key={`${it.label}-${i}`}>
              {i % 2 === 0 ? (
                <rect
                  x={0}
                  y={cy - row / 2}
                  width={W}
                  height={row}
                  style={{ fill: "var(--chart-mid)" }}
                  opacity={0.35}
                />
              ) : null}
              {it.href ? (
                <a
                  href={it.href}
                  aria-label={`${it.label}: open profile`}
                  onClick={(e) => {
                    if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                      return;
                    e.preventDefault();
                    onNavigate(it.href!);
                  }}
                  className="outline-none [&:focus-visible>text]:underline"
                >
                  <text
                    x={gutter}
                    y={cy}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-foreground text-xs underline decoration-muted-foreground/60 decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    <title>{it.label}</title>
                    {clip(it.label, chars)}
                  </text>
                </a>
              ) : (
                <text
                  x={gutter}
                  y={cy}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-foreground text-xs"
                >
                  <title>{it.note ? `${it.label} · ${it.note}` : it.label}</title>
                  {clip(it.label, chars)}
                </text>
              )}
              {it.value == null ? (
                <text
                  x={x(baseline) + 8}
                  y={cy}
                  dy="0.32em"
                  className="fill-muted-foreground text-[11px] italic"
                >
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
                  <circle
                    cx={x(it.value)}
                    cy={cy}
                    r={5.5}
                    style={{ fill: seriesVar(up ? 0 : 1) }}
                  />
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

/**
 * Zoomable sunburst (portfolio-composition form). Each top-level branch keeps its own categorical slot; deeper rings
 * are lighter tints of the parent hue, and "Not broken down" remainders take the neutral fill. Labels sit inside the
 * arcs along the radius and hide when a segment is too small. Click (or Enter on) a segment with children to zoom in,
 * the centre to zoom out. The centre shows the total of the zoomed node, or of the hovered segment, with its name.
 * Only exact partitions belong here (see charts AGENTS.md): values sum from the leaves.
 */
export function Sunburst({
  root,
  size = 360,
  focus: focusProp,
  onFocusChange,
  centerLabel,
}: {
  root: TreeNode;
  size?: number;
  /** Controlled focus: the top-level name to highlight. */
  focus?: string | null;
  onFocusChange?: (name: string | null) => void;
  centerLabel?: (value: number) => string;
}) {
  const [wrap, width] = useWidth<HTMLDivElement>(size);
  const px = Math.max(180, Math.min(size, width));
  const r = px / 2;
  const nodes = useMemo(() => {
    const laid = sunburstLayout(root, 1);
    const levels = (laid[0]?.height ?? 0) + 1;
    return laid.map((n) => ({
      node: n,
      key: n
        .ancestors()
        .reverse()
        .map((a) => a.data.name)
        .join("\u241f"),
      arc: { x0: n.x0, x1: n.x1, y0: n.y0 * levels, y1: n.y1 * levels } as RingArc,
    }));
  }, [root]);
  const height = nodes[0]?.node.height ?? 0;
  const rings = Math.max(1, Math.min(3, height));
  const ringR = r / (rings + 1.3);
  const centerR = ringR * 1.3;
  const rad = (y: number) => (y <= 1 ? Math.max(0, y) * centerR : centerR + (y - 1) * ringR);

  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const zoomed = nodes.find((n) => n.key === zoomKey) ?? nodes[0];
  const [view, setView] = useState<RingArc[]>(() => nodes.map((n) => n.arc));
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (!zoomed) return;
    const p = { ...zoomed.arc, depth: zoomed.node.depth };
    const to = nodes.map((n) => zoomArc(n.arc, p));
    const from = viewRef.current;
    const reduce =
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from.length !== to.length) {
      setView(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 550);
      const e = ease(t);
      setView(
        to.map((b, i) => {
          const f = from[i]!;
          return {
            x0: f.x0 + (b.x0 - f.x0) * e,
            x1: f.x1 + (b.x1 - f.x1) * e,
            y0: f.y0 + (b.y0 - f.y0) * e,
            y1: f.y1 + (b.y1 - f.y1) * e,
          };
        }),
      );
      if (t < 1) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [nodes, zoomed]);

  const [own, setOwn] = useState<string | null>(null);
  const focus = focusProp !== undefined ? focusProp : own;
  const setFocus = (name: string | null) => {
    setOwn(name);
    onFocusChange?.(name);
  };
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const tops = nodes.filter((n) => n.node.depth === 1);
  const topOf = (n: (typeof nodes)[number]) => {
    let a = n.node;
    while (a.depth > 1 && a.parent) a = a.parent;
    return a;
  };
  const slotOf = (n: (typeof nodes)[number]) => {
    const t = topOf(n);
    return (
      t.data.slot ??
      Math.min(
        5,
        Math.max(
          0,
          tops.findIndex((x) => x.node === t),
        ),
      )
    );
  };
  const fillOf = (n: (typeof nodes)[number]) => {
    if (/^not broken down$/i.test(n.node.data.name)) return "var(--chart-other)";
    const base = seriesVar(slotOf(n));
    const tint = Math.max(34, 100 - (n.node.depth - 1) * 26);
    return n.node.depth === 1 ? base : `color-mix(in srgb, ${base} ${tint}%, var(--chart-surface))`;
  };
  const arcPath = d3arc<RingArc>()
    .startAngle((d) => d.x0)
    .endAngle((d) => d.x1)
    .innerRadius((d) => rad(d.y0))
    .outerRadius((d) => Math.max(rad(d.y0), rad(d.y1)));
  const total = nodes[0]?.node.value ?? 0;
  const pathOf = (n: (typeof nodes)[number]) =>
    n.node
      .ancestors()
      .reverse()
      .slice(1)
      .map((x) => x.data.name)
      .join(" › ");
  const fmt = (v: number) => (centerLabel ? centerLabel(v) : v.toLocaleString("en-US"));
  const hovered = hoverKey ? nodes.find((n) => n.key === hoverKey) : undefined;
  const focused = !hovered && focus ? tops.find((n) => n.node.data.name === focus) : undefined;
  const shown = hovered ?? focused ?? zoomed;
  const shownValue = shown?.node.value ?? total;
  const shownName = shown && shown.node.depth > 0 ? shown.node.data.name : root.name;
  const valueText = fmt(shownValue);
  const valueSize = Math.round(
    Math.max(
      11,
      Math.min(Math.min(26, centerR * 0.36), (2 * centerR - 16) / (valueText.length * 0.58)),
    ),
  );
  const captionMax = Math.floor((2 * centerR - 18) / 5.6);
  const zoomable = height > 1;
  const zoomIn = (n: (typeof nodes)[number]) => {
    if (!n.node.children?.length) return;
    setHoverKey(null);
    setZoomKey(n.key);
  };
  const zoomOut = () => {
    if (!zoomed?.node.parent) return;
    setHoverKey(null);
    const parent = nodes.find((n) => n.node === zoomed.node.parent);
    setZoomKey(parent && parent.node.depth > 0 ? parent.key : null);
  };
  const share = (v: number) =>
    total > 0 ? `${((v / total) * 100).toFixed(1)}% of ${root.name}` : "";
  const labelChars = Math.floor((ringR - 8) / 5.4);
  const atRoot = !zoomed || zoomed.node.depth === 0;

  return (
    <div ref={wrap} className="w-full">
      <svg
        style={chartTokens}
        width={px}
        height={px}
        viewBox={`${-r} ${-r} ${px} ${px}`}
        className="mx-auto block max-w-full"
        role="group"
        aria-label={`Breakdown of ${root.name}${atRoot ? "" : `, zoomed to ${pathOf(zoomed!)}`}`}
      >
        <g>
          {nodes.map((n, i) => {
            if (n.node.depth === 0) return null;
            const a = view[i];
            if (!a || !ringVisible(a, rings)) return null;
            const t = topOf(n);
            const dim = focus && t.data.name !== focus && !hovered;
            const firstRing = n.node.depth === (zoomed?.node.depth ?? 0) + 1;
            const canZoom = !!n.node.children?.length && zoomable;
            const label = `${pathOf(n)}: ${(n.node.value ?? 0).toLocaleString("en-US")}`;
            return (
              <path
                key={n.key}
                d={arcPath(a) ?? ""}
                style={{
                  fill: fillOf(n),
                  stroke: "var(--chart-surface)",
                  cursor: canZoom ? "pointer" : "default",
                }}
                strokeWidth={1}
                opacity={dim ? 0.28 : 1}
                onMouseEnter={() => {
                  setHoverKey(n.key);
                  setFocus(t.data.name);
                }}
                onMouseLeave={() => {
                  setHoverKey(null);
                  setFocus(null);
                }}
                onClick={canZoom ? () => zoomIn(n) : undefined}
                {...(firstRing
                  ? {
                      tabIndex: 0,
                      role: canZoom ? "button" : "img",
                      "aria-label": canZoom ? `${label}. Zoom in` : label,
                      onFocus: () => {
                        setHoverKey(n.key);
                        setFocus(t.data.name);
                      },
                      onBlur: () => {
                        setHoverKey(null);
                        setFocus(null);
                      },
                      onKeyDown: (e: KeyboardEvent) => {
                        if (canZoom && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          zoomIn(n);
                        }
                      },
                      className:
                        "outline-none focus-visible:[stroke:var(--foreground)] focus-visible:[stroke-width:2.5]",
                    }
                  : { "aria-hidden": true })}
              >
                <title>{`${label}${share(n.node.value ?? 0) ? ` (${share(n.node.value ?? 0)})` : ""}${canZoom ? ". Click to zoom in" : ""}`}</title>
              </path>
            );
          })}
        </g>
        <g pointerEvents="none" textAnchor="middle">
          {nodes.map((n, i) => {
            if (n.node.depth === 0) return null;
            const a = view[i];
            if (!a || !ringLabelFits(a, rings, rad)) return null;
            const text = fitLabel(n.node.data.name, labelChars);
            if (!text) return null;
            const deg = (((a.x0 + a.x1) / 2) * 180) / Math.PI;
            const y = (rad(a.y0) + rad(a.y1)) / 2;
            const t = topOf(n);
            const dim = focus && t.data.name !== focus && !hovered;
            return (
              <text
                key={n.key}
                dy="0.35em"
                transform={`rotate(${deg - 90}) translate(${y},0) rotate(${deg < 180 ? 0 : 180})`}
                className="text-[10px]"
                style={{
                  fill: "var(--chart-ink)",
                  stroke: "var(--chart-surface)",
                  strokeWidth: 2.6,
                  paintOrder: "stroke",
                  strokeLinejoin: "round",
                }}
                opacity={dim ? 0.3 : 1}
              >
                {text}
              </text>
            );
          })}
        </g>
        <g
          onClick={atRoot ? undefined : zoomOut}
          style={{ cursor: atRoot ? "default" : "pointer" }}
          {...(atRoot
            ? {}
            : {
                role: "button",
                tabIndex: 0,
                "aria-label": `Zoom out from ${zoomed!.node.data.name}`,
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
                    e.preventDefault();
                    zoomOut();
                  }
                },
                className: "outline-none [&:focus-visible>circle]:[stroke:var(--foreground)]",
              })}
        >
          <circle r={centerR - 3} style={{ fill: "var(--chart-mid)" }} strokeWidth={2} />
          <text
            textAnchor="middle"
            dy={-centerR * 0.06}
            className="fill-foreground font-semibold tabular-nums"
            style={{ fontSize: valueSize }}
          >
            {valueText}
          </text>
          <text
            textAnchor="middle"
            dy={valueSize * 0.55 + 6}
            className="fill-muted-foreground text-[10.5px]"
          >
            {fitLabel(shownName, captionMax) ?? ""}
          </text>
          {!atRoot ? (
            <text
              textAnchor="middle"
              dy={valueSize * 0.55 + 20}
              className="fill-primary text-[10px] font-medium"
            >
              ↑ Zoom out
            </text>
          ) : null}
        </g>
      </svg>
      {zoomable ? (
        <p className="m-0 mt-1 text-center text-[11px] text-muted-foreground">
          Click a segment to zoom in, the centre to zoom out.
        </p>
      ) : null}
    </div>
  );
}
