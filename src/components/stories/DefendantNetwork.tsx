/**
 * The defendant network: every company an SEC filing links to an MDL as a defendant, the MDLs, and the MDL product
 * groups, laid out live by a d3-force simulation (links pull, nodes repel, nothing overlaps). Shape says what a node
 * is (circle MDL, square company, diamond product), colour says MDL status, an edge's stroke says how strong the
 * filing's evidence is. Drag a node to pull the graph; hover to light up its neighbourhood; click for the details
 * panel; Ctrl or ⌘ + scroll (or the buttons) to zoom, drag the background to pan. Distance has no meaning of its own:
 * the layout only keeps linked nodes near each other.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link } from "@tanstack/react-router";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { Minus, Plus, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChartTooltip, useMeasuredWidth, type TooltipContent } from "@/components/charts/canvas";
import { chartTokens, seriesVar } from "@/components/charts/palette";
import { cn } from "@/lib/utils";
import {
  buildGraph,
  shortTitle,
  type GraphEdge,
  type GraphNode,
  type Network,
} from "./storiesModel";

type SimNode = GraphNode & SimulationNodeDatum;
type SimEdge = Omit<GraphEdge, "source" | "target"> &
  SimulationLinkDatum<SimNode> & { source: SimNode | string; target: SimNode | string };

const NODE_COLOR = {
  pending: seriesVar(0),
  closed: seriesVar(4),
  company: seriesVar(1),
  product: seriesVar(2),
} as const;

const TIER_STYLE: Record<string, { width: number; dash?: string; label: string }> = {
  A: { width: 1.8, label: "Filing cites the MDL number" },
  B: { width: 1.4, label: "Filing cites the official MDL caption" },
  C: { width: 1, dash: "4 3", label: "Filing describes the MDL by subject (needs review)" },
  product: { width: 0.9, dash: "1 3", label: "Product group named for the MDL" },
};

const n = (v: number) => v.toLocaleString("en-US");

/** Deterministic random source so the starting jiggle, and therefore the settled layout, repeat across visits. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (1664525 * s + 1013904223) >>> 0) / 4294967296;
}

function radiusOf(node: GraphNode, maxPending: number): number {
  if (node.kind === "mdl") {
    const p = node.pending ?? 0;
    return 5 + (maxPending > 0 ? Math.sqrt(p / maxPending) * 23 : 0);
  }
  if (node.kind === "company") return 4.5 + Math.sqrt(node.degree) * 1.9;
  return 4.5;
}

function colorOf(node: GraphNode): string {
  if (node.kind === "company") return NODE_COLOR.company;
  if (node.kind === "product") return NODE_COLOR.product;
  return node.status === "pending" ? NODE_COLOR.pending : NODE_COLOR.closed;
}

function Shape({
  node,
  r,
  fill,
  opacity,
}: {
  node: GraphNode;
  r: number;
  fill: string;
  opacity: number;
}) {
  const common = {
    fill,
    fillOpacity: opacity,
    stroke: "var(--chart-surface)",
    strokeWidth: 1.5,
    style: { transition: "fill-opacity 160ms" },
  };
  if (node.kind === "company")
    return <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2} {...common} />;
  if (node.kind === "product")
    return <path d={`M0,${-r * 1.25}L${r * 1.25},0L0,${r * 1.25}L${-r * 1.25},0Z`} {...common} />;
  return <circle r={r} {...common} />;
}

export function DefendantNetwork({ network, height = 640 }: { network: Network; height?: number }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [showProducts, setShowProducts] = useState(true);
  const [showTierC, setShowTierC] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [zt, setZt] = useState<ZoomTransform>(zoomIdentity);
  const [, setFrame] = useState(0);
  const [settling, setSettling] = useState(true);

  const graph = useMemo(() => {
    const filtered: Network = showTierC
      ? network
      : { ...network, links: network.links.filter((l) => l.tier !== "C") };
    return buildGraph(filtered, { products: showProducts });
  }, [network, showProducts, showTierC]);
  const maxPending = useMemo(
    () => Math.max(0, ...graph.nodes.filter((x) => x.kind === "mdl").map((x) => x.pending ?? 0)),
    [graph],
  );

  // the simulation owns node positions; React redraws on each tick
  const sim = useRef<Simulation<SimNode, SimEdge> | null>(null);
  /** Fits every node in the canvas; set below once the zoom behaviour exists. */
  const fitRef = useRef<(force: boolean) => void>(() => undefined);
  /** True once the reader zoomed or panned: the layout then stops re-fitting itself. */
  const userZoomed = useRef(false);
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<SimEdge[]>([]);
  useEffect(() => {
    const prior = new Map(nodesRef.current.map((x) => [x.id, x] as const));
    const nodes: SimNode[] = graph.nodes.map((x) => {
      const p = prior.get(x.id);
      return p ? { ...x, x: p.x, y: p.y, vx: 0, vy: 0 } : { ...x };
    });
    const edges: SimEdge[] = graph.edges.map((e) => ({ ...e }));
    nodesRef.current = nodes;
    edgesRef.current = edges;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const s = forceSimulation<SimNode, SimEdge>(nodes)
      .randomSource(lcg(20261028))
      .force(
        "link",
        forceLink<SimNode, SimEdge>(edges)
          .id((d) => d.id)
          .distance((e) => (e.kind === "product" ? 26 : 46))
          .strength((e) => (e.kind === "product" ? 0.9 : e.tier === "C" ? 0.35 : 0.6)),
      )
      .force(
        "charge",
        forceManyBody<SimNode>()
          .strength((d) => (d.kind === "mdl" ? -140 - radiusOf(d, maxPending) * 6 : -55))
          .distanceMax(420),
      )
      .force("collide", forceCollide<SimNode>((d) => radiusOf(d, maxPending) + 3).strength(0.9))
      .force("x", forceX<SimNode>(0).strength(0.08))
      .force("y", forceY<SimNode>(0).strength(0.12));
    sim.current = s;
    s.on("tick", () => {
      setFrame((f) => f + 1);
      // keep the growing layout in frame until the reader takes over the zoom
      if (s.alpha() < 0.5 && !dragging.current) fitRef.current(false);
    }).on("end", () => {
      setSettling(false);
      fitRef.current(false);
    });
    if (reduce) {
      // reduced motion: settle off-screen and draw the final layout once
      s.stop();
      for (let i = 0; i < 320; i++) s.tick();
      setSettling(false);
      setFrame((f) => f + 1);
      requestAnimationFrame(() => fitRef.current(false));
    } else {
      setSettling(true);
      if (prior.size) s.alpha(0.6);
    }
    return () => {
      s.stop();
      s.on("tick", null).on("end", null);
    };
  }, [graph, maxPending]);

  // zoom and pan on the background (d3-zoom), the page keeps its scroll unless Ctrl or ⌘ is held
  const svgRef = useRef<SVGSVGElement | null>(null);
  const behaviour = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  useEffect(() => {
    const node = svgRef.current;
    if (!node) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.35, 6])
      .filter((event: Event) => {
        const target = event.target as Element | null;
        if (target?.closest?.("[data-node]")) return false;
        if (event.type === "wheel")
          return (event as WheelEvent).ctrlKey || (event as WheelEvent).metaKey;
        return !(event as MouseEvent).button;
      })
      .on("zoom", (event: { transform: ZoomTransform; sourceEvent: Event | null }) => {
        if (event.sourceEvent) userZoomed.current = true;
        setZt(event.transform);
      });
    behaviour.current = z;
    select(node).call(z).on("dblclick.zoom", null);
    return () => {
      select(node).on(".zoom", null);
    };
  }, [width]);
  const zoomBy = (k: number) => {
    if (svgRef.current && behaviour.current)
      select(svgRef.current).call(behaviour.current.scaleBy, k);
  };
  fitRef.current = (force: boolean) => {
    const el = svgRef.current;
    const z = behaviour.current;
    const nodes = nodesRef.current;
    if (!el || !z || !width || !nodes.length || (userZoomed.current && !force)) return;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const d of nodes) {
      if (d.x === undefined || d.y === undefined) continue;
      const r = radiusOf(d, maxPending) + 4;
      x0 = Math.min(x0, d.x - r);
      x1 = Math.max(x1, d.x + r);
      y0 = Math.min(y0, d.y - r);
      y1 = Math.max(y1, d.y + r + 14);
    }
    if (!Number.isFinite(x0)) return;
    const pad = 28;
    const k = Math.min(1.4, (width - pad * 2) / (x1 - x0), (height - pad * 2) / (y1 - y0));
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const t = zoomIdentity
      .translate(width / 2 - k * (mx + width / 2), height / 2 - k * (my + height / 2))
      .scale(k);
    select(el).call(z.transform, t);
    if (force) userZoomed.current = false;
  };
  const reset = () => fitRef.current(true);

  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [graph]);
  const byId = useMemo(() => new Map(graph.nodes.map((x) => [x.id, x] as const)), [graph]);
  const mdlInfo = useMemo(() => new Map(network.mdls.map((m) => [m.mdl, m] as const)), [network]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q.length < 2
        ? new Set<string>()
        : new Set(
            graph.nodes
              .filter(
                (x) =>
                  x.label.toLowerCase().includes(q) || (x.mdl !== undefined && String(x.mdl) === q),
              )
              .map((x) => x.id),
          ),
    [graph, q],
  );
  const focus = hover ?? selected;
  const lit = useMemo(() => {
    if (focus) return new Set([focus, ...(adjacency.get(focus) ?? [])]);
    if (matches.size) {
      const s = new Set(matches);
      for (const id of matches) for (const o of adjacency.get(id) ?? []) s.add(o);
      return s;
    }
    return null;
  }, [focus, adjacency, matches]);

  // dragging a node pins it under the pointer and reheats the simulation
  const dragging = useRef<string | null>(null);
  const toSim = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { x: (sx - zt.x) / zt.k - (width ?? 0) / 2, y: (sy - zt.y) / zt.k - height / 2 };
  };
  const onNodeDown = (e: ReactPointerEvent<SVGGElement>, id: string) => {
    e.stopPropagation();
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    dragging.current = id;
    dragStarted.current = false;
  };
  const onNodeMove = (e: ReactPointerEvent<SVGGElement>) => {
    if (!dragging.current || !sim.current) return;
    const d = downAt.current;
    if (!dragStarted.current) {
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 4) return;
      dragStarted.current = true;
      sim.current.alphaTarget(0.25).restart();
      setSettling(true);
    }
    const node = nodesRef.current.find((x) => x.id === dragging.current);
    if (!node) return;
    const p = toSim(e);
    node.fx = p.x;
    node.fy = p.y;
  };
  const onNodeUp = (id: string) => {
    const node = nodesRef.current.find((x) => x.id === id);
    if (node) {
      node.fx = null;
      node.fy = null;
    }
    const moved = dragStarted.current;
    dragging.current = null;
    dragStarted.current = false;
    if (moved) sim.current?.alphaTarget(0);
    else setSelected((s) => (s === id ? null : id));
  };
  const dragStarted = useRef(false);
  const downAt = useRef<{ x: number; y: number } | null>(null);

  const w = width ?? 0;
  const cx = w / 2;
  const cy = height / 2;
  const nodes = nodesRef.current;
  const edges = edgesRef.current;
  const hoverNode = hover ? nodes.find((x) => x.id === hover) : undefined;
  const tip: { content: TooltipContent; x: number; y: number } | null =
    hoverNode && hoverNode.x !== undefined && hoverNode.y !== undefined
      ? {
          x: zt.x + zt.k * (hoverNode.x + cx),
          y: zt.y + zt.k * (hoverNode.y + cy),
          content: tooltipFor(hoverNode, adjacency.get(hoverNode.id)?.size ?? 0),
        }
      : null;
  const labelled = (x: SimNode) => {
    if (lit) return lit.has(x.id) && (x.id === focus || matches.has(x.id) || x.kind !== "product");
    if (x.kind === "mdl") return radiusOf(x, maxPending) > 11 || x.degree >= 7;
    if (x.kind === "company") return x.degree >= 4;
    return false;
  };

  const sel = selected ? byId.get(selected) : undefined;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches.size) setSelected([...matches][0]!);
            }}
            placeholder="Find a company, MDL or product"
            aria-label="Find a company, MDL or product in the network"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showProducts}
            onChange={(e) => setShowProducts(e.target.checked)}
            className="accent-foreground"
          />
          Product groups
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showTierC}
            onChange={(e) => setShowTierC(e.target.checked)}
            className="accent-foreground"
          />
          Subject-only links (need review)
        </label>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {q.length >= 2 ? `${matches.size} found · ` : ""}
          {n(graph.nodes.filter((x) => x.kind === "company").length)} companies ·{" "}
          {n(graph.nodes.filter((x) => x.kind === "mdl").length)} MDLs ·{" "}
          {n(graph.edges.filter((e) => e.kind === "defendant").length)} links
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div
          ref={ref}
          className="relative min-w-0 overflow-hidden rounded-md border bg-[var(--chart-surface)]"
          style={{ ...chartTokens, height }}
        >
          {width ? (
            <svg
              ref={svgRef}
              width={w}
              height={height}
              role="img"
              aria-label={`Network of ${graph.nodes.filter((x) => x.kind === "company").length} companies linked by SEC filings to ${graph.nodes.filter((x) => x.kind === "mdl").length} MDLs as defendants. The table view lists every link.`}
              className={cn(
                "block select-none",
                zt.k > 1.001 ? "cursor-grab active:cursor-grabbing" : "",
              )}
              style={{ touchAction: "pan-y" }}
              onClick={(e) => {
                if (!(e.target as Element).closest("[data-node]")) setSelected(null);
              }}
            >
              <defs>
                <radialGradient id="net-glow">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </radialGradient>
              </defs>
              <g transform={zt.toString()}>
                <g transform={`translate(${cx},${cy})`}>
                  {edges.map((e, i) => {
                    const s = e.source as SimNode;
                    const t = e.target as SimNode;
                    if (s.x === undefined || t.x === undefined) return null;
                    const style = TIER_STYLE[e.tier] ?? TIER_STYLE["C"]!;
                    const on = lit
                      ? lit.has(s.id) &&
                        lit.has(t.id) &&
                        (!focus || s.id === focus || t.id === focus || !!matches.size)
                      : false;
                    return (
                      <line
                        key={i}
                        x1={s.x}
                        y1={s.y}
                        x2={t.x}
                        y2={t.y}
                        stroke={on ? "var(--chart-ink)" : "var(--chart-axis)"}
                        strokeOpacity={lit ? (on ? 0.85 : 0.08) : 0.38}
                        strokeWidth={(on ? 1.3 : 1) * style.width}
                        strokeDasharray={style.dash}
                        vectorEffect="non-scaling-stroke"
                        style={{ transition: "stroke-opacity 160ms" }}
                      />
                    );
                  })}
                  {nodes.map((x) => {
                    if (x.x === undefined || x.y === undefined) return null;
                    const r = radiusOf(x, maxPending);
                    const dim = lit ? !lit.has(x.id) : false;
                    const isSel = selected === x.id;
                    return (
                      <g
                        key={x.id}
                        data-node=""
                        transform={`translate(${x.x},${x.y})`}
                        className="cursor-pointer"
                        onPointerEnter={() => setHover(x.id)}
                        onPointerLeave={() => setHover((h) => (h === x.id ? null : h))}
                        onPointerDown={(e) => {
                          downAt.current = { x: e.clientX, y: e.clientY };
                          onNodeDown(e, x.id);
                        }}
                        onPointerMove={onNodeMove}
                        onPointerUp={() => onNodeUp(x.id)}
                        style={{ touchAction: "none" }}
                      >
                        {isSel || matches.has(x.id) ? (
                          <circle r={r * 2.4 + 6} fill="url(#net-glow)" />
                        ) : null}
                        <circle r={Math.max(r + 4, 10)} fill="transparent" />
                        <Shape node={x} r={r} fill={colorOf(x)} opacity={dim ? 0.16 : 0.92} />
                        {isSel ? (
                          <circle
                            r={r + 4}
                            fill="none"
                            stroke="var(--chart-ink)"
                            strokeWidth={1.5}
                          />
                        ) : null}
                      </g>
                    );
                  })}
                  {nodes.map((x) => {
                    if (x.x === undefined || x.y === undefined || !labelled(x)) return null;
                    const r = radiusOf(x, maxPending);
                    const text = x.label.length > 30 ? `${x.label.slice(0, 29)}…` : x.label;
                    return (
                      <text
                        key={`l${x.id}`}
                        x={x.x}
                        y={x.y + r + 11 / zt.k}
                        textAnchor="middle"
                        fontSize={(x.kind === "mdl" ? 11 : 10.5) / Math.sqrt(zt.k)}
                        fontWeight={x.kind === "mdl" ? 700 : 600}
                        fill="var(--chart-ink)"
                        stroke="var(--chart-surface)"
                        strokeWidth={3 / Math.sqrt(zt.k)}
                        paintOrder="stroke"
                        pointerEvents="none"
                      >
                        {x.kind === "mdl" ? `${text} · ${x.mdl}` : text}
                      </text>
                    );
                  })}
                </g>
              </g>
            </svg>
          ) : null}
          {tip && width ? (
            <ChartTooltip content={tip.content} x={tip.x} y={tip.y} containerWidth={w} />
          ) : null}
          <div
            className="absolute right-2 top-2 flex gap-1"
            role="group"
            aria-label="Zoom the network"
          >
            <Button
              size="icon"
              variant="outline"
              className="size-7 bg-background/90"
              onClick={() => zoomBy(1.6)}
              aria-label="Zoom in"
            >
              <Plus className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-7 bg-background/90"
              onClick={() => zoomBy(1 / 1.6)}
              aria-label="Zoom out"
            >
              <Minus className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-7 bg-background/90"
              onClick={reset}
              aria-label="Fit the whole network"
            >
              <RotateCcw className="size-3.5" />
            </Button>
          </div>
          <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/80 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {settling ? "Laying out… " : ""}Drag a node · Ctrl or ⌘ + scroll to zoom · drag the
            background to pan
          </p>
        </div>

        <aside className="space-y-3 text-sm" aria-live="polite">
          {sel ? (
            <DetailPanel
              node={sel}
              network={network}
              mdlInfo={mdlInfo}
              byId={byId}
              adjacency={adjacency}
              onPick={setSelected}
              onClose={() => setSelected(null)}
            />
          ) : (
            <Legend />
          )}
        </aside>
      </div>
    </div>
  );
}

