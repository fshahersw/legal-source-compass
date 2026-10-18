/** Pure view logic for /law/enforcement: windows, sums, rankings and deterministic flags. */
import type {
  CpscHazard,
  CpscYear,
  EpaProfile,
  EpaYear,
} from "@/lib/external/enforcement.functions";

export type FyWindow = { id: string; label: string; from: number; to: number };
/** cases/judicial/administrative: opened in the window; dollars and penaltySettlements: settled in the window. */
export type EpaSums = {
  cases: number;
  judicial: number;
  administrative: number;
  penaltySettlements: number;
  fedPenalty: number;
  sep: number;
  costRecovery: number;
};

/** Federal FY N runs Oct 1 (N-1) – Sep 30 N. The latest complete FY at a file date. */
export function latestCompleteFy(fileDate: string | null, fallback: number): number {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(fileDate ?? "");
  if (!m) return fallback;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 10 ? year : year - 1;
}

export function fyWindows(latest: number, firstFy: number): FyWindow[] {
  return [
    { id: "10y", label: `FY${latest - 9}–FY${latest}`, from: latest - 9, to: latest },
    { id: "5y", label: `FY${latest - 4}–FY${latest}`, from: latest - 4, to: latest },
    { id: "all", label: `FY${firstFy}–FY${latest}`, from: firstFy, to: latest },
  ];
}

export function sumYears(years: readonly EpaYear[], from: number, to: number): EpaSums {
  const out: EpaSums = {
    cases: 0,
    judicial: 0,
    administrative: 0,
    penaltySettlements: 0,
    fedPenalty: 0,
    sep: 0,
    costRecovery: 0,
  };
  for (const y of years) {
    if (y.fy < from || y.fy > to) continue;
    out.cases += y.cases;
    out.judicial += y.judicial;
    out.administrative += y.administrative;
    out.penaltySettlements += y.penaltySettlements;
    out.fedPenalty += y.fedPenalty;
    out.sep += y.sep;
    out.costRecovery += y.costRecovery;
  }
  return out;
}

/** Fill every FY in [from, to] so charts show zero years instead of skipping them. */
export function denseYears(years: readonly EpaYear[], from: number, to: number): EpaYear[] {
  const byFy = new Map(years.map((y) => [y.fy, y]));
  const out: EpaYear[] = [];
  for (let fy = from; fy <= to; fy += 1)
    out.push(
      byFy.get(fy) ?? {
        fy,
        cases: 0,
        judicial: 0,
        administrative: 0,
        settlements: 0,
        penaltySettlements: 0,
        fedPenalty: 0,
        sep: 0,
        costRecovery: 0,
      },
    );
  return out;
}

export function median(values: readonly number[]): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** Linear-interpolated quantile (same as numpy's default). */
export function quantile(values: readonly number[], q: number): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo);
}

/** Tukey upper fence Q3 + 1.5 × IQR; values above it are high outliers. */
export function tukeyUpper(values: readonly number[]): number | null {
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  return q1 == null || q3 == null ? null : q3 + 1.5 * (q3 - q1);
}

export const SURGE_RULE =
  "Cases opened in the latest complete FY are at least 1.5× the state's own mean for the five prior FYs and at least 10 cases above it.";
export const PER_CAPITA_RULE =
  "FY2025 cases opened per million residents (Census Vintage 2025, July 1, 2025) above the Tukey fence Q3 + 1.5 × IQR across the 50 states and DC.";

export type SurgeFlag = { latest: number; baseline: number; ratio: number };

export function surgeFlag(years: readonly EpaYear[], latestFy: number): SurgeFlag | null {
  const dense = denseYears(years, latestFy - 5, latestFy);
  const latest = dense.at(-1)!.cases;
  const prior = dense.slice(0, 5).map((y) => y.cases);
  const baseline = prior.reduce((a, b) => a + b, 0) / prior.length;
  if (latest >= 1.5 * baseline && latest - baseline >= 10)
    return { latest, baseline, ratio: baseline > 0 ? latest / baseline : Infinity };
  return null;
}

