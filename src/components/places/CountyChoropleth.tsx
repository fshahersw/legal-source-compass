import { useId, useMemo, useState } from "react";
import { bboxOfPath, type GeoData } from "@/lib/corpus/geo";
import { canonicalState, stateFromGeometry } from "@/lib/corpus/stateHub";
import {
  classBreaks,
  classOf,
  classShade,
  formatPlaceValue,
  NOT_RECORDED,
  type PlaceFormat,
} from "./placeMetrics";

/**
 * Counties of one state shaded by quantile class of one measure. A county with no value is hatched and listed as
 * "Not recorded" in the legend, so a missing value is never read as the lowest class. Counties whose geometry predates a
 * boundary change (Connecticut's planning regions, Alaska's 2019 split) simply have no value.
 */
export function CountyChoropleth({
  geo,
  usps,
  values,
  format,
  unit,
  title,
  selected,
  onCounty,
  flagged,
}: {
  geo: GeoData;
  usps: string;
  /** Keyed by county FIPS. */
  values: Map<string, number | null>;
  format: PlaceFormat;
  unit: string;
  title: string;
  selected?: string | undefined;
  onCounty: (fips: string) => void;
  /** Counties whose value rests on a small base: drawn with a dotted outline. */
  flagged?: ReadonlySet<string>;
}) {
  const hatchId = useId().replace(/:/g, "");
  const headingId = useId();
  const [hover, setHover] = useState<{ id: string; name: string; value: number | null } | null>(
    null,
  );
  const state = canonicalState(usps);
  const counties = useMemo(
    () => (state ? geo.counties.filter((c) => c.stateFips === state.fips) : []),
    [geo, state],
  );
  const breaks = useMemo(
    () =>
      classBreaks([...values.values()].filter((v): v is number => v != null && Number.isFinite(v))),
    [values],
  );
  const viewBox = useMemo(() => {
    const shape = state ? geo.states.find((s) => stateFromGeometry(s)?.usps === state.usps) : null;
    if (!shape) return "0 0 975 610";
    const [x0, y0, x1, y1] = bboxOfPath(shape.d);
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return "0 0 975 610";
    const pad = Math.max(x1 - x0, y1 - y0) * 0.05;
    return `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`;
  }, [geo, state]);
  const missing = counties.filter((c) => values.get(c.id) == null).length;
  // Hatch spacing in map units, so a small state's zoomed view keeps a fine hatch.
  const hatch = Math.max(0.6, Number(viewBox.split(" ")[2]) / 140);
  const shapeIds = useMemo(() => new Set(counties.map((c) => c.id)), [counties]);
  const noShape = [...values.entries()].filter(([id, v]) => v != null && !shapeIds.has(id)).length;
  const fill = (v: number | null | undefined) => {
    const k = classOf(v, breaks);
    if (k == null) return `url(#${hatchId})`;
    return `color-mix(in srgb,var(--map-high) ${classShade(k, breaks.length)}%,var(--map-low))`;
  };
  const fmt = (v: number | null | undefined) => formatPlaceValue(v, format);
  return (
    <div
      className="atlas-map relative isolate overflow-hidden rounded-lg border border-border"
      data-testid="county-choropleth"
    >
      <div className="research-band !py-2.5">
        <span id={headingId} className="truncate text-xs font-medium">
          {title}
        </span>
        <span className="shrink-0 text-[11px] text-[var(--navy-muted)]">
          {counties.length} areas
        </span>
      </div>
      <svg
        viewBox={viewBox}
        className="h-72 w-full p-3 sm:h-96"
        role="group"
        aria-labelledby={headingId}
      >
        <defs>
          <pattern
            id={hatchId}
            width={hatch}
            height={hatch}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={hatch} height={hatch} fill="var(--muted)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2={hatch}
              stroke="var(--muted-foreground)"
              strokeOpacity="0.45"
              strokeWidth={hatch * 0.25}
            />
          </pattern>
        </defs>
        {counties.map((c) => {
          const value = values.get(c.id) ?? null;
          const active = selected === c.id || hover?.id === c.id;
          const label = `${c.name}: ${value == null ? NOT_RECORDED : `${fmt(value)} ${unit}`}`;
          return (
            <path
              key={c.id}
              d={c.d}
              data-county={c.id}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={selected === c.id}
              className="cursor-pointer outline-none transition-[stroke] duration-150"
              vectorEffect="non-scaling-stroke"
              style={{
                fill: fill(value),
                stroke: active ? "var(--map-focus)" : "var(--surface)",
                strokeWidth: active ? 2 : 0.6,
                strokeDasharray: flagged?.has(c.id) && !active ? "2 1.5" : undefined,
              }}
              onMouseEnter={() => setHover({ id: c.id, name: c.name, value })}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover({ id: c.id, name: c.name, value })}
              onBlur={() => setHover(null)}
              onClick={() => onCounty(c.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onCounty(c.id);
                }
              }}
            >
              <title>{label}</title>
            </path>
          );
        })}
      </svg>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-t border-border bg-surface/80 px-3 py-2 text-[11px]">
        <div aria-live="polite" aria-atomic="true" className="min-w-0">
          {hover ? (
            <>
              <span className="font-semibold">{hover.name}</span>
              <span className="ml-2 text-muted-foreground">
                {hover.value == null ? NOT_RECORDED : `${fmt(hover.value)} ${unit}`}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Select a county to open its profile.</span>
          )}
        </div>
        <div
          className="flex flex-wrap items-center gap-2 text-muted-foreground"
          data-testid="county-legend"
        >
          {breaks.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-2.5 w-3.5 rounded-sm border border-border/60"
                style={{
                  background: `color-mix(in srgb,var(--map-high) ${classShade(i, breaks.length)}%,var(--map-low))`,
                }}
              />
              <span className="font-mono tabular-nums">
                {"≤ "}
                {fmt(b)}
              </span>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <svg width="14" height="10" aria-hidden>
              <rect width="14" height="10" fill={`url(#${hatchId})`} stroke="var(--border)" />
            </svg>
            {NOT_RECORDED}
            {missing ? ` (${missing})` : ""}
          </span>
        </div>
      </div>
      {noShape ? (
        <p className="m-0 border-t border-border/70 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
          {noShape} {noShape === 1 ? "area has" : "areas have"} a value but no shape on this map:
          the map's county boundaries predate a later change (such as Connecticut's 2022 planning
          regions). The rankings beside it include them.
        </p>
      ) : null}
    </div>
  );
}