function tooltipFor(x: GraphNode, links: number): TooltipContent {
  if (x.kind === "mdl")
    return {
      title: `MDL ${x.mdl}`,
      subtitle: x.label,
      rows: [
        {
          key: "s",
          label: "Status",
          value: x.status === "pending" ? "Pending" : x.status ? "Closed" : "Not recorded",
        },
        {
          key: "p",
          label: "Actions pending",
          value: x.pending === null || x.pending === undefined ? "Not recorded" : n(x.pending),
        },
        { key: "c", label: "Linked companies and products", value: n(links) },
      ],
      footer: "Click for the companies",
    };
  if (x.kind === "company")
    return {
      title: x.label,
      subtitle: `CIK ${x.cik}`,
      rows: [{ key: "m", label: "MDLs its filings link it to", value: n(links) }],
      footer: "Click for the MDLs",
    };
  return {
    title: x.label,
    subtitle: "MDL product group",
    rows: [{ key: "m", label: "MDL", value: String(x.mdl ?? "") }],
  };
}

function Legend() {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        How to read it
      </p>
      <ul className="space-y-1.5 text-xs">
        <LegendRow
          shape="circle"
          color={NODE_COLOR.pending}
          label="MDL, pending (size: actions pending)"
        />
        <LegendRow shape="circle" color={NODE_COLOR.closed} label="MDL, closed" />
        <LegendRow
          shape="square"
          color={NODE_COLOR.company}
          label="Company named as a defendant (size: MDLs linked)"
        />
        <LegendRow
          shape="diamond"
          color={NODE_COLOR.product}
          label="Product group tracked for the MDL"
        />
      </ul>
      <ul className="space-y-1.5 border-t pt-3 text-xs">
        {(["A", "B", "C", "product"] as const).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <svg width={28} height={8} aria-hidden>
              <line
                x1={1}
                x2={27}
                y1={4}
                y2={4}
                stroke="var(--chart-axis)"
                strokeWidth={TIER_STYLE[k]!.width + 0.4}
                strokeDasharray={TIER_STYLE[k]!.dash}
              />
            </svg>
            <span className="text-muted-foreground">{TIER_STYLE[k]!.label}</span>
          </li>
        ))}
      </ul>
      <p className="border-t pt-3 text-xs text-muted-foreground">
        A link means a company&apos;s SEC filing (10-K, 10-Q, 8-K) discusses the MDL as litigation
        against it. Subject-only links name the litigation without its number or caption and should
        be checked before use. Position on the canvas has no meaning; only the links do.
      </p>
    </div>
  );
}