export type StateRow = {
  code: string;
  name: string;
  fips: string | null;
  kind: EpaProfile["kind"];
  sums: EpaSums;
  multistate: number;
  perMillion: number | null;
  surge: SurgeFlag | null;
  perCapitaOutlier: boolean;
};

export function stateRows(
  profiles: readonly EpaProfile[],
  window: FyWindow,
  latestFy: number,
  perCapitaFy = 2025,
): StateRow[] {
  const rows = profiles.map((p) => {
    const fyCases = p.years.find((y) => y.fy === perCapitaFy)?.cases ?? 0;
    const perMillion =
      p.population && p.populationYear === perCapitaFy ? (fyCases / p.population) * 1e6 : null;
    return {
      code: p.code,
      name: p.name,
      fips: p.fips,
      kind: p.kind,
      sums: sumYears(p.years, window.from, window.to),
      multistate: p.totals.multistateCases,
      perMillion,
      surge: p.kind === "state" ? surgeFlag(p.years, latestFy) : null,
      perCapitaOutlier: false,
    };
  });
  const fence = tukeyUpper(
    rows.filter((r) => r.kind === "state" && r.perMillion != null).map((r) => r.perMillion!),
  );
  for (const r of rows)
    r.perCapitaOutlier =
      r.kind === "state" && fence != null && r.perMillion != null && r.perMillion > fence;
  return rows;
}

export type SortKey = "name" | "cases" | "judicial" | "fedPenalty" | "sep" | "perMillion";
export function sortRows(rows: readonly StateRow[], key: SortKey, desc: boolean): StateRow[] {
  const value = (r: StateRow) =>
    key === "name" ? r.name : key === "perMillion" ? (r.perMillion ?? -1) : r.sums[key];
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const cmp =
      typeof va === "string" ? va.localeCompare(String(vb)) : (va as number) - (vb as number);
    return (desc ? -cmp : cmp) || a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------- CPSC

/** The latest complete calendar year at the data's as-of date. */
export function latestCompleteYear(asOf: string | null, fallback: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(asOf ?? "");
  if (!m) return fallback;
  return m[2] === "12" && m[3] === "31" ? Number(m[1]) : Number(m[1]) - 1;
}

export const RISING_RULE =
  "Recalls in the latest complete year are at least 1.5× the mean of the three prior years and number at least 10.";

export type RisingHazard = { key: string; label: string; latest: number; baseline: number };
export function risingHazards(hazards: readonly CpscHazard[], latestYear: number): RisingHazard[] {
  return hazards
    .flatMap((h) => {
      const by = new Map(h.years.map((y) => [y.year, y.recalls]));
      const latest = by.get(latestYear) ?? 0;
      const baseline =
        [1, 2, 3].map((d) => by.get(latestYear - d) ?? 0).reduce((a, b) => a + b, 0) / 3;
      return latest >= 10 && latest >= 1.5 * baseline
        ? [{ key: h.key, label: h.label, latest, baseline }]
        : [];
    })
    .sort((a, b) => b.latest / (b.baseline || 1) - a.latest / (a.baseline || 1));
}

/** Share (0–1) of recalls with a recorded country that list the given country. Null when no recall records one. */
export function countryShare(year: CpscYear, country: string): number | null {
  return year.withCountry > 0 ? (year.countries[country] ?? 0) / year.withCountry : null;
}

export function hazardCube(
  years: readonly CpscYear[],
  from: number,
  to: number,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const y of years) {
    if (y.year < from || y.year > to) continue;
    for (const [hazard, row] of Object.entries(y.hazardCountry)) {
      const target = out.get(hazard) ?? new Map<string, number>();
      for (const [country, n] of Object.entries(row))
        target.set(country, (target.get(country) ?? 0) + n);
      out.set(hazard, target);
    }
  }
  return out;
}

// ---------------------------------------------------------------- format

export function usd(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "Not recorded";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function usdFull(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "Not recorded"
    : `$${Math.round(value).toLocaleString("en-US")}`;
}

export const count = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "Not recorded" : value.toLocaleString("en-US");

export const pct = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value) ? "Not recorded" : `${(value * 100).toFixed(digits)}%`;
