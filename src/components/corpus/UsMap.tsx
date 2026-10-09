import { useId, useMemo, useState } from "react";
import { Layers3, RotateCcw } from "lucide-react";
import { bboxOfPath, type GeoData } from "@/lib/corpus/geo";
import { canonicalState, stateFromGeometry } from "@/lib/corpus/stateHub";

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
};

/** Canonical FIPS identities; keyboard and pointer interactions share the same target. */
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
}: Props) {
  const [hover, setHover] = useState<{
    id: string;
    name: string;
    value: number | undefined;
  } | null>(null);
  const [boundaries, setBoundaries] = useState(false);
  const headingId = useId();
  const state = canonicalState(stateFips);
  const counties = useMemo(
    () => (state ? geo.counties.filter((c) => c.stateFips === state.fips) : geo.counties),
    [geo, state],
  );
  const max = Math.max(1, ...[...values.values()].filter((v) => Number.isFinite(v) && v >= 0));
  const viewBox = useMemo(() => {
    const shape = state ? geo.states.find((s) => stateFromGeometry(s)?.usps === state.usps) : null;
    if (!shape) return "0 0 975 610";
    const [x0, y0, x1, y1] = bboxOfPath(shape.d);
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return "0 0 975 610";
    const pad = Math.max(x1 - x0, y1 - y0) * 0.075;
    return `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`;
  }, [geo, state]);
  const fill = (value: number | undefined, active: boolean) =>
    active
      ? "var(--primary)"
      : value == null
        ? "#e9e9e5"
        : `hsl(164 15% ${89 - 27 * Math.sqrt(Math.max(0, value) / max)}%)`;
  function focus(id: string, name: string, value: number | undefined, usps?: string) {
    setHover({ id, name, value });
    if (usps) onHoverState?.(usps);
  }
  function leave() {
    setHover(null);
    onHoverState?.(null);
  }
  const keyboard = (event: React.KeyboardEvent, activate: () => void) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  };
  return (
    <div
      className="relative isolate overflow-hidden rounded-xl border border-border/60 bg-[#fafaf7]"
      data-testid="geography-map"
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        style={{
          backgroundImage: "radial-gradient(#d6dcd7 0.7px, transparent 0.7px)",
          backgroundSize: "14px 14px",
        }}
      />
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <span
          id={headingId}
          className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
        >
          {state ? state.name + " counties" : "United States · 50 states + D.C."}
        </span>
        {!state ? (
          <button
            type="button"
            onClick={() => setBoundaries((v) => !v)}
            aria-pressed={boundaries}
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface/90 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Layers3 className="size-3.5" />
            County boundaries
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground">{counties.length} mapped areas</span>
        )}
      </div>
      <svg
        viewBox={viewBox}
        className={`w-full p-3 ${state ? "h-72 sm:h-80" : "h-auto min-h-56"}`}
        role="group"
        aria-labelledby={headingId}
      >
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
                aria-label={`${c.name}, ${state.name}${value == null ? "" : `, ${value.toLocaleString()} ${valueLabel}`}`}
                aria-pressed={selectedCounty === c.id}
                className="outline-none transition-[fill,stroke] duration-150 focus:stroke-amber-600"
                vectorEffect="non-scaling-stroke"
                style={{
                  fill: fill(value, active),
                  stroke: active ? "#a07b32" : "#ffffff",
                  strokeWidth: active ? 1.8 : 0.65,
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
                  data-state={identity.usps}
                  data-fips={identity.fips}
                  role={onState ? "button" : undefined}
                  tabIndex={onState ? 0 : undefined}
                  aria-label={`Open ${identity.name}`}
                  aria-pressed={selectedState === identity.usps}
                  className="outline-none transition-[fill,stroke] duration-150 focus:stroke-amber-600"
                  vectorEffect="non-scaling-stroke"
                  style={{
                    fill: fill(value, active),
                    stroke: active ? "#a07b32" : "#ffffff",
                    strokeWidth: active ? 2 : 0.9,
                    cursor: onState ? "pointer" : "default",
                  }}
                  onMouseEnter={() => focus(identity.fips, identity.name, value, identity.usps)}
                  onMouseLeave={leave}
                  onFocus={() => focus(identity.fips, identity.name, value, identity.usps)}
                  onBlur={leave}
                  onClick={() => onState?.(identity.fips)}
                  onKeyDown={(e) => keyboard(e, () => onState?.(identity.fips))}
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
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-surface/80 px-4 py-2.5 text-xs">
        <div aria-live="polite" aria-atomic="true">
          {hover ? (
            <>
              <span className="font-semibold">{hover.name}</span>
              <span className="ml-2 text-muted-foreground">
                {hover.value == null
                  ? "Count not recorded"
                  : `${hover.value.toLocaleString()} ${valueLabel}`}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Choose a {state ? "county" : "state"} on the map or use the searchable list.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span
            className="h-2 w-14 rounded-full"
            style={{ background: "linear-gradient(90deg,hsl(164 15% 89%),hsl(164 15% 62%))" }}
          />
          Directory records
          {boundaries ? (
            <button
              type="button"
              aria-label="Reset map layers"
              onClick={() => setBoundaries(false)}
              className="ml-1 rounded p-1 hover:bg-muted"
            >
              <RotateCcw className="size-3" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
