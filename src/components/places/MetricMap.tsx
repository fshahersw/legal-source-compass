import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import "d3-transition";
import type { GeoData } from "@/lib/corpus/geo";
import { stateFromGeometry } from "@/lib/corpus/stateHub";
import {
  classIndex,
  competitionRank,
  formatMapValue,
  quantileBreaks,
  type MapFormat,
} from "@/lib/external/mapMetricsModel";
import { legendClasses, readout, shadeOf, type Readout } from "./mapView";
import { TILE_BY_USPS, TILE_COLS, TILE_ROWS, tileInk } from "./tileGrid";
import { cn } from "@/lib/utils";

export type MapArea = {
  /** Values keyed by state FIPS (states) or five-digit FIPS (counties). */
  values: Record<string, number>;
  /** Sentence behind each state's number (numerator and denominator); optional. */
  detail?: Record<string, string>;
  format: MapFormat;
  unit: string;
  yearLabel: string;
};

type Tip = { x: number; y: number; read: Readout; id: string };
const RANK_SCOPE_STATES = "states and DC";
const RANK_SCOPE_COUNTIES = "counties";
/** Tile cell in viewBox units: 11 × 88 by 8 × 76 keeps the tile view the same shape as the geographic map. */
const CELL_W = 88;
const CELL_H = 76;
const TILE_GAP = 5;
const INK = { low: "var(--map-ink-low)", high: "var(--map-ink-high)", none: "var(--foreground)" };

const fillFor = (shade: number | null, hatch: string) =>
  shade == null ? `url(#${hatch})` : `color-mix(in srgb,var(--map-high) ${shade}%,var(--map-low))`;

