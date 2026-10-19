/**
 * Pure display and chart-shaping helpers for /courts/collection. Every helper returns "Not recorded" (or null) for an
 * unknown input; none guesses a number, and the snapshot's own (partial) year is never treated as a complete year.
 */
import {
  int,
  NOT_RECORDED,
  pct as pctFixed,
  shareOf,
  signedPct,
} from "@/components/analysis/analysisFormat";
import { barWidth, longDate, ordinal } from "@/components/courts/caseload/caseloadFormat";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { STATES } from "@/lib/corpus/geo";
import type { SchemaLoad } from "@/lib/external/clbCollection.functions";

export { barWidth, int, NOT_RECORDED, shareOf, signedPct };

export const pct = (v: number | null | undefined, digits = 1) => pctFixed(v, digits);

/** The statement that goes with every figure on the page. */
export const NOT_COMPLETE_TOTALS =
  "Counts of rows in CourtListener's collection (snapshot of its bulk files), not complete court totals.";

// -------------------------------------------------------------------------------------------- years

/** "partial year, through Sep 30, 2026", or "partial year" when the snapshot date is not recorded. */
export function partialYearText(snapshot: string | null | undefined): string {
  const d = longDate(snapshot);
  return d ? `partial year, through ${d}` : "partial year";
}

/** "2026*" for a partial year. */
export const yearTick = (year: number, partial: boolean) => (partial ? `${year}*` : String(year));

/** The rows from `from` onward, or all of them for the "all years" span. */
export function spanYears<T extends { year: number }>(
  rows: readonly T[],
  span: "all" | undefined,
  from: number,
): T[] {
  return span === "all" ? [...rows] : rows.filter((r) => r.year >= from);
}

/** The latest complete year in a series (never the partial one), or null. */
export function latestCompleteYear<T extends { year: number; partial: boolean }>(
  rows: readonly T[],
): T | null {
  return [...rows].sort((a, b) => b.year - a.year).find((r) => !r.partial) ?? null;
}

/** The complete year with the largest value; a partial year can never be the peak. */
export function peakCompleteYear<T extends { year: number; partial: boolean }>(
  rows: readonly T[],
  value: (row: T) => number | null,
): T | null {
  let best: T | null = null;
  let bestValue = -Infinity;
  for (const r of rows) {
    if (r.partial) continue;
    const v = value(r);
    if (v != null && v > bestValue) {
      best = r;
      bestValue = v;
    }
  }
  return best;
}

/**
 * Years whose count is under `fraction` of the busiest year's. They are drawn lighter and named in the note, so a thin
 * year is read as thin coverage rather than as a fall in activity.
 */
export function thinYears<T extends { year: number }>(
  rows: readonly T[],
  value: (row: T) => number | null,
  fraction = 0.05,
): Set<number> {
  const max = Math.max(0, ...rows.map((r) => value(r) ?? 0));
  const out = new Set<number>();
  if (!(max > 0)) return out;
  for (const r of rows) {
    const v = value(r);
    if (v != null && v < max * fraction) out.add(r.year);
  }
  return out;
}

