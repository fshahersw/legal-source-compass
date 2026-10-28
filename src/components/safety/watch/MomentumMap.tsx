/**
 * Momentum map: every rated product as a dot. Across, its reports in the last 12 complete months (log scale); up, those
 * reports against the count expected from its prior 12 months and the change in all reports from the same system (log
 * scale, 1× = in line). Rising products carry their MDL status colour; the rest are grey context, over density bands
 * (d3-contour) that show where most products sit. Scroll, pinch or the buttons zoom (d3-zoom), dragging pans, and the
 * axes rescale with it. Hover finds the nearest dot (d3-delaunay); click opens the product.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Delaunay } from "d3-delaunay";
import { scaleLog, type ScaleLogarithmic } from "d3-scale";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  ChartCanvas,
  axisText,
  localPoint,
  textWidth,
  type TipSpec,
} from "@/components/charts/canvas";
import { densityBands, type DensityBand } from "@/components/charts/d3/layouts";
import { cn } from "@/lib/utils";
import { STATUS_COLOR } from "./watchColors";
import {
  SIGNAL_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  type MdlStatus,
  type WatchPoint,
} from "./watchModel";

// draw order: context first, the products the view is about last (on top)
const DRAW: MdlStatus[] = ["unkeyed", "closed", "pending", "none"];
const RISING = new Set(["sharp", "rising", "new"]);

const Y_MIN = 1 / 8;
const Y_MAX = 64;
const M = { top: 14, right: 14, bottom: 34, left: 44 };

const yTick = (v: number) => {
  if (v >= 1) return `${Number.isInteger(v) ? v : v.toFixed(1)}×`;
  const inv = 1 / v;
  return Number.isInteger(Math.round(inv * 100) / 100)
    ? `1/${Math.round(inv)}×`
    : `${v.toFixed(2)}×`;
};
const xTick = (v: number) =>
  v >= 1e6
    ? `${+(v / 1e6).toFixed(1)}M`
    : v >= 1e3
      ? `${+(v / 1e3).toFixed(1)}K`
      : String(Math.round(v));
const n = (v: number) => Math.round(v).toLocaleString("en-US");

/** Powers of two inside the domain, with the midpoints when zoomed in far enough to need them. */
function ratioTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  const a = Math.floor(Math.log2(lo));
  const b = Math.ceil(Math.log2(hi));
  const dense = b - a <= 3;
  for (let e = a; e <= b; e++) {
    const v = Math.pow(2, e);
    if (v >= lo && v <= hi) out.push(v);
    const mid = v * 1.5;
    if (dense && mid >= lo && mid <= hi) out.push(mid);
  }
  return out.sort((p, q) => p - q);
}

/** Log ticks for the report axis: powers of ten, plus 2 and 5 multiples once zoomed in. */
function countTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  const span = Math.log10(hi / lo);
  const steps = span < 1.6 ? [1, 2, 5] : [1];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const s of steps) {
      const v = s * Math.pow(10, e);
      if (v >= lo && v <= hi) out.push(v);
    }
  return out;
}