/** Counties are drawn as one memoised group so a hover over a state or the tooltip never repaints 3,000 paths. */
const CountyPaths = memo(function CountyPaths({
  shapes,
  onPointer,
  onLeave,
  onPick,
}: {
  shapes: { id: string; d: string; fill: string }[];
  onPointer: (e: React.MouseEvent<SVGGElement>) => void;
  onLeave: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <g
      data-layer="counties"
      onMouseMove={onPointer}
      onMouseLeave={onLeave}
      onClick={(e) => {
        const id = (e.target as SVGElement).getAttribute("data-county");
        if (id) onPick(id);
      }}
    >
      {shapes.map((s) => (
        <path
          key={s.id}
          d={s.d}
          data-county={s.id}
          style={{ fill: s.fill, stroke: "var(--surface)", strokeWidth: 0.25, cursor: "pointer" }}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
});

/**
 * Choropleth of one honest metric. States by default; with a county layer, counties shaded by their own quantile classes.
 * The state layer can also be read as equal-size tiles, so small states and DC are as visible as large ones.
 * Missing values are hatched and counted in the legend, never drawn as the lowest class. Every state is a focusable
 * button; counties are reached by pointer, and the "show data" table beside the map lists every area for keyboard and
 * screen-reader use.
 */
export function MetricMap({
  geo,
  title,
  states,
  counties,
  countyNames,
  selectedState,
  onState,
  onCounty,
  onHoverState,
  stateAction = "Open",
}: {
  geo: GeoData;
  title: string;
  states: MapArea;
  /** When set, the county layer is shown instead of the state shading. */
  counties: MapArea | null;
  countyNames: Map<string, string>;
  selectedState?: string | undefined;
  onState: (fips: string) => void;
  onCounty: (fips: string) => void;
  onHoverState?: (usps: string | null) => void;
  stateAction?: string;
}) {
  const hatch = useId().replace(/:/g, "");
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [view, setView] = useState<"map" | "tiles">("map");
  const showCounties = counties != null;
  const tiles = view === "tiles" && !showCounties;
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [k, setK] = useState(1);
  const [transform, setTransform] = useState("");
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 12])
      .translateExtent([
        [0, 0],
        [975, 610],
      ])
      .filter((e: Event) =>
        e.type === "wheel"
          ? (e as WheelEvent).ctrlKey || (e as WheelEvent).metaKey
          : !(e as MouseEvent).button,
      )
      .on("zoom", (e) => {
        setTransform(e.transform.toString());
        setK(e.transform.k);
      });
    zoomRef.current = z;
    select(svg).call(z).on("dblclick.zoom", null);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);
  function zoomBy(f: number) {
    const svg = svgRef.current;
    if (svg && zoomRef.current)
      select(svg).transition().duration(300).call(zoomRef.current.scaleBy, f);
  }

  function fitTo(el: SVGGraphicsElement) {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    const b = el.getBBox();
    const scale = Math.min(12, 0.85 / Math.max(b.width / 975, b.height / 610));
    const t = zoomIdentity
      .translate(975 / 2, 610 / 2)
      .scale(scale)
      .translate(-(b.x + b.width / 2), -(b.y + b.height / 2));
    select(svg).transition().duration(600).call(zoomRef.current.transform, t);
  }
  function resetZoom() {
    const svg = svgRef.current;
    if (svg && zoomRef.current)
      select(svg).transition().duration(400).call(zoomRef.current.transform, zoomIdentity);
  }

  // state shading and ranks (ranked over the 50 states and DC; the map draws no other area)
  const stateIdentity = useMemo(
    () =>
      geo.states.flatMap((shape) => {
        const id = stateFromGeometry(shape);
        return id ? [{ shape, id }] : [];
      }),
    [geo],
  );
  const stateFips = useMemo(() => stateIdentity.map((s) => s.id.fips), [stateIdentity]);
  const stateRank = useMemo(
    () => competitionRank(states.values, stateFips),
    [states.values, stateFips],
  );
  const stateClasses = useMemo(
    () =>
      legendClasses(
        stateFips.flatMap((f) => (f in states.values ? [states.values[f]!] : [])),
        states.format,
      ),
    [stateFips, states],
  );
  const stateBreaks = useMemo(() => stateClasses.map((c) => c.hi), [stateClasses]);

  // county shading and national county ranks
  const countyIds = useMemo(() => geo.counties.map((c) => c.id), [geo]);
  const countyRank = useMemo(
    () => (counties ? competitionRank(counties.values, countyIds) : {}),
    [counties, countyIds],
  );
  const countyClasses = useMemo(
    () =>
      counties
        ? legendClasses(
            countyIds.flatMap((id) => (id in counties.values ? [counties.values[id]!] : [])),
            counties.format,
          )
        : [],
    [counties, countyIds],
  );
  const countyShapes = useMemo(() => {
    if (!counties) return [];
    const breaks = quantileBreaks(
      countyIds.flatMap((id) => (id in counties.values ? [counties.values[id]!] : [])),
      5,
    );
    return geo.counties.map((c) => {
      const i = classIndex(counties.values[c.id], breaks);
      return {
        id: c.id,
        d: c.d,
        fill: fillFor(i == null ? null : shadeOf(i, breaks.length), hatch),
      };
    });
  }, [geo, counties, countyIds, hatch]);

  const active = showCounties ? counties : states;
  const classes = showCounties ? countyClasses : stateClasses;
  const missing = showCounties
    ? geo.counties.filter((c) => !(c.id in counties.values)).length
    : stateFips.filter((f) => !(f in states.values)).length;

  function place(clientX: number, clientY: number) {
    const rect = box.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 };
  }
  function stateRead(fips: string, name: string): Readout {
    return readout({
      name,
      value: states.values[fips],
      format: states.format,
      unit: states.unit,
      rank: stateRank[fips],
      rankScope: RANK_SCOPE_STATES,
      detail: states.detail?.[fips],
    });
  }
  function countyRead(id: string): Readout {
    const name = countyNames.get(id) ?? id;
    return readout({
      name,
      value: counties?.values[id],
      format: counties!.format,
      unit: counties!.unit,
      rank: countyRank[id],
      rankScope: RANK_SCOPE_COUNTIES,
    });
  }

  /** Pointer, focus and keyboard behaviour shared by a state's map path and its tile. */
  function stateProps(
    id: { fips: string; usps: string; name: string },
    read: Readout,
    isSelected: boolean,
  ) {
    return {
      "data-state": id.usps,
      "data-fips": id.fips,
      role: "button",
      tabIndex: 0,
      "aria-label": `${stateAction} ${id.name}. ${read.value}${read.rank ? `. ${read.rank}` : ""}`,
      "aria-pressed": isSelected,
      onMouseEnter: (e: React.MouseEvent<SVGElement>) => {
        const p = place(e.clientX, e.clientY);
        setTip({ ...p, read, id: id.fips });
        onHoverState?.(id.usps);
      },
      onMouseMove: (e: React.MouseEvent<SVGElement>) => {
        const p = place(e.clientX, e.clientY);
        setTip((t) => (t && t.id === id.fips ? { ...t, ...p } : t));
      },
      onMouseLeave: () => {
        setTip(null);
        onHoverState?.(null);
      },
      onFocus: (e: React.FocusEvent<SVGElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const p = place(r.left + r.width / 2, r.top + r.height / 2);
        setTip({ ...p, read, id: id.fips });
        onHoverState?.(id.usps);
      },
      onBlur: () => {
        setTip(null);
        onHoverState?.(null);
      },
      onClick: () => onState(id.fips),
      onKeyDown: (e: React.KeyboardEvent<SVGElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onState(id.fips);
        }
      },
    } as const;
  }

  const shapes = stateIdentity.map(({ shape, id }) => {
    const value = states.values[id.fips];
    const idx = classIndex(value, stateBreaks);
    const isSelected = selectedState === id.usps;
    const read = stateRead(id.fips, id.name);
    return { shape, id, value, idx, isSelected, read };
  });

  return (
    <div
      ref={box}
      className="atlas-map relative isolate overflow-hidden rounded-lg border border-border"
      data-testid="geography-map"
      data-layer={showCounties ? "counties" : "states"}
    >
      <div className="research-band !py-2.5">
        <span id={titleId} className="truncate text-xs font-medium">
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          {active.yearLabel} · {active.unit}
          {!showCounties ? (
            <span
              role="group"
              aria-label="Map view"
              className="flex rounded-md border border-border bg-muted p-px"
            >
              {(["map", "tiles"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => {
                    setTip(null);
                    setView(v);
                  }}
                  className={cn(
                    "rounded-[5px] px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    view === v
                      ? "bg-surface font-medium text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v === "map" ? "Map" : "Tiles"}
                </button>
              ))}
            </span>
          ) : null}
        </span>
      </div>
      {/* one hatch pattern for both views and the legend (a pattern inside a hidden svg would not paint) */}
      <svg width="0" height="0" aria-hidden className="absolute">
        <defs>
          <pattern
            id={hatch}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--muted)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="var(--muted-foreground)"
              strokeOpacity="0.45"
              strokeWidth="1.5"
            />
          </pattern>
        </defs>
      </svg>
      <div
        className={cn(
          "absolute right-2 top-11 z-10 flex flex-col overflow-hidden rounded-md border border-border bg-popover text-xs shadow-sm",
          tiles && "hidden",
        )}
      >
        <button
          type="button"
          aria-label="Zoom in"
          className="px-2 py-1 hover:bg-muted"
          onClick={() => zoomBy(1.6)}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          className="border-t border-border px-2 py-1 hover:bg-muted"
          onClick={() => zoomBy(1 / 1.6)}
        >
          −
        </button>
        {k > 1.01 ? (
          <button
            type="button"
            aria-label="Reset zoom"
            className="border-t border-border px-2 py-1 hover:bg-muted"
            onClick={resetZoom}
          >
            ⟲
          </button>
        ) : null}
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 975 610"
        className="h-auto min-h-52 w-full p-3"
        style={tiles ? { display: "none" } : undefined}
        role="group"
        aria-labelledby={titleId}
        data-view="map"
      >
        <g transform={transform}>
          {showCounties ? (
            <>
              <CountyPaths
                shapes={countyShapes}
                onPointer={(e) => {
                  const id = (e.target as SVGElement).getAttribute("data-county");
                  if (!id) return setTip(null);
                  const p = place(e.clientX, e.clientY);
                  setTip((t) =>
                    t?.id === id && Math.abs(t.x - p.x) + Math.abs(t.y - p.y) < 3
                      ? t
                      : { ...p, read: countyRead(id), id },
                  );
                }}
                onLeave={() => setTip(null)}
                onPick={onCounty}
              />
              <path
                d={geo.stateBorders}
                className="pointer-events-none"
                style={{ fill: "none", stroke: "var(--surface)", strokeWidth: 1.1 }}
              />
            </>
          ) : (
            shapes.map(({ shape, id, value, idx, isSelected, read }) => (
              <path
                key={id.fips}
                d={shape.d}
                {...(tiles ? {} : stateProps(id, read, isSelected))}
                className="outline-none transition-[stroke] duration-150 focus-visible:[stroke:var(--map-focus)] focus-visible:[stroke-width:2.4]"
                vectorEffect="non-scaling-stroke"
                style={{
                  fill: fillFor(
                    idx == null || value == null ? null : shadeOf(idx, stateBreaks.length),
                    hatch,
                  ),
                  stroke: isSelected ? "var(--map-active)" : "var(--surface)",
                  strokeWidth: isSelected ? 2.4 : 0.9,
                  cursor: "pointer",
                }}
              >
                <title>{`${id.name}: ${read.value}`}</title>
              </path>
            ))
          )}
        </g>
      </svg>
      {tiles ? (
        <svg
          viewBox={`0 0 ${TILE_COLS * CELL_W} ${TILE_ROWS * CELL_H}`}
          className="h-auto min-h-52 w-full p-3"
          role="group"
          aria-labelledby={titleId}
          data-view="tiles"
        >
          {shapes.map(({ id, value, idx, isSelected, read }) => {
            const t = TILE_BY_USPS.get(id.usps);
            if (!t) return null;
            const shade = idx == null || value == null ? null : shadeOf(idx, stateBreaks.length);
            const x = t.col * CELL_W + TILE_GAP / 2;
            const y = t.row * CELL_H + TILE_GAP / 2;
            const w = CELL_W - TILE_GAP;
            const h = CELL_H - TILE_GAP;
            const ink = INK[tileInk(shade)];
            return (
              <g
                key={id.fips}
                {...stateProps(id, read, isSelected)}
                className="group cursor-pointer outline-none"
              >
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={7}
                  stroke={isSelected ? "var(--map-active)" : "var(--surface)"}
                  strokeWidth={isSelected ? 3 : 1}
                  style={{ fill: fillFor(shade, hatch) }}
                  className="transition-[stroke] duration-150 group-hover:[stroke:var(--map-active)] group-focus-visible:[stroke:var(--map-focus)] group-focus-visible:[stroke-width:3]"
                />
                <text
                  x={x + w / 2}
                  y={y + h / 2 + (value == null ? 6 : -2)}
                  textAnchor="middle"
                  fontSize={19}
                  fontWeight={600}
                  fill={ink}
                  className="pointer-events-none select-none"
                >
                  {id.usps}
                </text>
                {value != null ? (
                  <text
                    x={x + w / 2}
                    y={y + h / 2 + 17}
                    textAnchor="middle"
                    fontSize={12.5}
                    fill={ink}
                    fillOpacity={0.85}
                    className="pointer-events-none select-none tabular-nums max-sm:hidden"
                  >
                    {formatMapValue(value, states.format)}
                  </text>
                ) : null}
                <title>{`${id.name}: ${read.value}`}</title>
              </g>
            );
          })}
        </svg>
      ) : null}
      {tip ? (
        <div
          aria-hidden
          data-testid="map-tooltip"
          className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] leading-4 text-popover-foreground shadow-md"
          style={{
            left: Math.min(Math.max(tip.x + 12, 4), (box.current?.clientWidth ?? 600) - 260),
            top: Math.max(tip.y - 8, 28),
          }}
        >
          <div className="font-semibold">{tip.read.name}</div>
          <div className="font-mono tabular-nums">{tip.read.value}</div>
          {tip.read.rank ? <div className="text-muted-foreground">{tip.read.rank}</div> : null}
          {tip.read.detail ? (
            <div className="mt-0.5 text-muted-foreground">{tip.read.detail}</div>
          ) : null}
        </div>
      ) : null}
      <div className="map-footer flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-border bg-surface/80 px-3 py-2 text-[11px]">
        <div aria-live="polite" aria-atomic="true" className="min-w-0 basis-full">
          {tip ? (
            <>
              <span className="font-semibold">{tip.read.name}</span>
              <span className="ml-2 text-muted-foreground">
                {tip.read.value}
                {tip.read.rank ? ` · ${tip.read.rank}` : ""}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {showCounties
                ? "Hover a county for its value; select one to open its page."
                : tiles
                  ? "Every state is the same size here. Select one to open it."
                  : "Select a state to open it. Ctrl + scroll or the buttons zoom, drag to pan."}
            </span>
          )}
        </div>
        <ul
          data-testid="map-legend"
          aria-label={`Legend: ${active.unit}, ${active.yearLabel}`}
          className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 text-muted-foreground"
        >
          {classes.map((c) => (
            <li
              key={c.index}
              className="flex items-center gap-1.5"
              title={`${c.count} ${showCounties ? "counties" : "areas"}`}
            >
              <span
                aria-hidden
                className="inline-block h-2.5 w-4 rounded-sm border border-border/60"
                style={{
                  background: `color-mix(in srgb,var(--map-high) ${c.shade}%,var(--map-low))`,
                }}
              />
              <span className="font-mono tabular-nums">{c.label}</span>
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <svg width="16" height="10" aria-hidden>
              <rect width="16" height="10" fill={`url(#${hatch})`} stroke="var(--border)" />
            </svg>
            Not recorded{missing ? ` (${missing})` : ""}
          </li>
        </ul>
      </div>
    </div>
  );
}
