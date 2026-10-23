/**
 * State or county choropleth for one metric and period, on the platform's shared map (MetricMap: pre-projected
 * us-atlas geometry, quantile classes, hatched "Not recorded", ranks, keyboard-reachable states). This wrapper takes
 * contract-shaped values (entity id → value), states the unit and period in the legend and handles the map file's
 * loading and error states.
 */
import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricMap } from "@/components/places/MetricMap";
import { STATES, stateByFips, stateByUsps } from "@/lib/corpus/geo";
import type { MapFormat } from "@/lib/external/mapMetricsModel";
import { useCorpus } from "@/lib/corpus/store";
import type { MetricFormat } from "@/lib/insights/contract";

/** The map's number format for a contract metric format. */
export function mapFormatFor(format: MetricFormat): MapFormat {
  switch (format) {
    case "count":
    case "days":
      return "int";
    case "rate_per_100k":
      return "rate1";
    case "percent":
      return "pct";
    case "currency_usd":
      return "dollars";
    case "months":
    case "ratio":
      return "dec1";
  }
}

/** Two-digit state FIPS for a state entity id written as a USPS code ("CA") or a FIPS code ("06"); null otherwise. */
export function stateFipsOf(entityId: string): string | null {
  const id = entityId.trim().toUpperCase();
  if (/^\d{1,2}$/.test(id)) {
    const f = id.padStart(2, "0");
    return stateByFips.has(f) ? f : null;
  }
  return stateByUsps.get(id)?.fips ?? null;
}

/** Five-digit county FIPS for a county entity id ("06037"); null otherwise. */
export function countyFipsOf(entityId: string): string | null {
  return /^\d{5}$/.test(entityId.trim()) ? entityId.trim() : null;
}

/** Values keyed by map id (state or county FIPS); ids the map cannot place are reported, never guessed. */
export function toMapValues(
  values: ReadonlyMap<string, number | null>,
  level: "state" | "county",
): { byFips: Record<string, number>; unplaced: string[] } {
  const byFips: Record<string, number> = {};
  const unplaced: string[] = [];
  for (const [id, v] of values) {
    const f = level === "state" ? stateFipsOf(id) : countyFipsOf(id);
    if (!f) {
      unplaced.push(id);
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) byFips[f] = v;
  }
  return { byFips, unplaced };
}

export function Choropleth({
  level,
  title,
  values,
  format,
  unit,
  periodLabel,
  selected,
  onSelect,
  stateAction = "Select",
}: {
  level: "state" | "county";
  title: string;
  /** Entity id → value (null = not recorded). */
  values: ReadonlyMap<string, number | null>;
  format: MetricFormat;
  unit: string;
  periodLabel: string;
  /** Selected state, as a USPS code. */
  selected?: string | null | undefined;
  /** Called with the entity id as the map knows it: USPS for states, five-digit FIPS for counties. */
  onSelect?: ((id: string) => void) | undefined;
  stateAction?: string;
}) {
  const corpus = useCorpus();
  const mapFormat = mapFormatFor(format);
  const { byFips, unplaced } = useMemo(() => toMapValues(values, level), [values, level]);
  const countyNames = useMemo(
    () => new Map((corpus.geo?.counties ?? []).map((c) => [c.id, c.name] as const)),
    [corpus.geo],
  );
  if (corpus.status === "error")
    return (
      <p
        role="alert"
        className="rounded-md border border-border px-3 py-6 text-xs text-destructive"
      >
        The map file could not be loaded. The ranked bars and the data table below list every value.
      </p>
    );
  if (!corpus.geo) return <Skeleton className="aspect-[975/610] w-full" aria-label="Loading map" />;
  const area = { values: byFips, format: mapFormat, unit, yearLabel: periodLabel };
  return (
    <div className="space-y-1">
      <MetricMap
        geo={corpus.geo}
        title={title}
        states={level === "state" ? area : { ...area, values: {} }}
        counties={level === "county" ? area : null}
        countyNames={countyNames}
        selectedState={selected ?? undefined}
        stateAction={stateAction}
        onState={(fips) => {
          const s = STATES.find((x) => x.fips === fips);
          if (s) onSelect?.(s.usps);
        }}
        onCounty={(fips) => onSelect?.(fips)}
      />
      {unplaced.length ? (
        <p className="text-[11px] text-muted-foreground">
          {unplaced.length} {unplaced.length === 1 ? "entity is" : "entities are"} not on the map
          (no matching {level} code): {unplaced.slice(0, 6).join(", ")}
          {unplaced.length > 6 ? "…" : ""}. They are listed in the data table.
        </p>
      ) : null}
    </div>
  );
}
