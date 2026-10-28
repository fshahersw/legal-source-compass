import { useId, useMemo, useState } from "react";
import { Layers3 } from "lucide-react";
import { bboxOfPath, type GeoData } from "@/lib/corpus/geo";
import { canonicalState, stateFromGeometry } from "@/lib/corpus/stateHub";
import { TILE_BY_USPS, TILE_COLS, TILE_ROWS, tileInk } from "@/components/places/tileGrid";

type Props = {
  geo: GeoData;
  values: Map<string, number>;
  valueLabel: string;
  stateFips?: string;
  onState?: (fips: string) => void;
  onCounty?: (fips: string) => void;
  selectedCounty?: string | undefined;
  selectedState?: string | undefined;
  onHoverState?: (usps: string | null) => void;
  compact?: boolean;
  /** Band heading; defaults to "Explore the United States" or "<State> counties". */
  heading?: string;
  /** Footer prompt shown when nothing is hovered; defaults to the resource-navigation prompt. */
  hint?: string;
  /** Verb used in each state's accessible name, e.g. "Filter to"; defaults to "Open". */
  stateAction?: string;
  /** Formats values in the hover readout, accessible names and legend ends. */
  formatValue?: (value: number) => string;
  /** Tooltip on the legend explaining what shading means. */
  legendNote?: string;
  /**
   * What a state or county absent from `values` means. "zero" (default): nothing recorded there, drawn in the lowest
   * shade (record counts). "unrecorded": the figure is not recorded (rates, shares), drawn hatched, never as the
   * lowest value.
   */
  missing?: "zero" | "unrecorded";
};
const plainNumber = (value: number) => value.toLocaleString();
/** Tile cell in viewBox units, the same shape as the national map's 975 × 610 frame. */
const CELL_W = 88;
const CELL_H = 76;
const TILE_GAP = 5;
const INK = { low: "var(--map-ink-low)", high: "var(--map-ink-high)", none: "var(--foreground)" };

/**
 * Source geometry retains canonical FIPS identity. Display intensity never represents legal completeness. The national
 * view also has an equal-area tile mode (every state the same size) so small states read as clearly as large ones.
 */
