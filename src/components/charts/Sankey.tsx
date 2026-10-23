/**
 * Sankey diagram from exact records: each ribbon is a counted flow (e.g. member actions from an originating court
 * into an MDL), ribbon width proportional to the count. Nodes are labelled beside their bar; ribbons are hover and
 * keyboard targets with the exact count.
 */
import { useMemo, useState } from "react";
import { ChartCanvas, textWidth, type TipSpec } from "./canvas";
import type { ValueFormatter } from "./format";
import { seriesVar } from "./palette";
import {
  ribbonPath,
  sankeyLayout,
  type SankeyLinkInput,
  type SankeyNodeInput,
} from "./sankeyLayout";

export function Sankey({
  nodes,
  links,
  formatter,
  unit,
  ariaLabel,
  height = 360,
  width,
  colorColumn = 1,
}: {
  nodes: readonly SankeyNodeInput[];
  links: readonly SankeyLinkInput[];
  formatter: ValueFormatter;
  unit: string;
  ariaLabel: string;
  height?: number;
  width?: number | undefined;
  /** Ribbons take the colour of their node in this column (palette slot by node order there, at most 6). */
  colorColumn?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const labelOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.label] as const)), [nodes]);
  const leftLabelW = Math.min(
    170,
    Math.max(60, ...nodes.filter((n) => n.column === 0).map((n) => textWidth(n.label, 10.5) + 12)),
  );
  const maxCol = Math.max(0, ...nodes.map((n) => n.column));
  const rightLabelW = Math.min(
    190,
    Math.max(
      60,
      ...nodes.filter((n) => n.column === maxCol).map((n) => textWidth(n.label, 10.5) + 12),
    ),
  );
  const sortedLinks = useMemo(
    () => [...links].sort((a, b) => b.value - a.value || a.source.localeCompare(b.source)),
    [links],
  );
  const describe = (i: number) => {
    const l = sortedLinks[i]!;
    return `${labelOf.get(l.source)} to ${labelOf.get(l.target)}: ${formatter.full(l.value)} ${unit}.`;
  };
  return (
    <ChartCanvas
      width={width}
      height={height}
      ariaLabel={ariaLabel}
      count={sortedLinks.length}
      active={active}
      onActive={setActive}
      describe={describe}
      orientation="vertical"
    >
      {(w) => {
        const inner = Math.max(80, w - leftLabelW - rightLabelW);
        const layout = sankeyLayout(nodes, links, {
          width: inner,
          height: height - 8,
          nodeWidth: 10,
          padding: 6,
        });
        const colourNodes = layout.nodes
          .filter((n) => n.column === colorColumn)
          .sort((a, b) => a.y0 - b.y0);
        const slot = new Map(colourNodes.map((n, i) => [n.id, i] as const));
        const colourFor = (l: SankeyLinkInput) => {
          const id = colorColumn === 0 ? l.source : l.target;
          const s = slot.get(id);
          return s !== undefined && s < 6 ? seriesVar(s) : "var(--chart-axis)";
        };
        const activeLink = active !== null ? sortedLinks[active] : undefined;
        const marks = (
          <g transform={`translate(${leftLabelW},4)`}>
            {layout.links.map((l) => {
              const isActive =
                activeLink && activeLink.source === l.source && activeLink.target === l.target;
              const idx = sortedLinks.findIndex(
                (s) => s.source === l.source && s.target === l.target,
              );
              return (
                <path
                  key={`${l.source}->${l.target}`}
                  d={ribbonPath(l)}
                  fill="none"
                  stroke={colourFor(l)}
                  strokeOpacity={activeLink ? (isActive ? 0.6 : 0.12) : 0.32}
                  strokeWidth={Math.max(1, l.width)}
                  onPointerEnter={() => setActive(idx)}
                  onPointerLeave={() => setActive(null)}
                />
              );
            })}
            {layout.nodes.map((n) => (
              <g key={n.id}>
                <rect
                  x={n.x0}
                  y={n.y0}
                  width={n.x1 - n.x0}
                  height={Math.max(1, n.y1 - n.y0)}
                  rx={2}
                  fill={
                    n.column === colorColumn && (slot.get(n.id) ?? 9) < 6
                      ? seriesVar(slot.get(n.id)!)
                      : "var(--chart-ink)"
                  }
                  fillOpacity={n.column === colorColumn ? 1 : 0.7}
                />
                <text
                  x={n.column === 0 ? n.x0 - 6 : n.x1 + 6}
                  y={(n.y0 + n.y1) / 2}
                  dy="0.32em"
                  textAnchor={n.column === 0 ? "end" : "start"}
                  fontSize={10.5}
                  fill="var(--chart-ink)"
                >
                  {n.y1 - n.y0 >= 9 || n.column !== 0
                    ? `${truncate(n.label, 26)} · ${formatter.tick(n.value)}`
                    : ""}
                </text>
              </g>
            ))}
          </g>
        );
        const tooltip: TipSpec | null = activeLink
          ? (() => {
              const laid = layout.links.find(
                (l) => l.source === activeLink.source && l.target === activeLink.target,
              );
              return {
                x: leftLabelW + (laid ? (laid.x0 + laid.x1) / 2 : inner / 2),
                y: laid ? (laid.y0 + laid.y1) / 2 : height / 2,
                content: {
                  title: `${labelOf.get(activeLink.source)} → ${labelOf.get(activeLink.target)}`,
                  rows: [{ key: "v", label: unit, value: formatter.full(activeLink.value) }],
                },
              };
            })()
          : null;
        return { marks, tooltip };
      }}
    </ChartCanvas>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
