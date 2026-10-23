/** Pure view models for the Census sections of state and county pages: key figures, comparisons, chart rows, table rows. */
import {
  changeBetween,
  difference,
  formatCensus,
  formatMoe,
  NOT_RECORDED,
  trendPoints,
  type CensusGeo,
  type CensusLatest,
  type CensusMeasureDef,
  type Difference,
  type PepGeo,
  type TrendPoint,
} from "@/lib/external/censusModel";

export type Comparator = { id: string; label: string; geo: CensusGeo | null };

export type Comparison = {
  id: string;
  label: string;
  latest: CensusLatest | null;
  diff: Difference | null;
  /** Plain statement of how the area differs, or why it cannot be said. */
  verdict: string;
};

/** "Higher than", "Lower than" or "Within the margin of error of" a comparator, never a bare arrow or colour. */
export function verdictText(
  label: string,
  d: Difference | null,
  def: Pick<CensusMeasureDef, "format">,
): string {
  if (!d) return `${NOT_RECORDED} for ${label}`;
  if (d.distinguishable == null)
    return `${formatCensus(Math.abs(d.diff), def.format === "pct" ? "dec1" : def.format)}${def.format === "pct" ? " pts" : ""} ${d.diff >= 0 ? "above" : "below"} ${label}; margin not available`;
  if (!d.distinguishable) return `Within the margin of error of ${label}`;
  return `${d.diff > 0 ? "Higher" : "Lower"} than ${label} by more than the margin of error`;
}

export function compareLatest(
  area: CensusGeo,
  def: CensusMeasureDef,
  comparators: Comparator[],
): Comparison[] {
  const mine = area.latest[def.key];
  return comparators.map((c) => {
    const theirs = c.geo?.latest[def.key] ?? null;
    // only the same release can be compared
    const same = mine && theirs && mine.year === theirs.year;
    const diff = same ? difference(mine, theirs) : null;
    return {
      id: c.id,
      label: c.label,
      latest: theirs,
      diff,
      verdict: same ? verdictText(c.label, diff, def) : `${NOT_RECORDED} for ${c.label}`,
    };
  });
}

export type KeyFigure = {
  def: CensusMeasureDef;
  latest: CensusLatest | null;
  valueText: string;
  moeText: string;
  rank: { rank: number; of: number } | null;
  trend: TrendPoint[];
  comparisons: Comparison[];
};

export function keyFigures(
  area: CensusGeo,
  defs: Map<string, CensusMeasureDef>,
  keys: string[],
  comparators: Comparator[],
): KeyFigure[] {
  return keys.flatMap((key) => {
    const def = defs.get(key);
    if (!def) return [];
    const latest = area.latest[key] ?? null;
    return [
      {
        def,
        latest,
        valueText: formatCensus(latest?.value, def.format),
        moeText: latest ? formatMoe(latest, def.format) : "",
        rank: area.rank[key] ?? null,
        trend: trendPoints(area, key),
        comparisons: compareLatest(area, def, comparators),
      },
    ];
  });
}

export type ChartRow = Record<string, number | null | [number, number]> & { year: number };
export type ChartSeriesDef = { id: string; label: string; geo: CensusGeo };

/** One row per release year with a value (and margin) per series; a year with no published value is null, never zero. */
export function chartRows(series: ChartSeriesDef[], key: string): ChartRow[] {
  const years = [...new Set(series.flatMap((s) => s.geo.years))].sort((a, b) => a - b);
  return years.map((year) => {
    const row: ChartRow = { year } as ChartRow;
    for (const s of series) {
      const f = s.geo.series[key]?.[String(year)];
      const moe = f && !f.note ? f.moe : null;
      row[s.id] = f?.value ?? null;
      row[`${s.id}_moe`] = moe;
      // the shaded band is the published margin of error around the estimate, nothing more
      row[`${s.id}_band`] = f?.value != null && moe != null ? [f.value - moe, f.value + moe] : null;
    }
    return row;
  });
}

export type MeasureRow = {
  def: CensusMeasureDef;
  valueText: string;
  moeText: string;
  year: number | null;
  rank: { rank: number; of: number } | null;
  comparisons: Comparison[];
  /** Change from the first release with a value to the latest, with a margin only between non-overlapping releases. */
  change: { text: string; note: string } | null;
};

export function changeText(area: CensusGeo, def: CensusMeasureDef): MeasureRow["change"] {
  const years = Object.entries(area.series[def.key] ?? {})
    .filter(([, f]) => f.value != null)
    .map(([y]) => Number(y))
    .sort((a, b) => a - b);
  if (years.length < 2) return null;
  const from = years[0]!;
  const to = years[years.length - 1]!;
  const c = changeBetween(area, def.key, from, to);
  if (!c) return null;
  const unit = def.format === "pct" ? " pts" : "";
  const abs =
    def.format === "pct"
      ? Math.abs(c.diff).toFixed(1)
      : formatCensus(Math.abs(c.diff), def.format === "dec1" ? "dec1" : def.format);
  const sign = c.diff > 0 ? "+" : c.diff < 0 ? "−" : "";
  const verdict = !c.independent
    ? "releases overlap; no significance test"
    : c.distinguishable == null
      ? "margin not available"
      : c.distinguishable
        ? "larger than the margin of error"
        : "within the margin of error";
  return { text: `${sign}${abs}${unit}`, note: `${from} to ${to} release: ${verdict}` };
}

export function measureRows(
  area: CensusGeo,
  defs: CensusMeasureDef[],
  comparators: Comparator[],
): MeasureRow[] {
  return defs.map((def) => {
    const latest = area.latest[def.key] ?? null;
    return {
      def,
      valueText: formatCensus(latest?.value, def.format),
      moeText: latest ? formatMoe(latest, def.format) : "",
      year: latest?.year ?? null,
      rank: area.rank[def.key] ?? null,
      comparisons: compareLatest(area, def, comparators),
      change: changeText(area, def),
    };
  });
}

/** Population Estimates as chart rows: the two vintages are separate series (different census bases), never joined. */
export function pepRows(pep: Pick<PepGeo, "v2019" | "v2025">): ChartRow[] {
  const years = [...new Set([...Object.keys(pep.v2019), ...Object.keys(pep.v2025)])]
    .map(Number)
    .sort((a, b) => a - b);
  return years.map((year) => ({
    year,
    v2019: pep.v2019[String(year)] ?? null,
    v2025: pep.v2025[String(year)] ?? null,
  }));
}

/** Groups in display order. */
export const MEASURE_GROUPS = ["People", "Economy", "Housing"] as const;

/** Headline measures for the key-figure tiles. */
export const KEY_MEASURES = [
  "median_hh_income",
  "poverty_rate",
  "unemployment_rate",
  "bachelors_plus",
  "uninsured",
  "median_age",
] as const;
/** Trend charts: measure key and the unit text printed on the axis. */
export const TREND_MEASURES = [
  "median_hh_income",
  "poverty_rate",
  "unemployment_rate",
  "uninsured",
] as const;
/** Population composition shown as ranked bars (race and Hispanic origin as the Census Bureau tabulates them). */
export const COMPOSITION_MEASURES = [
  "white_nh",
  "hispanic",
  "black_nh",
  "asian_nh",
  "aian_nh",
  "nhpi_nh",
  "other_nh",
  "two_plus_nh",
] as const;

export function periodText(geo: CensusGeo): string {
  return geo.survey === "acs5"
    ? `ACS 5-year estimates, ${geo.period}`
    : `ACS 1-year estimates, ${geo.period}`;
}