export function UsMap({
  geo,
  values,
  valueLabel,
  stateFips,
  onState,
  onCounty,
  selectedCounty,
  selectedState,
  onHoverState,
  compact = false,
  heading,
  hint,
  stateAction = "Open",
  formatValue = plainNumber,
  legendNote = "Shading represents recorded resource counts, not completeness or caseload.",
  missing = "zero",
}: Props) {
  const [hover, setHover] = useState<{
    id: string;
    name: string;
    value: number | undefined;
  } | null>(null);
  const [boundaries, setBoundaries] = useState(false);
  const [view, setView] = useState<"map" | "tiles">("map");
  const headingId = useId();
  const hatch = `usmap-hatch-${useId().replace(/:/g, "")}`;
  const state = canonicalState(stateFips);
  const counties = useMemo(
    () => (state ? geo.counties.filter((c) => c.stateFips === state.fips) : geo.counties),
    [geo, state],
  );
  const finite = [...values.values()].filter((v) => Number.isFinite(v) && v >= 0);
  const max = Math.max(1, ...finite);
  const recordedMax = finite.length ? Math.max(...finite) : null;
  const viewBox = useMemo(() => {
    const shape = state ? geo.states.find((s) => stateFromGeometry(s)?.usps === state.usps) : null;
    if (!shape) return "0 0 975 610";
    const [x0, y0, x1, y1] = bboxOfPath(shape.d);
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return "0 0 975 610";
    const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
    return `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`;
  }, [geo, state]);
  const known = (v: number | undefined): v is number => v != null && Number.isFinite(v);
  /** Ramp position 12–90 (percent of the high colour), or null when the value is not recorded. */
  const shadeOf = (v: number | undefined): number | null =>
    known(v)
      ? Math.round(12 + 78 * Math.sqrt(Math.max(0, v) / max))
      : missing === "unrecorded"
        ? null
        : 12;
  const fill = (v: number | undefined, active: boolean) => {
    if (active) return "var(--map-active)";
    const shade = shadeOf(v);
    if (shade == null) return `url(#${hatch})`;
    return known(v)
      ? `color-mix(in srgb,var(--map-high) ${shade}%,var(--map-low))`
      : "var(--map-low)";
  };
  const tiles = !state && view === "tiles";
  const hasMissing =
    missing === "unrecorded" &&
    (state
      ? counties.some((c) => !known(values.get(c.id)))
      : geo.states.some((s) => {
          const id = stateFromGeometry(s);
          return !!id && TILE_BY_USPS.has(id.usps) && !known(values.get(id.fips));
        }));
  const offGrid = !state
    ? geo.states.filter((s) => {
        const id = stateFromGeometry(s);
        return id && !TILE_BY_USPS.has(id.usps) && known(values.get(id.fips));
      }).length
    : 0;
  function focus(id: string, name: string, value: number | undefined, usps?: string) {
    setHover({ id, name, value });
    if (usps) onHoverState?.(usps);
  }
  function leave() {
    setHover(null);
    onHoverState?.(null);
  }
  function keyboard(e: React.KeyboardEvent, activate: () => void) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  }
  /** Interaction and accessible name shared by a state's map path and its tile. */
  const stateProps = (identity: { fips: string; usps: string; name: string }, value?: number) => ({
    "data-state": identity.usps,
    "data-fips": identity.fips,
    role: onState ? "button" : undefined,
    tabIndex: onState ? 0 : undefined,
    "aria-label": `${stateAction} ${identity.name}${known(value) ? `, ${formatValue(value)} ${valueLabel}` : missing === "unrecorded" ? ", not recorded" : ""}`,
    "aria-pressed": onState ? selectedState === identity.usps : undefined,
    onMouseEnter: () => focus(identity.fips, identity.name, value, identity.usps),
    onMouseLeave: leave,
    onFocus: () => focus(identity.fips, identity.name, value, identity.usps),
    onBlur: leave,
    onClick: () => onState?.(identity.fips),
    onKeyDown: (e: React.KeyboardEvent) => keyboard(e, () => onState?.(identity.fips)),
  });
  const hatchDef =
    missing === "unrecorded" ? (
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
    ) : null;
  const bandButton =
    "rounded border px-2 py-1 text-[11px] focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <div
      className="atlas-map relative isolate overflow-hidden rounded-lg border border-border"
      data-testid="geography-map"
      data-compact={compact}
    >
      <div className="research-band !py-2.5">
        <span id={headingId} className="text-xs font-medium">
          {heading ?? (state ? `${state.name} counties` : "Explore the United States")}
        </span>
        {!state ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <div role="group" aria-label="Map view" className="flex gap-0.5">
              {(["map", "tiles"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  title={v === "tiles" ? "Every state the same size" : "Geographic map"}
                  className={`${bandButton} ${
                    view === v
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {v === "map" ? "Map" : "Tiles"}
                </button>
              ))}
            </div>
            {!tiles ? (
              <button
                type="button"
                onClick={() => setBoundaries((v) => !v)}
                aria-pressed={boundaries}
                className={`flex items-center gap-1.5 ${bandButton} border-border text-foreground hover:bg-accent`}
              >
                <Layers3 className="size-3.5" aria-hidden />
                County boundaries
              </button>
            ) : null}
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground">{counties.length} areas</span>
        )}
      </div>
      {tiles ? (
        <svg
          viewBox={`0 0 ${TILE_COLS * CELL_W} ${TILE_ROWS * CELL_H}`}
          className="h-auto min-h-52 w-full p-3"
          role="group"
          aria-labelledby={headingId}
          data-view="tiles"
        >
          {hatchDef}
          {geo.states.map((shape) => {
            const identity = stateFromGeometry(shape);
            const t = identity ? TILE_BY_USPS.get(identity.usps) : undefined;
            if (!identity || !t) return null;
            const value = values.get(identity.fips);
            const active = selectedState === identity.usps || hover?.id === identity.fips;
            const shade = shadeOf(value);
            // Tiles keep their value shade when active (the outline marks them), so the label ink stays legible.
            const ink = INK[tileInk(known(value) ? shade : null)];
            const x = t.col * CELL_W + TILE_GAP / 2;
            const y = t.row * CELL_H + TILE_GAP / 2;
            const w = CELL_W - TILE_GAP;
            const h = CELL_H - TILE_GAP;
            return (
              <g
                key={identity.fips}
                {...stateProps(identity, value)}
                className="group outline-none"
                style={{ cursor: onState ? "pointer" : "default" }}
              >
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={7}
                  stroke={active ? "var(--map-focus)" : "var(--surface)"}
                  strokeWidth={active ? 3 : 1}
                  style={{ fill: fill(value, false) }}
                  className="transition-[fill,stroke] duration-150 group-focus-visible:[stroke:var(--map-focus)] group-focus-visible:[stroke-width:3]"
                />
                <text
                  x={x + w / 2}
                  y={y + h / 2 + (known(value) ? -2 : 6)}
                  textAnchor="middle"
                  fontSize={19}
                  fontWeight={600}
                  fill={ink}
                  className="pointer-events-none select-none"
                >
                  {identity.usps}
                </text>
                {known(value) ? (
                  <text
                    x={x + w / 2}
                    y={y + h / 2 + 17}
                    textAnchor="middle"
                    fontSize={12.5}
                    fill={ink}
                    fillOpacity={0.85}
                    className="pointer-events-none select-none tabular-nums max-sm:hidden"
                  >
                    {formatValue(value)}
                  </text>
                ) : null}
                <title>{identity.name}</title>
              </g>
            );
          })}
        </svg>
      ) : (
        <svg
          viewBox={viewBox}
          className={`w-full p-3 ${state ? "h-72 sm:h-80" : "h-auto min-h-52"}`}
          role="group"
          aria-labelledby={headingId}
        >
          {hatchDef}
          {state ? (
            counties.map((c) => {
              const value = values.get(c.id),
                active = selectedCounty === c.id || hover?.id === c.id;
              return (
                <path
                  key={c.id}
                  d={c.d}
                  data-county={c.id}
                  role={onCounty ? "button" : undefined}
                  tabIndex={onCounty ? 0 : undefined}
                  aria-label={`${c.name}, ${state.name}${value == null ? "" : `, ${formatValue(value)} ${valueLabel}`}`}
                  aria-pressed={onCounty ? selectedCounty === c.id : undefined}
                  className="outline-none transition-[fill,stroke] duration-150"
                  vectorEffect="non-scaling-stroke"
                  style={{
                    fill: fill(value, active),
                    stroke: active ? "var(--map-focus)" : "#ffffff",
                    strokeWidth: active ? 2 : 0.7,
                    cursor: onCounty ? "pointer" : "default",
                  }}
                  onMouseEnter={() => focus(c.id, c.name, value)}
                  onMouseLeave={leave}
                  onFocus={() => focus(c.id, c.name, value)}
                  onBlur={leave}
                  onClick={() => onCounty?.(c.id)}
                  onKeyDown={(e) => keyboard(e, () => onCounty?.(c.id))}
                >
                  <title>{c.name}</title>
                </path>
              );
            })
          ) : (
            <>
              {geo.states.map((shape) => {
                const identity = stateFromGeometry(shape);
                if (!identity) return null;
                const value = values.get(identity.fips),
                  active = selectedState === identity.usps || hover?.id === identity.fips;
                return (
                  <path
                    key={identity.fips}
                    d={shape.d}
                    {...stateProps(identity, value)}
                    className="outline-none transition-[fill,stroke] duration-150"
                    vectorEffect="non-scaling-stroke"
                    style={{
                      fill: fill(value, active),
                      stroke: active ? "var(--map-focus)" : "#ffffff",
                      strokeWidth: active ? 2.2 : 0.9,
                      cursor: onState ? "pointer" : "default",
                    }}
                  >
                    <title>{identity.name}</title>
                  </path>
                );
              })}
              {boundaries ? (
                <path
                  d={counties.map((c) => c.d).join("")}
                  className="pointer-events-none fill-none stroke-white/60"
                  style={{ strokeWidth: 0.2 }}
                />
              ) : null}
            </>
          )}
        </svg>
      )}
      <div className="map-footer flex min-h-10 flex-wrap items-center justify-between gap-2 border-t border-border bg-surface/80 px-3 py-2 text-[11px]">
        <div aria-live="polite" aria-atomic="true">
          {hover ? (
            <>
              <span className="font-semibold">{hover.name}</span>
              {known(hover.value) ? (
                <span className="ml-2 text-muted-foreground">
                  {formatValue(hover.value)} {valueLabel}
                </span>
              ) : values.size > 0 ? (
                <span className="ml-2 text-muted-foreground">Not recorded</span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">
              {hint ?? `Select a ${state ? "county" : "state"} to open its resources.`}
              {tiles && offGrid
                ? ` ${offGrid} area${offGrid === 1 ? "" : "s"} outside the 50 states and DC appear on the map view only.`
                : ""}
            </span>
          )}
        </div>
        {recordedMax != null ? (
          <span
            className="flex items-center gap-1.5 text-muted-foreground"
            title={legendNote}
            data-testid="map-legend"
          >
            <span className="font-mono tabular-nums">{formatValue(0)}</span>
            <span
              aria-hidden
              className="h-1.5 w-14 rounded-full"
              style={{ background: "linear-gradient(90deg,var(--map-low),var(--map-high))" }}
            />
            <span className="font-mono tabular-nums">{formatValue(recordedMax)}</span>
            <span>{valueLabel}</span>
            {hasMissing ? (
              <span className="ml-1 inline-flex items-center gap-1">
                <svg aria-hidden width="12" height="10" className="rounded-sm">
                  <rect width="12" height="10" fill="var(--muted)" />
                  <path
                    d="M-2 10 L8 0 M4 10 L14 0"
                    stroke="var(--muted-foreground)"
                    strokeOpacity="0.45"
                    strokeWidth="1.5"
                  />
                </svg>
                Not recorded
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
