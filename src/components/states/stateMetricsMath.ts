/** Pure, deterministic statistics and formatting for the state-metrics views (no I/O). */
import type {
  MetricDef,
  MetricFormat,
  StateProfile,
  YearSeries,
} from "@/lib/external/stateMetrics.functions";

export const NOT_RECORDED = "Not recorded";
export const OUTLIER_Z = 2;

export type StateValue = { usps: string; fips: string; name: string; value: number };
export type RankedValue = StateValue & {
  rank: number;
  z: number | null;
  change5: number | null;
  outlier: "high" | "low" | null;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function formatValue(value: number | null | undefined, format: MetricFormat): string {
  if (!finite(value)) return NOT_RECORDED;
  switch (format) {
    case "money_m": {
      const dollars = value * 1_000_000;
      const abs = Math.abs(dollars);
      if (abs >= 1e12) return `$${(dollars / 1e12).toFixed(2)}T`;
      if (abs >= 1e9) return `$${(dollars / 1e9).toFixed(1)}B`;
      return `$${(dollars / 1e6).toFixed(0)}M`;
    }
    case "dollars":
      return `$${Math.round(value).toLocaleString("en-US")}`;
    case "pct":
      return `${value.toFixed(1)}%`;
    case "rate":
      return value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    default:
      return Math.round(value).toLocaleString("en-US");
  }
}

export function formatChange(change: number | null | undefined): string {
  if (!finite(change)) return NOT_RECORDED;
  return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
}

export function median(values: number[]): number | null {
  const s = values.filter(finite).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function mean(values: number[]): number | null {
  const s = values.filter(finite);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
}

/** Population standard deviation (the rule the builder and the UI both state). */
export function stdev(values: number[]): number | null {
  const m = mean(values);
  if (m == null) return null;
  const s = values.filter(finite);
  return Math.sqrt(s.reduce((acc, v) => acc + (v - m) ** 2, 0) / s.length);
}

/** Pearson correlation over paired finite values; null when n < 3 or either side has no variance. */
export function pearson(pairs: [number, number][]): number | null {
  const pts = pairs.filter(([x, y]) => finite(x) && finite(y));
  if (pts.length < 3) return null;
  const mx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
  const my = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Ordinary least-squares line y = intercept + slope * x. */
export function leastSquares(
  pairs: [number, number][],
): { slope: number; intercept: number } | null {
  const pts = pairs.filter(([x, y]) => finite(x) && finite(y));
  if (pts.length < 3) return null;
  const mx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
  const my = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
  let sxy = 0,
    sxx = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

export function correlationLabel(r: number | null): string {
  if (r == null) return "Not computable";
  const a = Math.abs(r);
  const strength = a >= 0.7 ? "strong" : a >= 0.4 ? "moderate" : a >= 0.2 ? "weak" : "negligible";
  return `${strength} ${r >= 0 ? "positive" : "negative"}`;
}

export function changePct(series: YearSeries | undefined, year: number, span = 5): number | null {
  const a = series?.[String(year - span)];
  const b = series?.[String(year)];
  if (!finite(a) || !finite(b) || a === 0) return null;
  return Math.round(((b - a) / Math.abs(a)) * 1000) / 10;
}

/** Values of one metric in one year for every state that reports it. */
export function valuesFor(states: StateProfile[], metric: string, year: number): StateValue[] {
  return states.flatMap((s) => {
    const value = s.series[metric]?.[String(year)];
    return finite(value) ? [{ usps: s.usps, fips: s.fips, name: s.name, value }] : [];
  });
}

/** Rank 1 = highest value (ties share the best rank), z against the population SD, 5-year change. */
export function rankStates(states: StateProfile[], metric: string, year: number): RankedValue[] {
  const values = valuesFor(states, metric, year);
  const nums = values.map((v) => v.value);
  const m = mean(nums);
  const sd = stdev(nums);
  const sorted = [...nums].sort((a, b) => b - a);
  const byUsps = new Map(states.map((s) => [s.usps, s]));
  return values
    .map((v) => {
      const z = m != null && sd ? Math.round(((v.value - m) / sd) * 100) / 100 : null;
      return {
        ...v,
        rank: sorted.indexOf(v.value) + 1,
        z,
        change5: changePct(byUsps.get(v.usps)?.series[metric], year),
        outlier:
          z == null || Math.abs(z) <= OUTLIER_Z
            ? null
            : z > 0
              ? ("high" as const)
              : ("low" as const),
      };
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

/** Years (ascending) in which at least `min` states report the metric. */
export function coveredYears(states: StateProfile[], metric: string, min = 1): number[] {
  const counts = new Map<number, number>();
  for (const s of states)
    for (const y of Object.keys(s.series[metric] ?? {}))
      counts.set(Number(y), (counts.get(Number(y)) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .map(([y]) => y)
    .sort((a, b) => a - b);
}

/** Default year: the metric's latest ranked year, else the latest year with any coverage. */
export function defaultYear(def: MetricDef | undefined, states: StateProfile[]): number | null {
  if (!def) return null;
  if (def.latestYear != null) return def.latestYear;
  return coveredYears(states, def.key).at(-1) ?? null;
}

/** Latest year both metrics cover for at least `min` states, preferring full (non-partial) years. */
export function commonYear(
  states: StateProfile[],
  x: MetricDef,
  y: MetricDef,
  min = 30,
): number | null {
  const xs = new Set(coveredYears(states, x.key, min).filter((yr) => !x.partialYears[String(yr)]));
  const both = coveredYears(states, y.key, min).filter(
    (yr) => xs.has(yr) && !y.partialYears[String(yr)],
  );
  return both.at(-1) ?? null;
}

/** Equal-width histogram with a deterministic bin count (Sturges' rule, capped at 12). */
export function histogram(values: number[], maxBins = 12) {
  const s = values.filter(finite).sort((a, b) => a - b);
  if (!s.length) return [];
  const lo = s[0]!,
    hi = s.at(-1)!;
  const bins = Math.min(maxBins, Math.max(1, Math.ceil(Math.log2(s.length) + 1)));
  const width = hi > lo ? (hi - lo) / bins : 1;
  const out = Array.from({ length: bins }, (_, i) => ({
    from: lo + i * width,
    to: i === bins - 1 ? hi : lo + (i + 1) * width,
    count: 0,
  }));
  for (const v of s) out[Math.min(bins - 1, Math.floor((v - lo) / width))]!.count += 1;
  return out;
}

export type StateMetricsSearch = {
  metric?: string;
  year?: number;
  state?: string;
  x?: string;
  y?: string;
};

/** A change to the search params; an explicit undefined clears that param. */
export type StateMetricsPatch = {
  [K in keyof StateMetricsSearch]?: StateMetricsSearch[K] | undefined;
};

/** URL search params for /places/analytics; anything malformed is dropped. */
export function parseStateMetricsSearch(search: Record<string, unknown>): StateMetricsSearch {
  const key = (v: unknown) =>
    typeof v === "string" && /^[a-z0-9_]{1,64}$/.test(v) ? v : undefined;
  const out: StateMetricsSearch = {};
  const metric = key(search["metric"]),
    x = key(search["x"]),
    y = key(search["y"]);
  const year = Number(search["year"]);
  const state = typeof search["state"] === "string" ? search["state"].toUpperCase() : "";
  if (metric) out.metric = metric;
  if (x) out.x = x;
  if (y) out.y = y;
  if (Number.isInteger(year) && year >= 1990 && year <= 2100) out.year = year;
  if (/^[A-Z]{2}$/.test(state)) out.state = state;
  return out;
}

/** Group selectable metrics for a <select> with optgroups, preserving builder order. */
export function metricGroups(metrics: MetricDef[]) {
  const groups = new Map<string, MetricDef[]>();
  for (const m of metrics) {
    if (!m.selectable) continue;
    groups.set(m.group, [...(groups.get(m.group) ?? []), m]);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}
