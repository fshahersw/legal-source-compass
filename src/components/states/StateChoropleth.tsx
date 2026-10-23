import { useId, useMemo, useState } from "react";
import type { GeoData } from "@/lib/corpus/geo";
import { stateFromGeometry } from "@/lib/corpus/stateHub";
import { competitionRank } from "@/lib/external/mapMetricsModel";
import type { MetricFormat } from "@/lib/external/stateMetrics.functions";
import { formatValue, NOT_RECORDED } from "./stateMetricsMath";

/**
 * State choropleth for one metric-year. Linear shading between the lowest and highest reported value;
 * states with no reported value get a distinct hatched fill and a "Not recorded" legend swatch, so a
 * missing value is never mistaken for the lowest one.
 */
export function StateChoropleth({
  geo,
  values,
  format,
  unit,
  title,
  yearLabel,
  selected,
  onSelect,
}: {
  geo: GeoData;
  /** Keyed by USPS code. */
  values: Map<string, number>;
  format: MetricFormat;
  unit: string;
  title: string;
  /** The year or period the values describe, shown in the legend. */
  yearLabel?: string | undefined;
  selected: string | null;
  onSelect: (usps: string) => void;
}) {
  const hatchId = useId().replace(/:/g, "");
  const headingId = useId();
  const [hover, setHover] = useState<{
    name: string;
    value: number | undefined;
    rank: string | null;
  } | null>(null);
  // Rank among the states that report the value (1 = highest value), so a state's place is read, not guessed from shade.
  const ranks = useMemo(() => competitionRank(Object.fromEntries(values), values.keys()), [values]);
  const rankText = (usps: string) => {
    const r = ranks[usps];
    return r ? `rank ${r.rank} of ${r.of}` : null;
  };
  const [min, max] = useMemo(() => {
    const nums = [...values.values()].filter(Number.isFinite);
    return nums.length ? [Math.min(...nums), Math.max(...nums)] : [0, 0];
  }, [values]);
  const missing = geo.states.filter((s) => {
    const id = stateFromGeometry(s);
    return id && !values.has(id.usps);
  }).length;
  const fill = (v: number | undefined) => {
    if (v == null || !Number.isFinite(v)) return `url(#${hatchId})`;
    const t = max > min ? (v - min) / (max - min) : 0.5;
    return `color-mix(in srgb,var(--map-high) ${Math.round(10 + 85 * t)}%,var(--map-low))`;
  };
  return (
    <div className="atlas-map relative isolate overflow-hidden rounded-lg border border-border">
      <div className="research-band !py-2.5">
        <span id={headingId} className="truncate text-xs font-medium">
          {title}
        </span>
      </div>
      <svg
        viewBox="0 0 975 610"
        className="h-auto min-h-52 w-full p-3"
        role="group"
        aria-labelledby={headingId}
      >
        <defs>
          <pattern
            id={hatchId}
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
        {geo.states.map((shape) => {
          const id = stateFromGeometry(shape);
          if (!id) return null;
          const value = values.get(id.usps);
          const active = selected === id.usps;
          const rank = rankText(id.usps);
          const label = `${id.name}: ${value == null ? NOT_RECORDED : `${formatValue(value, format)} ${unit}${rank ? `, ${rank}` : ""}`}`;
          return (
            <path
              key={id.fips}
              d={shape.d}
              data-state={id.usps}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={active}
              className="cursor-pointer outline-none transition-[stroke] duration-150 focus-visible:[stroke:var(--map-focus)] focus-visible:[stroke-width:2.4]"
              vectorEffect="non-scaling-stroke"
              style={{
                fill: fill(value),
                stroke: active ? "var(--map-active)" : "var(--surface)",
                strokeWidth: active ? 2.6 : 0.9,
              }}
              onMouseEnter={() => setHover({ name: id.name, value, rank })}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover({ name: id.name, value, rank })}
              onBlur={() => setHover(null)}
              onClick={() => onSelect(id.usps)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(id.usps);
                }
              }}
            >
              <title>{label}</title>
            </path>
          );
        })}
      </svg>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-t border-border bg-surface/80 px-3 py-2 text-[11px]">
        <div aria-live="polite" aria-atomic="true">
          {hover ? (
            <>
              <span className="font-semibold">{hover.name}</span>
              <span className="ml-2 text-muted-foreground">
                {hover.value == null
                  ? NOT_RECORDED
                  : `${formatValue(hover.value, format)} ${unit}${hover.rank ? ` · ${hover.rank}` : ""}`}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Select a state to highlight it everywhere.
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
          <span>
            {unit}
            {yearLabel ? ` · ${yearLabel}` : ""}
          </span>
          {values.size ? (
            <span className="flex items-center gap-1.5">
              <span className="font-mono">{formatValue(min, format)}</span>
              <span
                className="h-1.5 w-16 rounded-full"
                style={{
                  background:
                    "linear-gradient(90deg,color-mix(in srgb,var(--map-high) 10%,var(--map-low)),var(--map-high))",
                }}
                aria-hidden
              />
              <span className="font-mono">{formatValue(max, format)}</span>
            </span>
          ) : null}
          <span className="flex items-center gap-1.5">
            <svg width="14" height="10" aria-hidden>
              <rect width="14" height="10" fill={`url(#${hatchId})`} stroke="var(--border)" />
            </svg>
            {NOT_RECORDED}
            {missing ? ` (${missing})` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
