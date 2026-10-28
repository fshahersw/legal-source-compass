/**
 * Beeswarm (d3-force): every point as a mark at its value on a shared log axis, one lane per group, marks pushed apart
 * so none overlap, so the whole distribution of each group shows (where it clusters, how far its tail runs) rather
 * than one average. Each lane marks its median. Hover finds the nearest mark (d3-delaunay); arrow keys step through the
 * labelled marks; a click selects. Wrap it in a ChartCard: the table view carries every value.
 *
 *   <Beeswarm points={[{ id, label, value: 2.4, group: "none", size: 1200 }]}
 *     groups={[{ id: "none", label: "No MDL linked", color }]} reference={1} format={(v) => `${v}×`} />
 */
import { useMemo, useRef, useState } from "react";
import { Delaunay } from "d3-delaunay";
import { median } from "d3-array";
import { scaleLog, scaleSqrt } from "d3-scale";
import { ChartCanvas, axisText, localPoint, type TipSpec } from "../canvas";
import { beeswarm } from "./layouts";

export type SwarmPoint = {
  id: string;
  label: string;
  value: number;
  group: string;
  /** Drives the mark's area (e.g. a count), within the chart's `radius` range. */
  size: number;
  /** Extra tooltip rows. */
  detail?: { label: string; value: string }[] | undefined;
};
export type SwarmGroup = { id: string; label: string; color: string };

/** Lane height grows with the group's size so a large group's swarm has room (64 to 220 px). */
const laneHeight = (count: number) =>
  Math.round(Math.min(220, Math.max(64, 40 + 4 * Math.sqrt(count))));
const TOP = 10;
const BOTTOM = 30;

