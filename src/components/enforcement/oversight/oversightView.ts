/** Pure display helpers for the oversight views (unit-tested). Nothing here estimates, interpolates or projects. */
import type {
  DojDocument,
  MoneyYear,
  OversightTrend,
  TrendYear,
} from "@/lib/external/oversight.functions";

export const NOT_RECORDED = "Not recorded";
export const ALL_OTHER = "All other types";
const TOP_TYPES = 4;

export function fmtInt(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? NOT_RECORDED : Math.round(n).toLocaleString("en-US");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** ISO yyyy-mm-dd shown as "17 Oct 2026" without time-zone conversion. */
export function fmtDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : NOT_RECORDED;
}

/** Whole dollars as printed ("$4,577,633"); millions and billions are spelled out above $10 million. */
export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return NOT_RECORDED;
  if (Math.abs(n) >= 1e9)
    return `$${(n / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 })} billion`;
  if (Math.abs(n) >= 1e7)
    return `$${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })} million`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Compact dollars for a chart axis ("$35M"); tooltips and tables show the full figure with fmtUsd. */
export function fmtUsdAxis(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
  if (a >= 1e6) return `$${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  if (a >= 1e3) return `$${(n / 1e3).toLocaleString("en-US", { maximumFractionDigits: 0 })}K`;
  return `$${Math.round(n)}`;
}

/** "1-25 of 36,309" for a page of results; the total may be unknown. */
export function rangeLabel(
  page: number,
  pageSize: number,
  shown: number,
  total: number | null,
): string {
  if (shown === 0) return total === 0 ? "No results" : "No more results";
  const from = page * pageSize + 1;
  const to = page * pageSize + shown;
  return total != null
    ? `${fmtInt(from)}-${fmtInt(to)} of ${fmtInt(total)}`
    : `${fmtInt(from)}-${fmtInt(to)}`;
}

/** The report types to draw as their own series: the largest by count, in a stable order; the rest are one group. */
export function topTypes(totals: Record<string, number>, n = TOP_TYPES): string[] {
  return Object.entries(totals)
    .filter(([name]) => name !== NOT_RECORDED)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name]) => name);
}

export type ReportYearRow = {
  year: number;
  label: string;
  partial: boolean;
  total: number;
  [group: string]: number | string | boolean;
};

/**
 * One row per calendar year from the first to the last year with a listed report. A year without a listed report is
 * a row of zero listed reports (a count of the list, not a claim that the office published nothing). The year of
 * `asOf` is partial and gets an asterisk.
 */
export function reportYearRows(trend: OversightTrend, types: readonly string[]): ReportYearRow[] {
  if (!trend.years.length) return [];
  const byYear = new Map(trend.years.map((y) => [y.year, y]));
  const first = trend.years[0]!.year;
  const last = trend.years[trend.years.length - 1]!.year;
  const partialYear = trend.asOf ? Number(trend.asOf.slice(0, 4)) : null;
  const rows: ReportYearRow[] = [];
  for (let year = first; year <= last; year += 1) {
    const y = byYear.get(year);
    const partial = year === partialYear;
    const row: ReportYearRow = {
      year,
      label: partial ? `${year}*` : String(year),
      partial,
      total: y?.reports ?? 0,
    };
    let named = 0;
    for (const t of types) {
      const n = y?.types[t] ?? 0;
      row[t] = n;
      named += n;
    }
    row[ALL_OTHER] = (y?.reports ?? 0) - named;
    rows.push(row);
  }
  return rows;
}

export type RecsYearRow = {
  year: number;
  label: string;
  partial: boolean;
  recs: number;
  recsReports: number;
  reports: number;
};

/** Recommendations the OIG states, by report year, next to how many of that year's reports state a count. */
export function recsYearRows(trend: OversightTrend): RecsYearRow[] {
  const partialYear = trend.asOf ? Number(trend.asOf.slice(0, 4)) : null;
  return trend.years.map((y: TrendYear) => ({
    year: y.year,
    label: y.year === partialYear ? `${y.year}*` : String(y.year),
    partial: y.year === partialYear,
    recs: y.recs,
    recsReports: y.recsReports,
    reports: y.reports,
  }));
}

export type MoneyRow = {
  year: number;
  label: string;
  partial: boolean;
  questionedCosts: number | null;
  fundsBetterUse: number | null;
  reports: number;
  questionedReports: number;
  betterUseReports: number;
};

/**
 * Money by report year as the OIG states it. A figure is drawn only for a year in which at least one report states that
 * amount; every other year is a gap (null), never a zero. `reports` and the stating counts accompany each year.
 */
export function moneyYearRows(years: readonly MoneyYear[], asOf: string | null): MoneyRow[] {
  const partialYear = asOf ? Number(asOf.slice(0, 4)) : null;
  return years.map((y) => ({
    year: y.year,
    label: y.year === partialYear ? `${y.year}*` : String(y.year),
    partial: y.year === partialYear,
    questionedCosts: y.questionedReports > 0 ? y.questionedCosts : null,
    fundsBetterUse: y.betterUseReports > 0 ? y.fundsBetterUse : null,
    reports: y.reports,
    questionedReports: y.questionedReports,
    betterUseReports: y.betterUseReports,
  }));
}

export function recsLabel(n: number | null | undefined): string {
  return n == null ? NOT_RECORDED : String(n);
}

/** The latest N years of a trend as a plain-language coverage line. */
export function coverageLine(trend: OversightTrend): string {
  const t = trend.totals;
  const span =
    t.firstDate && t.lastDate ? `${fmtDate(t.firstDate)} to ${fmtDate(t.lastDate)}` : NOT_RECORDED;
  const undated = t.undated
    ? `; ${fmtInt(t.undated)} without a report date are counted in the total only`
    : "";
  return `${fmtInt(t.reports)} listed reports, report dates ${span}${undated}`;
}

export function groupDocuments(
  docs: readonly DojDocument[],
): { group: string; docs: DojDocument[] }[] {
  const order: string[] = [];
  const by = new Map<string, DojDocument[]>();
  for (const d of docs) {
    const g = d.group ?? NOT_RECORDED;
    if (!by.has(g)) {
      by.set(g, []);
      order.push(g);
    }
    by.get(g)!.push(d);
  }
  return order.map((group) => ({ group, docs: by.get(group)! }));
}
