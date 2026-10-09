import { useId, useMemo, useState } from "react";
import { Layers3 } from "lucide-react";
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
  compact?: boolean;
};
/** Source geometry retains canonical FIPS identity. Display intensity never represents legal completeness. */
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
    const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
    return `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`;
  }, [geo, state]);
  const fill = (v: number | undefined, active: boolean) =>
    active
      ? "var(--map-active)"
      : v == null || !Number.isFinite(v)
        ? "var(--map-low)"
        : `color-mix(in srgb,var(--map-high) ${Math.round(12 + 78 * Math.sqrt(Math.max(0, v) / max))}%,var(--map-low))`;
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
  return (
    <div
      className="atlas-map relative isolate overflow-hidden rounded-lg border border-border"
      data-testid="geography-map"
      data-compact={compact}
    >
      <div className="research-band !py-2.5">
        <span id={headingId} className="text-xs font-medium">
          {state ? `${state.name} counties` : "Explore the United States"}
        </span>
        {!state ? (
          <button
            type="button"
            onClick={() => setBoundaries((v) => !v)}
            aria-pressed={boundaries}
            className="flex items-center gap-1.5 rounded border border-white/30 px-2 py-1 text-[11px] text-white hover:bg-white/10"
          >
            <Layers3 className="size-3.5" aria-hidden />
            County boundaries
          </button>
        ) : (
          <span className="text-[11px] text-[var(--navy-muted)]">{counties.length} areas</span>
        )}
      </div>
      <svg
        viewBox={viewBox}
        className={`w-full p-3 ${state ? "h-72 sm:h-80" : "h-auto min-h-52"}`}
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
                  data-state={identity.usps}
                  data-fips={identity.fips}
                  role={onState ? "button" : undefined}
                  tabIndex={onState ? 0 : undefined}
                  aria-label={`Open ${identity.name}`}
                  aria-pressed={onState ? selectedState === identity.usps : undefined}
                  className="outline-none transition-[fill,stroke] duration-150"
                  vectorEffect="non-scaling-stroke"
                  style={{
                    fill: fill(value, active),
                    stroke: active ? "var(--map-focus)" : "#ffffff",
                    strokeWidth: active ? 2.2 : 0.9,
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
      <div className="map-footer flex min-h-10 flex-wrap items-center justify-between gap-2 border-t border-border bg-surface/80 px-3 py-2 text-[11px]">
        <div aria-live="polite" aria-atomic="true">
          {hover ? (
            <>
              <span className="font-semibold">{hover.name}</span>
              {hover.value != null ? (
                <span className="ml-2 text-muted-foreground">
                  {hover.value.toLocaleString()} {valueLabel}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">
              Select a {state ? "county" : "state"} to open its resources.
            </span>
          )}
        </div>
        {values.size > 0 ? (
          <span
            className="flex items-center gap-2 text-muted-foreground"
            title="Shading represents recorded resource counts, not completeness or caseload."
          >
            <span
              className="h-1.5 w-14 rounded-full"
              style={{ background: "linear-gradient(90deg,var(--map-low),var(--map-high))" }}
            />
            {valueLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
