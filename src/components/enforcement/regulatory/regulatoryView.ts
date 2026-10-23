/** Pure view helpers for the financial-regulatory panels: chart series, labels, query definitions. */
import {
  getCompanyRegulatory,
  getFrbOverview,
  getRegistrationTrends,
  type AdviserTable,
  type BdOverview,
  type FrbFamily,
  type FrbOverview,
} from "@/lib/external/regulatoryRecords.functions";

export const NOT_RECORDED = "Not recorded";

export const regulatoryQueryKey = ["regulatory-records"] as const;

export const frbOverviewQuery = {
  queryKey: [...regulatoryQueryKey, "frb-overview"],
  queryFn: () => getFrbOverview(),
  staleTime: 10 * 60 * 1000,
};

export const registrationTrendsQuery = {
  queryKey: [...regulatoryQueryKey, "registration-trends"],
  queryFn: () => getRegistrationTrends(),
  staleTime: 10 * 60 * 1000,
};

export const companyRegulatoryQuery = (cik: string) => ({
  queryKey: [...regulatoryQueryKey, "company", cik],
  queryFn: () => getCompanyRegulatory({ data: { cik } }),
  staleTime: 10 * 60 * 1000,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" -> "Oct 2026"; anything else is returned unchanged. */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : month;
}

/** "2018-02-02" -> "Feb 2, 2018"; anything else is returned unchanged. */
export function dayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${Number(m[3])}, ${m[1]}` : date;
}

export const fmtInt = (n: number) => n.toLocaleString("en-US");

/** USD amount as the SEC states it, scaled for reading ("$4.09 trillion"), never rounded to another magnitude. */
export function usdLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NOT_RECORDED;
  const abs = Math.abs(value);
  const f = (n: number, unit: string) =>
    `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}`;
  if (abs >= 1e12) return f(value / 1e12, "trillion");
  if (abs >= 1e9) return f(value / 1e9, "billion");
  if (abs >= 1e6) return f(value / 1e6, "million");
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------------------- Fed chart groups

/**
 * Chart groups: the five largest action families keep their own bar segment; the four smallest (prompt corrective action,
 * notices of intent, amendments and modifications, other order types) share "All other families".
 */
export const FRB_CHART_GROUPS = [
  "Written agreements",
  "Cease-and-desist and consent orders",
  "Civil money penalties",
  "Prohibitions and suspensions",
  "Section 19 letters",
  "All other families",
] as const;
export type FrbChartGroup = (typeof FRB_CHART_GROUPS)[number];

export const OTHER_FAMILIES: readonly FrbFamily[] = [
  "Prompt corrective action",
  "Notices of intent",
  "Amendments and modifications",
  "Other order types",
];

export function chartGroupOf(family: FrbFamily): FrbChartGroup {
  return (OTHER_FAMILIES as readonly string[]).includes(family)
    ? "All other families"
    : (family as FrbChartGroup);
}

export type FrbYearRow = { year: string; label: string; total: number; partial: boolean } & Record<
  FrbChartGroup,
  number
>;

/** One row per calendar year from the first to the last year with an effective date; years with no rows are 0 rows. */
export function frbYearRows(overview: FrbOverview): FrbYearRow[] {
  const first = Number(overview.firstEffectiveDate.slice(0, 4));
  const last = Number(overview.latestEffectiveDate.slice(0, 4));
  const rows: FrbYearRow[] = [];
  for (let y = first; y <= last; y += 1) {
    const year = String(y);
    const fams = overview.byYearFamily[year] ?? {};
    const row = {
      year,
      label: year === overview.partialYear ? `${year}*` : year,
      total: 0,
      partial: year === overview.partialYear,
      ...Object.fromEntries(FRB_CHART_GROUPS.map((g) => [g, 0])),
    } as FrbYearRow;
    for (const [fam, n] of Object.entries(fams)) {
      row[chartGroupOf(fam as FrbFamily)] += n ?? 0;
      row.total += n ?? 0;
    }
    rows.push(row);
  }
  return rows;
}

/** Years a family filter applies to, descending, for the Year select. */
export function frbYears(overview: FrbOverview): string[] {
  return Object.keys(overview.byYearFamily).sort((a, b) => b.localeCompare(a));
}

// ------------------------------------------------------------------- broker-dealer monthly series

export type MonthPoint = { month: string; count: number | null };

/** Every month from the first to the latest file; a month with no published file is null (a gap), never 0. */
export function bdMonthlySeries(overview: BdOverview): MonthPoint[] {
  const have = new Map(overview.series.map((s) => [s.month, s.count]));
  const out: MonthPoint[] = [];
  let y = Number(overview.firstMonth.slice(0, 4));
  let m = Number(overview.firstMonth.slice(5, 7));
  const endY = Number(overview.latestMonth.slice(0, 4));
  const endM = Number(overview.latestMonth.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ month, count: have.get(month) ?? null });
    m += 1;
    if (m === 13) {
      y += 1;
      m = 1;
    }
  }
  return out;
}

/** Round axis bounds (multiples of 500) around the monthly counts, and the ticks between them. */
export function bdAxis(rows: { count: number | null }[]): {
  lo: number;
  hi: number;
  ticks: number[];
} {
  const counts = rows.flatMap((r) => (r.count == null ? [] : [r.count]));
  const lo = Math.floor(Math.min(...counts) / 500) * 500;
  const hi = Math.ceil(Math.max(...counts) / 500) * 500;
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += 500) ticks.push(v);
  return { lo, hi, ticks };
}

// ----------------------------------------------------------------------- adviser statistics series

export type YearPoint = { year: number; value: number | null };

function rowSeries(
  table: AdviserTable | null,
  match: (labels: string[]) => boolean,
): YearPoint[] | null {
  const row = table?.rows.find((r) => match(r.labels));
  if (!table || !row) return null;
  return table.years.map((year, i) => ({ year, value: row.values[i] ?? null }));
}

/** Tab.1.1 subtotals: SEC-registered advisers (RIA) and exempt reporting advisers (ERA). */
export function adviserCountSeries(tab11: AdviserTable | null) {
  return {
    ria: rowSeries(tab11, (l) => l[0] === "RIA" && l[1] === "Subtotal"),
    era: rowSeries(tab11, (l) => l[0] === "ERA" && l[1] === "Subtotal"),
  };
}

/** Tab.2.1 "Total" row: aggregate regulatory assets under management reported by registered advisers, $ trillions. */
export function raumSeries(tab21: AdviserTable | null): YearPoint[] | null {
  return rowSeries(tab21, (l) => l[0] === "Total");
}

/** First year in which the series publishes a value other than 0 (earlier zeros are the table's "not yet a category"). */
export function firstNonZeroYear(series: YearPoint[] | null): number | null {
  const hit = series?.find((p) => p.value != null && p.value > 0);
  return hit ? hit.year : null;
}