export function Beeswarm({
  points,
  groups,
  reference,
  referenceLabel,
  format,
  tick,
  domain,
  ariaLabel,
  labelled = [],
  onSelect,
  radius = [2, 7],
}: {
  points: readonly SwarmPoint[];
  groups: readonly SwarmGroup[];
  /** A value marked with a dashed rule (1 for a ratio). */
  reference?: number | undefined;
  referenceLabel?: string | undefined;
  format: (v: number) => string;
  tick?: ((v: number) => string) | undefined;
  /** Axis domain (log); values outside are clamped to the edge. */
  domain: readonly [number, number];
  ariaLabel: string;
  /** Ids whose names are written beside their mark (arrow keys step through them). */
  labelled?: readonly string[];
  onSelect?: ((id: string) => void) | undefined;
  /** Smallest and largest mark radius in pixels (area follows `size`). */
  radius?: readonly [number, number] | undefined;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const lanes = useMemo(() => {
    let top = TOP;
    return groups.map((g) => {
      const h = laneHeight(points.filter((p) => p.group === g.id).length);
      const lane = { id: g.id, top, h, mid: top + h / 2 };
      top += h;
      return lane;
    });
  }, [groups, points]);
  const height = (lanes.at(-1) ? lanes.at(-1)!.top + lanes.at(-1)!.h : TOP) + BOTTOM;
  const r = useMemo(() => {
    const max = Math.max(1, ...points.map((p) => p.size));
    return scaleSqrt().domain([0, max]).range([radius[0], radius[1]]);
  }, [points, radius]);
  const keyed = labelled.map((id) => points.findIndex((p) => p.id === id)).filter((i) => i >= 0);
  // the force layout runs once per width and data, not on every hover
  const layout = useRef<{
    key: string;
    points: readonly SwarmPoint[];
    nodes: ReturnType<typeof beeswarm>;
    delaunay: Delaunay<ReturnType<typeof beeswarm>[number]>;
  } | null>(null);
  return (
    <ChartCanvas
      height={height}
      ariaLabel={ariaLabel}
      count={keyed.length}
      active={active}
      onActive={setActive}
      describe={(i) => {
        const p = points[keyed[i] ?? -1];
        const g = groups.find((x) => x.id === p?.group);
        return p ? `${p.label}: ${format(p.value)}, ${g?.label ?? ""}.` : "";
      }}
    >
      {(w) => {
        const labelW = Math.min(150, Math.max(96, w * 0.16));
        const x = scaleLog()
          .domain([domain[0], domain[1]])
          .range([labelW + 12, w - 16])
          .clamp(true);
        const laneOf = new Map(lanes.map((l) => [l.id, l] as const));
        const key = `${w}|${domain.join(",")}|${groups.map((g) => g.id).join(",")}`;
        if (!layout.current || layout.current.key !== key || layout.current.points !== points) {
          const laid = beeswarm(
            points.map((p) => {
              const lane = laneOf.get(p.group);
              return {
                id: p.id,
                x: x(p.value),
                lane: lane?.mid ?? TOP,
                r: r(p.size),
                spread: lane ? lane.h / 2 - 6 : 20,
              };
            }),
          );
          layout.current = {
            key,
            points,
            nodes: laid,
            delaunay: Delaunay.from(
              laid,
              (n) => n.cx,
              (n) => n.cy,
            ),
          };
        }
        const { nodes, delaunay } = layout.current;
        const focus = active !== null ? (keyed[active] ?? null) : hover;
        const tick$ = tick ?? format;
        const ticks: number[] = [];
        for (let v = domain[0]; v <= domain[1] * 1.0001; v *= 2) ticks.push(v);
        const medians = groups.map(
          (g) =>
            median(
              points.filter((p) => p.group === g.id),
              (p) => p.value,
            ) ?? null,
        );
        const fp = focus !== null ? points[focus] : undefined;
        const fn = focus !== null ? nodes[focus] : undefined;
        const tooltip: TipSpec | null =
          fp && fn
            ? {
                x: fn.cx,
                y: fn.cy,
                content: {
                  title: fp.label,
                  subtitle: groups.find((g) => g.id === fp.group)?.label,
                  rows: [
                    { key: "v", label: "Value", value: format(fp.value) },
                    ...(fp.detail ?? []).map((d, i) => ({ key: `d${i}`, ...d })),
                  ],
                  ...(onSelect ? { footer: "Click to open" } : {}),
                },
              }
            : null;
        const marks = (
          <g>
            {groups.map((g, i) => {
              const lane = lanes[i]!;
              const y = lane.top;
              const LANE = lane.h;
              const m = medians[i] ?? null;
              return (
                <g key={g.id}>
                  <rect
                    x={labelW + 6}
                    y={y + 3}
                    width={w - labelW - 16}
                    height={LANE - 6}
                    rx={6}
                    fill="var(--chart-gridline)"
                    opacity={i % 2 ? 0.35 : 0.6}
                  />
                  <text
                    x={labelW}
                    y={y + LANE / 2 - 2}
                    textAnchor="end"
                    fontSize={12}
                    fontWeight={600}
                    fill="var(--chart-ink)"
                  >
                    {g.label}
                  </text>
                  <text x={labelW} y={y + LANE / 2 + 12} textAnchor="end" {...axisText}>
                    {points.filter((p) => p.group === g.id).length.toLocaleString("en-US")} · median{" "}
                    {m === null ? "—" : format(m)}
                  </text>
                  {m !== null ? (
                    <line
                      x1={x(m)}
                      x2={x(m)}
                      y1={y + 6}
                      y2={y + LANE - 6}
                      stroke={g.color}
                      strokeWidth={2}
                      opacity={0.9}
                    />
                  ) : null}
                </g>
              );
            })}
            {ticks
              .filter((_, i) => w >= 560 || i % 2 === 0)
              .map((t) => (
                <g key={t}>
                  <line
                    x1={x(t)}
                    x2={x(t)}
                    y1={TOP}
                    y2={height - BOTTOM}
                    stroke={t === reference ? "var(--chart-reference)" : "transparent"}
                    strokeDasharray="4 3"
                    opacity={0.6}
                  />
                  <text x={x(t)} y={height - BOTTOM + 15} textAnchor="middle" {...axisText}>
                    {tick$(t)}
                  </text>
                </g>
              ))}
            {reference !== undefined && referenceLabel ? (
              <text
                x={x(reference) + 4}
                y={TOP + 10}
                {...axisText}
                stroke="var(--chart-surface)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {referenceLabel}
              </text>
            ) : null}
            {nodes.map((n, i) => {
              const p = points[i]!;
              const g = groups.find((x) => x.id === p.group);
              const on = focus === i;
              return (
                <circle
                  key={n.id}
                  cx={n.cx}
                  cy={n.cy}
                  r={on ? n.r + 2 : n.r}
                  fill={g?.color ?? "var(--chart-base)"}
                  fillOpacity={on ? 1 : 0.78}
                  stroke={on ? "var(--chart-ink)" : "var(--chart-surface)"}
                  strokeWidth={on ? 1.5 : 0.6}
                  className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50"
                  style={{
                    animationDelay: `${Math.min(600, i * 0.6)}ms`,
                    animationFillMode: "backwards",
                    transformBox: "fill-box",
                    transformOrigin: "center",
                  }}
                />
              );
            })}
            {(() => {
              // labels with a leader line, stacked above the lane so they never sit on each other or on the marks
              const placed: { x0: number; x1: number; y: number }[] = [];
              // on a narrow chart the names would cover the swarm; the tooltip and table carry them
              if (w < 560) return null;
              return keyed.map((i) => {
                const n = nodes[i];
                const p = points[i];
                const lane = lanes.find((l) => l.id === p?.group);
                if (!n || !p || !lane) return null;
                const text = p.label.length > 22 ? `${p.label.slice(0, 21)}…` : p.label;
                const tw = text.length * 11 * 0.56;
                const right = n.cx + tw + 8 < w - 8;
                const x0 = right ? n.cx + 6 : n.cx - 6 - tw;
                let ly = lane.top + 14;
                while (placed.some((b) => Math.abs(b.y - ly) < 13 && x0 < b.x1 && x0 + tw > b.x0))
                  ly += 13;
                placed.push({ x0, x1: x0 + tw, y: ly });
                return (
                  <g key={`l-${p.id}`} pointerEvents="none">
                    <line
                      x1={n.cx}
                      y1={n.cy - n.r}
                      x2={n.cx}
                      y2={ly + 2}
                      stroke="var(--chart-ink)"
                      strokeWidth={0.8}
                      opacity={0.6}
                    />
                    <text
                      x={right ? n.cx + 4 : n.cx - 4}
                      y={ly}
                      textAnchor={right ? "start" : "end"}
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--chart-ink)"
                      stroke="var(--chart-surface)"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {text}
                    </text>
                  </g>
                );
              });
            })()}
            <rect
              x={0}
              y={0}
              width={w}
              height={height - BOTTOM}
              fill="transparent"
              className={onSelect ? "cursor-pointer" : undefined}
              onPointerMove={(e) => {
                const { x: px, y: py } = localPoint(e);
                const i = delaunay.find(px, py);
                const n = nodes[i];
                setHover(n && (n.cx - px) ** 2 + (n.cy - py) ** 2 < 24 * 24 ? i : null);
              }}
              onPointerLeave={() => setHover(null)}
              onClick={() => {
                const p = hover !== null ? points[hover] : undefined;
                if (p && onSelect) onSelect(p.id);
              }}
            />
          </g>
        );
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}