export function MomentumMap({
  points,
  labelled,
  highlight,
  visible,
  height = 440,
}: {
  points: readonly WatchPoint[];
  /** Ids written on the map (the leading emerging products); arrow keys step through them. */
  labelled: readonly string[];
  /** Ids drawn large (search matches). */
  highlight: ReadonlySet<string>;
  /** Statuses shown. */
  visible: ReadonlySet<MdlStatus>;
  height?: number;
}) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<WatchPoint | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [zt, setZt] = useState<ZoomTransform>(zoomIdentity);
  const [zooming, setZooming] = useState(false);
  const shown = useMemo(() => points.filter((p) => visible.has(p.status)), [points, visible]);
  const keyed = useMemo(
    () => labelled.map((id) => shown.find((p) => p.id === id)).filter((p): p is WatchPoint => !!p),
    [labelled, shown],
  );
  const xMax = Math.max(1000, ...points.map((p) => p.recent));
  const xHi = Math.pow(10, Math.ceil(Math.log10(xMax)));
  const size = useRef<{ w: number; h: number }>({ w: 0, h: height });
  const zoomedRef = useRef(false);

  // d3-zoom owns the gestures on the plot overlay; React keeps the transform and redraws
  const behaviour = useRef<ZoomBehavior<SVGRectElement, unknown> | null>(null);
  const overlay = useRef<SVGRectElement | null>(null);
  const attach = useCallback((node: SVGRectElement | null) => {
    if (overlay.current && behaviour.current) select(overlay.current).on(".zoom", null);
    overlay.current = node;
    if (!node) return;
    const z = d3zoom<SVGRectElement, unknown>()
      .scaleExtent([1, 24])
      .filter((event: Event) => {
        // the page keeps its scroll: the wheel zooms only with Ctrl or ⌘ (a trackpad pinch sends Ctrl), touch only
        // once the map is zoomed with the buttons; mouse drag and double-click always work
        if (event.type === "wheel")
          return (event as WheelEvent).ctrlKey || (event as WheelEvent).metaKey;
        if (event.type.startsWith("touch")) return zoomedRef.current;
        return !(event as MouseEvent).button;
      })
      .on("start", () => setZooming(true))
      .on("zoom", (event: { transform: ZoomTransform }) => setZt(event.transform))
      .on("end", () => setZooming(false));
    behaviour.current = z;
    select(node).call(z);
  }, []);
  useEffect(() => {
    // the extent follows the plot area so panning never leaves the data
    const z = behaviour.current;
    const { w, h } = size.current;
    if (!z || !w) return;
    z.extent([
      [M.left, M.top],
      [w - M.right, h - M.bottom],
    ]).translateExtent([
      [M.left, M.top],
      [w - M.right, h - M.bottom],
    ]);
  });
  const zoomBy = (k: number) => {
    if (overlay.current && behaviour.current)
      select(overlay.current).call(behaviour.current.scaleBy, k);
  };
  const reset = () => {
    if (overlay.current && behaviour.current)
      select(overlay.current).call(behaviour.current.transform, zoomIdentity);
  };

  // base geometry (unzoomed pixels), density bands and the hover index are computed once per width and data
  const geometry = useRef<{
    key: string;
    shown: readonly WatchPoint[];
    base: Map<string, { x: number; y: number }>;
    bands: DensityBand[];
    delaunay: Delaunay<WatchPoint>;
  } | null>(null);

  const describe = (i: number) => {
    const p = keyed[i];
    return p
      ? `${p.label}: ${n(p.recent)} reports in the last 12 months, ${p.ratio.toFixed(2)} times expected. ${STATUS_LABEL[p.status]}.`
      : "";
  };
  const zoomed = zt.k > 1.001;
  zoomedRef.current = zoomed;
  return (
    <div className="relative">
      <ChartCanvas
        height={height}
        ariaLabel={`Products by reports in the last 12 months and by reports against expected. ${shown.length} products.`}
        count={keyed.length}
        active={active}
        onActive={setActive}
        describe={describe}
      >
        {(w) => {
          size.current = { w, h: height };
          const x: ScaleLogarithmic<number, number> = scaleLog()
            .domain([50, xHi])
            .range([M.left, w - M.right])
            .clamp(true);
          const y: ScaleLogarithmic<number, number> = scaleLog()
            .domain([Y_MIN, Y_MAX])
            .range([height - M.bottom, M.top])
            .clamp(true);
          const key = `${w}|${height}|${xHi}`;
          if (
            !geometry.current ||
            geometry.current.key !== key ||
            geometry.current.shown !== shown
          ) {
            const base = new Map(
              shown.map((p) => [
                p.id,
                { x: x(p.recent), y: y(Math.min(Y_MAX, Math.max(Y_MIN, p.ratio))) },
              ]),
            );
            geometry.current = {
              key,
              shown,
              base,
              bands: densityBands([...base.values()], w, height, { bandwidth: 16, levels: 7 }),
              delaunay: Delaunay.from(
                shown,
                (p) => base.get(p.id)!.x,
                (p) => base.get(p.id)!.y,
              ),
            };
          }
          const { base, bands, delaunay } = geometry.current;
          const zx = zt.rescaleX(x);
          const zy = zt.rescaleY(y);
          const [xLo, xHiZ] = zx.domain() as [number, number];
          const [yLo, yHiZ] = zy.domain() as [number, number];
          const pos = (p: WatchPoint) => {
            const b = base.get(p.id) ?? { x: 0, y: 0 };
            return { cx: zt.applyX(b.x), cy: zt.applyY(b.y) };
          };
          const inPlot = (cx: number, cy: number) =>
            cx >= M.left - 2 &&
            cx <= w - M.right + 2 &&
            cy >= M.top - 2 &&
            cy <= height - M.bottom + 2;
          const focus = active !== null ? keyed[active] : hover;
          const onMove = (e: React.PointerEvent<SVGRectElement>) => {
            if (zooming) return;
            const { x: px, y: py } = localPoint(e);
            const [bx, by] = zt.invert([px, py]);
            const i = delaunay.find(bx, by);
            const p = shown[i];
            if (!p) return setHover(null);
            const { cx, cy } = pos(p);
            setHover((cx - px) ** 2 + (cy - py) ** 2 < 16 * 16 ? p : null);
          };
          // labels: leading products, nudged so two labels do not overlap
          const placed: { x: number; y: number; w: number }[] = [];
          const labels = [
            ...keyed,
            ...shown.filter((p) => highlight.has(p.id) && !labelled.includes(p.id)),
          ]
            .slice(0, w < 560 ? 5 : 14)
            .flatMap((p) => {
              const { cx, cy } = pos(p);
              if (!inPlot(cx, cy)) return [];
              const max = w < 560 ? 16 : 26;
              const text = p.label.length > max ? `${p.label.slice(0, max - 1)}…` : p.label;
              const tw = textWidth(text, 11) + 4;
              const right = cx + 8 + tw < w - M.right;
              // a label that fits on neither side of its dot is left off (the dot still has its tooltip)
              if (!right && cx - 8 - tw < 2) return [];
              let ly = cy + 4;
              for (let tries = 0; tries < 6; tries++) {
                const lx = right ? cx + 8 : cx - 8 - tw;
                const hit = placed.some(
                  (b) => Math.abs(b.y - ly) < 13 && lx < b.x + b.w && lx + tw > b.x,
                );
                if (!hit) {
                  placed.push({ x: lx, y: ly, w: tw });
                  return [
                    { p, text, lx: right ? cx + 8 : cx - 8, ly, anchor: right ? "start" : "end" },
                  ];
                }
                ly += tries % 2 ? -(tries + 1) * 12 : (tries + 1) * 12;
              }
              return [];
            });
          const tooltip: TipSpec | null =
            focus && inPlot(pos(focus).cx, pos(focus).cy)
              ? {
                  x: pos(focus).cx,
                  y: pos(focus).cy,
                  content: {
                    title: focus.label,
                    subtitle: `${SOURCE_LABEL[focus.source]} · ${STATUS_LABEL[focus.status]}`,
                    rows: [
                      { key: "r", label: "Last 12 months", value: n(focus.recent) },
                      { key: "x", label: "Against expected", value: `${focus.ratio.toFixed(2)}×` },
                      { key: "s", label: "Signal", value: SIGNAL_LABEL[focus.signal] },
                    ],
                    footer: "Click to open the product",
                  },
                }
              : null;
          const move = zooming ? undefined : "cx 420ms ease, cy 420ms ease, r 200ms ease";
          const clipId = `momentum-clip-${w}`;
          const y1 = Math.max(M.top, Math.min(height - M.bottom, zy(1)));
          const marks = (
            <g>
              <defs>
                <clipPath id={clipId}>
                  <rect
                    x={M.left}
                    y={M.top}
                    width={w - M.left - M.right}
                    height={height - M.top - M.bottom}
                  />
                </clipPath>
              </defs>
              {/* rising band: everything above the 1× line */}
              <rect
                x={M.left}
                y={M.top}
                width={w - M.left - M.right}
                height={Math.max(0, y1 - M.top)}
                fill="var(--chart-1)"
                opacity={0.04}
              />
              {ratioTicks(yLo, yHiZ).map((t) => (
                <g key={`y${t}`}>
                  <line
                    x1={M.left}
                    x2={w - M.right}
                    y1={zy(t)}
                    y2={zy(t)}
                    stroke={t === 1 ? "var(--chart-reference)" : "var(--chart-gridline)"}
                    strokeDasharray={t === 1 ? "4 3" : undefined}
                    opacity={t === 1 ? 0.55 : 1}
                  />
                  <text x={M.left - 6} y={zy(t) + 3.5} textAnchor="end" {...axisText}>
                    {yTick(t)}
                  </text>
                </g>
              ))}
              {countTicks(xLo, xHiZ).map((t) => (
                <g key={`x${t}`}>
                  <line
                    x1={zx(t)}
                    x2={zx(t)}
                    y1={M.top}
                    y2={height - M.bottom}
                    stroke="var(--chart-gridline)"
                  />
                  <text x={zx(t)} y={height - M.bottom + 15} textAnchor="middle" {...axisText}>
                    {xTick(t)}
                  </text>
                </g>
              ))}
              <text x={(M.left + w - M.right) / 2} y={height - 4} textAnchor="middle" {...axisText}>
                Reports in the last 12 months (log scale)
              </text>
              <g clipPath={`url(#${clipId})`}>
                {/* where most products sit: density of every shown product, grey, under the dots */}
                <g transform={zt.toString()} opacity={0.9}>
                  {bands.map((b, i) => (
                    <path
                      key={i}
                      d={b.path}
                      fill="var(--chart-base)"
                      fillOpacity={0.05 + (0.22 * (i + 1)) / Math.max(1, bands.length)}
                      stroke="var(--chart-base)"
                      strokeOpacity={0.35}
                      strokeWidth={0.6 / zt.k}
                    />
                  ))}
                </g>
                {/* products not rising sit in the base grey as context; rising ones carry their MDL status colour */}
                <g>
                  {shown
                    .filter(
                      (p) =>
                        !RISING.has(p.signal) && !highlight.has(p.id) && !labelled.includes(p.id),
                    )
                    .map((p) => {
                      const { cx, cy } = pos(p);
                      return (
                        <circle
                          key={p.id}
                          cx={cx}
                          cy={cy}
                          r={zoomed ? 2.8 : 2}
                          fill="var(--chart-base)"
                          fillOpacity={0.55}
                          style={{ transition: move }}
                        />
                      );
                    })}
                </g>
                {DRAW.map((status) => (
                  <g key={status}>
                    {shown
                      .filter(
                        (p) =>
                          p.status === status &&
                          (RISING.has(p.signal) || highlight.has(p.id) || labelled.includes(p.id)),
                      )
                      .map((p) => {
                        const { cx, cy } = pos(p);
                        const big = highlight.has(p.id) || labelled.includes(p.id);
                        return (
                          <circle
                            key={p.id}
                            cx={cx}
                            cy={cy}
                            r={big ? 5.5 : zoomed ? 4 : 3.2}
                            fill={STATUS_COLOR[status]}
                            fillOpacity={big ? 1 : 0.85}
                            stroke="var(--chart-surface)"
                            strokeWidth={big ? 1.6 : 0.7}
                            style={{ transition: move }}
                          />
                        );
                      })}
                  </g>
                ))}
              </g>
              <text
                x={w - M.right - 4}
                y={M.top + 12}
                textAnchor="end"
                {...axisText}
                fontWeight={600}
              >
                Rising faster than its source
              </text>
              {zy(1) > M.top && zy(1) < height - M.bottom ? (
                <text x={w - M.right - 4} y={zy(1) - 5} textAnchor="end" {...axisText}>
                  In line with all reports
                </text>
              ) : null}
              {labels.map(({ p, text, lx, ly, anchor }) => (
                <text
                  key={p.id}
                  x={lx}
                  y={ly}
                  textAnchor={anchor as "start" | "end"}
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--chart-ink)"
                  stroke="var(--chart-surface)"
                  strokeWidth={3}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {text}
                </text>
              ))}
              {focus && inPlot(pos(focus).cx, pos(focus).cy) ? (
                <circle
                  cx={pos(focus).cx}
                  cy={pos(focus).cy}
                  r={8}
                  fill="none"
                  stroke="var(--chart-ink)"
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
              ) : null}
              <rect
                ref={attach}
                x={M.left}
                y={M.top}
                width={w - M.left - M.right}
                height={height - M.top - M.bottom}
                fill="transparent"
                className={cn(
                  zooming
                    ? "cursor-grabbing"
                    : hover
                      ? "cursor-pointer"
                      : zoomed
                        ? "cursor-grab"
                        : "cursor-crosshair",
                )}
                style={{ touchAction: zoomed ? "none" : "pan-y" }}
                onPointerMove={onMove}
                onPointerLeave={() => setHover(null)}
                onClick={() => {
                  if (hover)
                    void navigate({ to: "/safety/products/$id", params: { id: hover.id } });
                }}
              />
            </g>
          );
          return { marks, tooltip };
        }}
      </ChartCanvas>
      <div
        className="absolute left-12 top-2 flex items-center gap-1"
        role="group"
        aria-label="Zoom the map"
      >
        <button
          type="button"
          onClick={() => zoomBy(1.8)}
          className="flex size-7 items-center justify-center rounded-md border border-border bg-surface/90 text-foreground shadow-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Zoom in"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.8)}
          disabled={!zoomed}
          className="flex size-7 items-center justify-center rounded-md border border-border bg-surface/90 text-foreground shadow-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
          aria-label="Zoom out"
        >
          <Minus className="size-3.5" aria-hidden />
        </button>
        {zoomed ? (
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface/90 px-2 text-[12px] text-foreground shadow-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <RotateCcw className="size-3" aria-hidden />
            Reset {zt.k.toFixed(1)}×
          </button>
        ) : (
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            Ctrl + scroll or pinch to zoom, drag to pan
          </span>
        )}
      </div>
    </div>
  );
}