function LegendRow({
  shape,
  color,
  label,
}: {
  shape: "circle" | "square" | "diamond";
  color: string;
  label: string;
}) {
  return (
    <li className="flex items-center gap-2">
      <svg width={14} height={14} viewBox="-7 -7 14 14" aria-hidden className="shrink-0">
        {shape === "circle" ? <circle r={5.5} fill={color} /> : null}
        {shape === "square" ? (
          <rect x={-5} y={-5} width={10} height={10} rx={1.5} fill={color} />
        ) : null}
        {shape === "diamond" ? <path d="M0,-6L6,0L0,6L-6,0Z" fill={color} /> : null}
      </svg>
      <span className="text-muted-foreground">{label}</span>
    </li>
  );
}

function DetailPanel({
  node,
  network,
  mdlInfo,
  byId,
  adjacency,
  onPick,
  onClose,
}: {
  node: GraphNode;
  network: Network;
  mdlInfo: Map<number, Network["mdls"][number]>;
  byId: Map<string, GraphNode>;
  adjacency: Map<string, Set<string>>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const head = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {node.kind === "mdl"
            ? `MDL ${node.mdl}`
            : node.kind === "company"
              ? "Company"
              : "Product group"}
        </p>
        <p className="font-semibold leading-snug">{node.label}</p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0"
        onClick={onClose}
        aria-label="Close details"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
  if (node.kind === "mdl") {
    const info = node.mdl !== undefined ? mdlInfo.get(node.mdl) : undefined;
    const links = network.links
      .filter((l) => l.mdl === node.mdl)
      .sort((a, b) => a.tier.localeCompare(b.tier) || a.company.localeCompare(b.company));
    return (
      <div className="space-y-3 rounded-md border p-3">
        {head}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            {info?.status === "pending" ? "Pending" : info?.status ? "Closed" : "Not recorded"}
          </dd>
          <dt className="text-muted-foreground">Actions pending</dt>
          <dd className="tabular-nums">
            {info?.pending === null || info?.pending === undefined
              ? "Not recorded"
              : n(info.pending)}
          </dd>
          <dt className="text-muted-foreground">District</dt>
          <dd>{info?.district ?? "Not recorded"}</dd>
        </dl>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            Defendants in SEC filings ({links.length})
          </p>
          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1 text-xs">
            {links.map((l) => (
              <li key={l.cik} className="flex items-baseline gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  onClick={() => onPick(`c:${l.cik}`)}
                >
                  {l.company}
                </button>
                <span className="shrink-0 text-muted-foreground" title={l.tierLabel}>
                  {l.tier === "C" ? "subject only" : l.tier === "B" ? "caption" : "number"}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {node.mdl !== undefined ? (
          <Link
            to="/matters/lens/$mdl"
            params={{ mdl: String(node.mdl) }}
            className="inline-block text-xs font-semibold underline underline-offset-2"
          >
            Open MDL {node.mdl}
          </Link>
        ) : null}
      </div>
    );
  }
  if (node.kind === "company") {
    const links = network.links.filter((l) => l.cik === node.cik).sort((a, b) => b.mdl - a.mdl);
    return (
      <div className="space-y-3 rounded-md border p-3">
        {head}
        <p className="text-xs text-muted-foreground">CIK {node.cik}</p>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            MDLs its filings discuss ({links.length})
          </p>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1 text-xs">
            {links.map((l) => {
              const m = mdlInfo.get(l.mdl);
              return (
                <li key={l.mdl}>
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => onPick(`m:${l.mdl}`)}
                  >
                    <span className="font-semibold tabular-nums">{l.mdl}</span>{" "}
                    {shortTitle(m?.title ?? "")}
                  </button>
                  <p className="text-muted-foreground">
                    {l.tierLabel}
                    {l.first ? ` · ${l.first.slice(0, 4)}` : ""}
                    {l.last && l.last.slice(0, 4) !== l.first?.slice(0, 4)
                      ? `–${l.last.slice(0, 4)}`
                      : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
        {node.cik ? (
          <Link
            to="/companies/$cik"
            params={{ cik: node.cik }}
            className="inline-block text-xs font-semibold underline underline-offset-2"
          >
            Open company profile
          </Link>
        ) : null}
      </div>
    );
  }
  const mdlNode = [...(adjacency.get(node.id) ?? [])]
    .map((id) => byId.get(id))
    .find((x) => x?.kind === "mdl");
  return (
    <div className="space-y-3 rounded-md border p-3">
      {head}
      {mdlNode ? (
        <button
          type="button"
          className="text-left text-xs hover:underline"
          onClick={() => onPick(mdlNode.id)}
        >
          MDL {mdlNode.mdl} · {mdlNode.label}
        </button>
      ) : null}
      {node.productId ? (
        <Link
          to="/safety/products/$id"
          params={{ id: node.productId }}
          className="block text-xs font-semibold underline underline-offset-2"
        >
          Open product profile
        </Link>
      ) : null}
    </div>
  );
}