/** A run of consecutive years as "1987–2002"; a single year alone; "" for none. */
export function yearRuns(years: readonly number[]): string {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j += 1;
    runs.push(i === j ? String(sorted[i]) : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return runs.join(", ");
}

export const decadeOf = (year: number) => Math.floor(year / 10) * 10;
export const decadeLabel = (decade: number) => `${decade}s`;

// -------------------------------------------------------------------------------------------- shares and ranks

/** part ÷ whole in percent units, or null when the whole is zero or either is unknown. */
export const sharePct = (part: number | null | undefined, whole: number | null | undefined) =>
  shareOf(part, whole);

/**
 * Competition ranks (1 is the largest value; tied values share the lowest number). A missing value has no rank and does
 * not take a place from the others.
 */
export function competitionRanks(values: readonly (number | null)[]): (number | null)[] {
  const known = values.filter((v): v is number => v != null).sort((a, b) => b - a);
  return values.map((v) => (v == null ? null : known.indexOf(v) + 1));
}

/**
 * The share of each cell in its row's total. A row with a missing cell, or a total of zero, has no shares: a share over
 * a partial row would overstate it.
 */
export function rowShares(cells: readonly (number | null)[]): (number | null)[] {
  if (cells.some((c) => c == null)) return cells.map(() => null);
  const total = (cells as number[]).reduce((a, b) => a + b, 0);
  return total > 0 ? (cells as number[]).map((c) => (100 * c) / total) : cells.map(() => null);
}

/**
 * Heat-map tint for a cell: a faint token-colour wash (4% to 30%) so the number stays readable in light and dark, and
 * the bar width (0 to 100) that carries the magnitude. Both scale with the square root of the share.
 */
export function heat(value: number | null, max: number): { alpha: number; bar: number } {
  if (value == null || !(max > 0) || value <= 0) return { alpha: 0, bar: 0 };
  const t = Math.sqrt(Math.min(1, value / max));
  return { alpha: Math.round(4 + 26 * t), bar: Math.max(2, Math.round(100 * t)) };
}

/** The largest value among the cells, ignoring missing ones. */
export const maxOf = (rows: readonly (readonly (number | null)[])[]) =>
  Math.max(0, ...rows.flatMap((r) => r.map((c) => c ?? 0)));

// -------------------------------------------------------------------------------------------- places

const TERRITORY_NAMES: Record<string, string> = {
  AS: "American Samoa",
  GU: "Guam",
  MP: "Northern Mariana Islands",
  PR: "Puerto Rico",
  VI: "U.S. Virgin Islands",
};
const STATE_NAMES = new Map(STATES.map((s) => [s.usps, s.name]));

/** The state, DC or territory name for a USPS code; the code itself when it is not recognised. */
export const stateName = (code: string) => STATE_NAMES.get(code) ?? TERRITORY_NAMES[code] ?? code;

/** A place page exists for the 50 states and DC only; territories have no link. */
export const hasPlacePage = (code: string) => STATE_NAMES.has(code);

// -------------------------------------------------------------------------------------------- text

/** "691.9 MB", "< 0.1 MB" for a size the dataset rounds to zero, Not recorded for null. */
export function megabytes(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NOT_RECORDED;
  if (v < 0.05) return "< 0.1 MB";
  return `${v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

/** "8.0 years" (one decimal) for a median age; Not recorded for null. */
export function yearsText(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NOT_RECORDED;
  return `${v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} years`;
}

/** "+0.969" / "−0.222" with a real minus sign; Not recorded for null. */
export function rhoText(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NOT_RECORDED;
  const body = Math.abs(v).toFixed(3);
  return v > 0 ? `+${body}` : v < 0 ? `−${body}` : body;
}

/** Short wording for how a schema table is loaded in this project. */
export function loadShort(load: SchemaLoad): string {
  switch (load) {
    case "none":
      return "No bulk file";
    case "not_loaded":
      return "Bulk file, not loaded";
    case "selected":
      return "Selected columns";
    case "all":
      return "All columns, as text";
    default:
      return "Not recorded";
  }
}

/** Distinct values of a field with their counts, most frequent first (ties alphabetical); blanks are left out. */
export function countedOptions(
  values: readonly (string | null | undefined)[],
): { id: string; label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m]
    .map(([id, count]) => ({ id, label: id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/** "5 of 12" style pair, Not recorded when either part is unknown. */
export function ofText(part: number | null | undefined, whole: number | null | undefined): string {
  return part == null || whole == null ? NOT_RECORDED : `${int(part)} of ${int(whole)}`;
}

// -------------------------------------------------------------------------------------------- courts and series

/** Series colours for bar charts, from the shared chart palette. */
export const SERIES_COLORS = [FDA_COLORS[0]!, FDA_COLORS[2]!, FDA_COLORS[5]!, FDA_COLORS[1]!];

/** "1st", "9th", "D.C.", "Fed.", "SCOTUS" for a court-of-appeals column; the key itself otherwise. */
export function circuitShort(key: string): string {
  const m = /^ca(\d{1,2})$/.exec(key);
  if (m) return ordinal(Number(m[1]));
  if (key === "cadc") return "D.C.";
  if (key === "cafc") return "Fed.";
  if (key === "scotus") return "SCOTUS";
  return key;
}

/** "Ninth Circuit" from "Court of Appeals for the Ninth Circuit"; the name itself when it has no such prefix. */
export const circuitName = (name: string) => name.replace(/^Court of Appeals for the /, "");

/** What a set of correlation pairs covers: the most districts any pair has, the fiscal-year periods named, and the sources compared. */
export function correlationSummary(
  rows: readonly {
    n: number;
    a: { period: string; source: string };
    b: { period: string; source: string };
  }[],
): { districts: number | null; periods: string[]; sources: string[] } {
  if (!rows.length) return { districts: null, periods: [], sources: [] };
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    districts: Math.max(...rows.map((r) => r.n)),
    periods: uniq(rows.flatMap((r) => [r.a.period, r.b.period]).filter((p) => /^FY\d{4}$/.test(p))),
    sources: uniq(rows.flatMap((r) => [r.a.source, r.b.source])),
  };
}
