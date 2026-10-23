/**
 * Small relationship network in SVG (no graph library): node size by its stated weight, edge width by the counted
 * relationship (e.g. parties two firms represented together). Hover or arrow keys highlight a node and its links and
 * list them. Layout is deterministic (networkLayout.ts); distance on the page carries no meaning by itself.
 */
import { useMemo, useState } from "react";
import { ChartCanvas, localPoint, type TipSpec } from "./canvas";
import type { ValueFormatter } from "./format";
import { networkLayout, type NetEdge, type NetNode } from "./networkLayout";

export function Network({
  nodes,
  edges,
  formatter,
  edgeUnit,
  nodeUnit,
  ariaLabel,
  height = 420,
  width,
  seed = 7,
}: {
  nodes: readonly NetNode[];
  edges: readonly NetEdge[];
  formatter: ValueFormatter;
  /** What an edge counts ("shared parties"). */
  edgeUnit: string;
  /** What a node's weight counts ("appearances"). */
  nodeUnit: string;
  ariaLabel: string;
  height?: number;
  width?: number | undefined;
  seed?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const order = useMemo(
    () => [...nodes].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label)),
    [nodes],
  );
  const neighbours = useMemo(() => {
    const m = new Map<string, { other: string; weight: number }[]>();
    for (const e of edges) {
      m.set(e.a, [...(m.get(e.a) ?? []), { other: e.b, weight: e.weight }]);
      m.set(e.b, [...(m.get(e.b) ?? []), { other: e.a, weight: e.weight }]);
    }
    for (const list of m.values()) list.sort((x, y) => y.weight - x.weight);
    return m;
  }, [edges]);
  const labelOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.label] as const)), [nodes]);
  // The layout depends on the width only; hovering must not re-run it.
  const cache = useMemo(
    () => new Map<number, ReturnType<typeof networkLayout>>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, edges, height, seed],
  );
  const describe = (i: number) => {
    const n = order[i]!;
    const nb = neighbours.get(n.id) ?? [];
    return `${n.label}: ${formatter.full(n.weight)} ${nodeUnit}; linked to ${nb.length} shown: ${nb
      .slice(0, 5)
      .map((x) => `${labelOf.get(x.other)} (${formatter.full(x.weight)} ${edgeUnit})`)
      .join(", ")}.`;
  };
  return (
    <ChartCanvas
      width={width}
      height={height}
      ariaLabel={ariaLabel}
      count={order.length}
      active={active}
      onActive={setActive}
      describe={describe}
      orientation="vertical"
    >
      {(w) => {
        const laid =
          cache.get(w) ?? networkLayout(nodes, edges, { width: w, height, seed, padding: 40 });
        cache.set(w, laid);
        const at = new Map(laid.nodes.map((n) => [n.id, n] as const));
        const maxNode = Math.max(1, ...nodes.map((n) => n.weight));
        const maxEdge = Math.max(1, ...edges.map((e) => e.weight));
        const r = (v: number) => 3 + 9 * Math.sqrt(v / maxNode);
        const focus = active !== null ? order[active]!.id : null;
        const linked = new Set(focus ? (neighbours.get(focus) ?? []).map((x) => x.other) : []);
        // Labels: the heaviest nodes first, each kept only where it does not overlap one already placed.
        const boxes: [number, number, number, number][] = [];
        const labelled = new Set<string>();
        for (const n of [...laid.nodes].sort(
          (a, b) => b.weight - a.weight || a.label.localeCompare(b.label),
        )) {
          const text = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
          const wdt = text.length * 5.6;
          const box: [number, number, number, number] = [
            n.x - wdt / 2,
            n.y - r(n.weight) - 15,
            n.x + wdt / 2,
            n.y - r(n.weight) - 3,
          ];
          if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]))
            continue;
          boxes.push(box);
          labelled.add(n.id);
          if (labelled.size >= 14) break;
        }
        const marks = (
          <>
            {laid.edges.map((e) => {
              const a = at.get(e.a)!;
              const b = at.get(e.b)!;
              const on = focus !== null && (e.a === focus || e.b === focus);
              return (
                <line
                  key={`${e.a}|${e.b}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={on ? "var(--chart-1)" : "var(--chart-axis)"}
                  strokeOpacity={focus ? (on ? 0.8 : 0.08) : 0.3}
                  strokeWidth={0.75 + 3.25 * (e.weight / maxEdge)}
                  strokeLinecap="round"
                />
              );
            })}
            {laid.nodes.map((n) => {
              const dim = focus !== null && n.id !== focus && !linked.has(n.id);
              return (
                <g key={n.id} opacity={dim ? 0.3 : 1}>
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={r(n.weight)}
                    fill={n.id === focus ? "var(--chart-2)" : "var(--chart-1)"}
                    stroke="var(--chart-surface)"
                    strokeWidth={2}
                  />
                  {labelled.has(n.id) || n.id === focus ? (
                    <text
                      x={n.x}
                      y={n.y - r(n.weight) - 4}
                      textAnchor="middle"
                      fontSize={10}
                      fill="var(--chart-ink)"
                      stroke="var(--chart-surface)"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label}
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
                let best: number | null = null;
                let bestD = 28;
                laid.nodes.forEach((n) => {
                  const d = Math.hypot(n.x - p.x, n.y - p.y);
                  if (d < bestD) {
                    bestD = d;
                    best = order.findIndex((o) => o.id === n.id);
                  }
                });
                setActive(best);
              }}
              onPointerLeave={() => setActive(null)}
            />
          </>
        );
        const fn = focus ? at.get(focus) : undefined;
        const tooltip: TipSpec | null = fn
          ? {
              x: fn.x,
              y: fn.y + 8,
              content: {
                title: fn.label,
                subtitle: `${formatter.full(fn.weight)} ${nodeUnit}`,
                rows: (neighbours.get(fn.id) ?? []).slice(0, 6).map((x) => ({
                  key: x.other,
                  label: labelOf.get(x.other) ?? x.other,
                  value: formatter.full(x.weight),
                })),
                footer: `Link values: ${edgeUnit}`,
              },
            }
          : null;
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}
