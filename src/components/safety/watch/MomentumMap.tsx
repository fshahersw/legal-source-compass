/**
 * Momentum map: every rated product as a dot. Across, its reports in the last 12 complete months (log scale); up, those
 * reports against the count expected from its prior 12 months and the change in all reports from the same system (log
 * scale, 1× = in line). Colour is the product's MDL status, so products rising with no MDL linked stand out against
 * those already in litigation. Hover or focus a dot for its figures; click opens the product.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { scaleLog } from "d3-scale";
import {
  ChartCanvas,
  axisText,
  localPoint,
  textWidth,
  type TipSpec,
} from "@/components/charts/canvas";
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
const Y_TICKS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];
const M = { top: 14, right: 14, bottom: 34, left: 44 };

const yTick = (v: number) => (v < 1 ? `${v === 0.5 ? "½" : v === 0.25 ? "¼" : "⅛"}×` : `${v}×`);
const xTick = (v: number) => (v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}K` : String(v));
const n = (v: number) => Math.round(v).toLocaleString("en-US");

export function MomentumMap({
  points,
  labelled,
  highlight,
  visible,
  height = 420,
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
  const shown = useMemo(() => points.filter((p) => visible.has(p.status)), [points, visible]);
  const keyed = useMemo(
    () => labelled.map((id) => shown.find((p) => p.id === id)).filter((p): p is WatchPoint => !!p),
    [labelled, shown],
  );
  const xMax = Math.max(1000, ...shown.map((p) => p.recent));
  const xHi = Math.pow(10, Math.ceil(Math.log10(xMax)));
  const describe = (i: number) => {
    const p = keyed[i];
    return p
      ? `${p.label}: ${n(p.recent)} reports in the last 12 months, ${p.ratio.toFixed(2)} times expected. ${STATUS_LABEL[p.status]}.`
      : "";
  };
  return (
    <ChartCanvas
      height={height}
      ariaLabel={`Products by reports in the last 12 months and by reports against expected. ${shown.length} products.`}
      count={keyed.length}
      active={active}
      onActive={setActive}
      describe={describe}
    >
      {(w) => {
        const x = scaleLog()
          .domain([50, xHi])
          .range([M.left, w - M.right])
          .clamp(true);
        const y = scaleLog()
          .domain([Y_MIN, Y_MAX])
          .range([height - M.bottom, M.top])
          .clamp(true);
        const xTicks: number[] = [];
        for (let v = 100; v <= xHi; v *= 10) xTicks.push(v);
        const focus = active !== null ? keyed[active] : hover;
        const pos = (p: WatchPoint) => ({
          cx: x(p.recent),
          cy: y(Math.min(Y_MAX, Math.max(Y_MIN, p.ratio))),
        });
        const onMove = (e: React.PointerEvent<SVGRectElement>) => {
          const { x: px, y: py } = localPoint(e);
          let best: WatchPoint | null = null;
          let bestD = 14 * 14;
          for (const p of shown) {
            const { cx, cy } = pos(p);
            const d = (cx - px) ** 2 + (cy - py) ** 2;
            if (d < bestD) {
              bestD = d;
              best = p;
            }
          }
          setHover(best);
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
        const tooltip: TipSpec | null = focus
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
        const marks = (
          <g>
            {/* rising band */}
            <rect
              x={M.left}
              y={M.top}
              width={w - M.left - M.right}
              height={y(1) - M.top}
              fill="var(--chart-1)"
              opacity={0.04}
            />
            {Y_TICKS.map((t) => (
              <g key={t}>
                <line
                  x1={M.left}
                  x2={w - M.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 1 ? "var(--chart-reference)" : "var(--chart-gridline)"}
                  strokeWidth={t === 1 ? 1 : 1}
                  strokeDasharray={t === 1 ? "4 3" : undefined}
                  opacity={t === 1 ? 0.55 : 1}
                />
                <text x={M.left - 6} y={y(t) + 3.5} textAnchor="end" {...axisText}>
                  {yTick(t)}
                </text>
              </g>
            ))}
            <text x={w - M.right} y={y(1) - 5} textAnchor="end" {...axisText}>
              In line with all reports
            </text>
            <text x={w - M.right} y={M.top + 12} textAnchor="end" {...axisText} fontWeight={600}>
              Rising faster than its source
            </text>
            {xTicks.map((t) => (
              <g key={t}>
                <line
                  x1={x(t)}
                  x2={x(t)}
                  y1={M.top}
                  y2={height - M.bottom}
                  stroke="var(--chart-gridline)"
                />
                <text x={x(t)} y={height - M.bottom + 15} textAnchor="middle" {...axisText}>
                  {xTick(t)}
                </text>
              </g>
            ))}
            <text x={(M.left + w - M.right) / 2} y={height - 4} textAnchor="middle" {...axisText}>
              Reports in the last 12 months (log scale)
            </text>
            {/* products not rising sit in the base grey as context; rising ones carry their MDL status colour */}
            <g>
              {shown
                .filter(
                  (p) => !RISING.has(p.signal) && !highlight.has(p.id) && !labelled.includes(p.id),
                )
                .map((p) => {
                  const { cx, cy } = pos(p);
                  return (
                    <circle
                      key={p.id}
                      cx={cx}
                      cy={cy}
                      r={2.2}
                      fill="var(--chart-base)"
                      fillOpacity={0.5}
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
                    const clipped = p.ratio > Y_MAX;
                    return (
                      <circle
                        key={p.id}
                        cx={cx}
                        cy={cy}
                        r={big ? 5 : 3}
                        fill={STATUS_COLOR[status]}
                        fillOpacity={big ? 1 : 0.8}
                        stroke={big || clipped ? "var(--chart-surface)" : "none"}
                        strokeWidth={big ? 1.5 : 1}
                      />
                    );
                  })}
              </g>
            ))}
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
              >
                {text}
              </text>
            ))}
            {focus ? (
              <circle
                cx={pos(focus).cx}
                cy={pos(focus).cy}
                r={7.5}
                fill="none"
                stroke="var(--chart-ink)"
                strokeWidth={1.5}
              />
            ) : null}
            <rect
              x={M.left}
              y={M.top}
              width={w - M.left - M.right}
              height={height - M.top - M.bottom}
              fill="transparent"
              className={cn(hover ? "cursor-pointer" : "cursor-crosshair")}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
              onClick={() => {
                if (hover) void navigate({ to: "/safety/products/$id", params: { id: hover.id } });
              }}
            />
          </g>
        );
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}
