import { useMemo, useState } from "react";
import { bboxOfPath, stateByFips, type GeoData } from "@/lib/corpus/geo";

type Props = {
  geo: GeoData;
  /** value per state FIPS (national) or per county FIPS (state view) */
  values: Map<string, number>;
  valueLabel: string;
  stateFips?: string;
  onState?: (fips: string) => void;
  onCounty?: (fips: string) => void;
  selectedCounty?: string | undefined;
};

/** Plain SVG map from the pre-projected us-atlas geometry. No map service, no API key. */
export function UsMap({ geo, values, valueLabel, stateFips, onState, onCounty, selectedCounty }: Props) {
  const [hover, setHover] = useState<{ name: string; value: number | undefined } | null>(null);
  const max = Math.max(1, ...values.values());
  const opacity = (v: number | undefined) => (v ? 0.18 + 0.82 * Math.sqrt(v / max) : 0);

  const counties = useMemo(
    () => (stateFips ? geo.counties.filter((c) => c.stateFips === stateFips) : geo.counties),
    [geo, stateFips],
  );
  const viewBox = useMemo(() => {
    if (!stateFips) return "0 0 975 610";
    const s = geo.states.find((x) => x.id === stateFips);
    if (!s) return "0 0 975 610";
    const [x0, y0, x1, y1] = bboxOfPath(s.d);
    const pad = Math.max(x1 - x0, y1 - y0) * 0.05;
    return `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`;
  }, [geo, stateFips]);

  return (
    <div className="relative">
      <svg viewBox={viewBox} className="h-auto w-full" role="img" aria-label={stateFips ? `County map of ${stateByFips.get(stateFips)?.name}` : "Map of U.S. states and counties"}>
        {stateFips ? (
          counties.map((c) => {
            const v = values.get(c.id);
            return (
              <path
                key={c.id}
                d={c.d}
                data-county={c.id}
                aria-label={`${c.name} County`}
                role="button"
                className="cursor-pointer stroke-background transition-[fill-opacity]"
                style={{ fill: selectedCounty === c.id ? "var(--accent-foreground)" : "var(--primary)", fillOpacity: selectedCounty === c.id ? 1 : opacity(v) || 0.06, strokeWidth: 0.4 }}
                onMouseEnter={() => setHover({ name: c.name, value: v })}
                onMouseLeave={() => setHover(null)}
                onClick={() => onCounty?.(c.id)}
              />
            );
          })
        ) : (
          <>
            {geo.states.map((s) => {
              const v = values.get(s.id);
              return (
                <path
                  key={s.id}
                  d={s.d}
                  data-state={stateByFips.get(s.id)?.usps}
                  aria-label={s.name}
                  role="button"
                  className="cursor-pointer transition-[fill-opacity] hover:[fill-opacity:1]"
                  style={{ fill: "var(--primary)", fillOpacity: opacity(v) || 0.06 }}
                  onMouseEnter={() => setHover({ name: s.name, value: v })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onState?.(s.id)}
                />
              );
            })}
            <path d={counties.map((c) => c.d).join("")} className="pointer-events-none fill-none stroke-background" style={{ strokeWidth: 0.15, strokeOpacity: 0.6 }} />
            <path d={geo.stateBorders} className="pointer-events-none fill-none stroke-background" style={{ strokeWidth: 0.9 }} />
          </>
        )}
      </svg>
      <div className="pointer-events-none absolute left-2 top-2 min-h-8 rounded border border-border bg-surface/95 px-2 py-1 text-[12px] shadow-card">
        {hover ? (
          <>
            <span className="font-medium">{hover.name}</span>{" "}
            <span className="font-mono text-muted-foreground">{(hover.value ?? 0).toLocaleString()} {valueLabel}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Hover a {stateFips ? "county" : "state"}; click to open</span>
        )}
      </div>
    </div>
  );
}
