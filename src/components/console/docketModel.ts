/**
 * Pure figures for the analyst-console pages (Overview and Docket health), computed only from published corpus
 * records: the FJC Integrated Database national and district caseload and the JPML-based MDL analytics. No I/O.
 *
 * Rules (src/components/charts/AGENTS.md):
 * - Clearance is a flow comparison of matched complete fiscal years (terminations per 100 filings in the same year);
 *   a partial fiscal year and a year missing either count are left out, never read as zero.
 * - District comparisons draw against the median of the compared districts, not a national figure.
 * - MDL pending actions are MDL-wide and come from the JPML report series; a missing figure is "Not recorded".
 */
import type {
  CaseloadYear,
  DistrictRow,
  NationalCaseload,
} from "@/lib/external/courtCaseload.functions";
import type { MdlOverview, MdlRow } from "@/lib/external/mdlAnalytics.functions";

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Median of the finite values; null when there are none. */
export function median(values: readonly (number | null | undefined)[]): number | null {
  const xs = values.filter(finite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

/** Percent change from `from` to `to`; null when either is missing or `from` is zero. */
export function pctChange(from: number | null | undefined, to: number | null | undefined) {
  if (!finite(from) || !finite(to) || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

/** Complete fiscal years in ascending order (the partial year in progress is left out). */
export function completeYears(n: NationalCaseload | null | undefined): CaseloadYear[] {
  if (!n) return [];
  return n.years.filter((y) => !y.partial).sort((a, b) => a.fy - b.fy);
}

/** Terminations per 100 filings in the same complete fiscal year; null when either count is missing or zero. */
export function clearanceRate(y: Pick<CaseloadYear, "filings" | "terminations">): number | null {
  if (!finite(y.filings) || !finite(y.terminations) || y.filings <= 0) return null;
  return (y.terminations / y.filings) * 100;
}

/** Share of filings that carry an MDL docket number in the IDB (a historical association, not JPML membership). */
export function mdlNumberShare(y: Pick<CaseloadYear, "filings" | "withMdlNumber">): number | null {
  if (!finite(y.filings) || !finite(y.withMdlNumber) || y.filings <= 0) return null;
  return (y.withMdlNumber / y.filings) * 100;
}

export type YearPair = { latest: CaseloadYear; prior: CaseloadYear | null };

/** The latest complete fiscal year and the one before it (when that year is present). */
export function latestPair(years: readonly CaseloadYear[]): YearPair | null {
  const latest = years[years.length - 1];
  if (!latest) return null;
  const prior = years.find((y) => y.fy === latest.fy - 1) ?? null;
  return { latest, prior };
}

/**
 * Pending cases divided by the year's terminations: how many years of terminations at that year's pace the pending
 * docket equals. A stock-to-flow ratio, not a forecast; null when terminations are missing or zero.
 */
export function pendingYears(d: Pick<DistrictRow, "pending" | "terminations">): number | null {
  if (!finite(d.pending) || !finite(d.terminations) || d.terminations <= 0) return null;
  return d.pending / d.terminations;
}

export type DistrictHealth = DistrictRow & {
  clearance: number | null;
  pendingYears: number | null;
};

export function districtHealth(rows: readonly DistrictRow[]): DistrictHealth[] {
  return rows.map((r) => ({ ...r, clearance: clearanceRate(r), pendingYears: pendingYears(r) }));
}

/** Pending MDLs with a recorded 12-month change, largest rises and largest falls (each at most `n`). */
export function mdlMovers(rows: readonly MdlRow[], n = 6): { up: MdlRow[]; down: MdlRow[] } {
  const moving = rows.filter((r) => r.status === "pending" && finite(r.change12m));
  const up = moving
    .filter((r) => r.change12m! > 0)
    .sort((a, b) => b.change12m! - a.change12m!)
    .slice(0, n);
  const down = moving
    .filter((r) => r.change12m! < 0)
    .sort((a, b) => a.change12m! - b.change12m!)
    .slice(0, n);
  return { up, down };
}

/** Largest pending MDLs by actions pending in the latest report (rows without the figure are left out). */
export function largestMdls(rows: readonly MdlRow[], n = 10): MdlRow[] {
  return rows
    .filter((r) => r.status === "pending" && finite(r.pending))
    .sort((a, b) => b.pending! - a.pending!)
    .slice(0, n);
}

/** Portfolio point 12 months before the latest (exact calendar month), for the KPI comparison. */
export function portfolioChange(overview: Pick<MdlOverview, "portfolio">) {
  const pts = [...overview.portfolio].sort((a, b) => a.date.localeCompare(b.date));
  const last = pts[pts.length - 1];
  if (!last) return null;
  const y = Number(last.date.slice(0, 4)) - 1;
  const key = `${y}${last.date.slice(4, 7)}`;
  const prior = pts.find((p) => p.date.slice(0, 7) === key) ?? null;
  return { last, prior };
}

/** Share of pending actions in mass-tort MDLs in a portfolio point. */
export function massTortShare(p: { pending: number; mass_tort_pending: number }): number | null {
  if (!finite(p.pending) || !finite(p.mass_tort_pending) || p.pending <= 0) return null;
  return (p.mass_tort_pending / p.pending) * 100;
}

export const fmtInt = (v: number | null | undefined) =>
  finite(v) ? Math.round(v).toLocaleString("en-US") : "Not recorded";

export const fmtPct = (v: number | null | undefined, digits = 1) =>
  finite(v) ? `${v.toFixed(digits)}%` : "Not recorded";

export const fmtSignedInt = (v: number | null | undefined) =>
  finite(v)
    ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("en-US")}`
    : "Not recorded";

export const fmtSignedPct = (v: number | null | undefined) =>
  finite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%` : "Not recorded";

/** "Oct 2026" from an ISO date. */
export function monthYear(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
