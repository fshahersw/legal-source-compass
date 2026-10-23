/**
 * Pure builders for the MDL trend cards (the case lens and the matter page). Each takes already-validated rows and
 * returns the same `TrendBlockData` the Analytics hub draws, or null when there is nothing to plot. No I/O, no clock:
 * the caller passes every date it needs. A period the source does not record is a gap (null), never zero; the one
 * exception is the FJC Integrated Database, which lists every civil case, so a year with no case is a counted zero.
 */
import {
  assembleBlock,
  densifyMonths,
  formatCount,
  longDate,
  periodLabel,
  yearPoints,
  type TrendBlockData,
  type TrendPoint,
  type XKind,
} from "@/lib/analytics/trend";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type MonthlyReport = {
  /** "YYYY-MM" of the report. */
  month: string;
  pending: number | null;
  total: number | null;
};

/** A share of a whole as text: one decimal from 1%, two from 0.01%, otherwise "less than 0.01%". */
export function sharePct(p: number): string {
  if (p >= 1) return `${p.toFixed(1)}%`;
  if (p >= 0.01) return `${p.toFixed(2)}%`;
  return "less than 0.01%";
}

const monthIndex = (m: string): number => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return y * 12 + (mo - 1);
};

/**
 * Month keys that stay readable on a short axis. The shared chart labels a month axis with its year only, which
 * repeats on a two-year span, so spans up to three years are keyed as "YYYY-MM" text on a plain axis.
 */
export function monthAxis(first: string, last: string): XKind {
  return monthIndex(last) - monthIndex(first) <= 36 ? "year" : "month";
}

/** JPML monthly "Distribution of Pending MDL Dockets by Actions Pending" reports: pending and total actions of one MDL. */
export function buildMdlMonthlyPending(input: {
  mdl: number;
  reports: readonly MonthlyReport[];
  /** Date of the newest report, when the source states it. */
  lastReportDate: string | null;
}): TrendBlockData | null {
  const byMonth = new Map<string, MonthlyReport>();
  for (const r of input.reports)
    if (MONTH.test(r.month) && !byMonth.has(r.month)) byMonth.set(r.month, r);
  const months = [...byMonth.keys()].sort();
  if (!months.length) return null;
  const first = months[0]!;
  const last = months[months.length - 1]!;
  if (![...byMonth.values()].some((r) => r.pending !== null)) return null;
  const pending = densifyMonths(
    new Map([...byMonth].map(([m, r]) => [m, r.pending] as const)),
    first,
    last,
  );
  const total = densifyMonths(
    new Map([...byMonth].map(([m, r]) => [m, r.total] as const)),
    first,
    last,
  );
  const span = pending.length;
  const peak = (points: readonly TrendPoint[]) =>
    points.reduce((m, p) => (p.value !== null && p.value > m ? p.value : m), 0);
  // The cumulative total of a mostly closed MDL dwarfs its pending actions and would flatten that line, so it is drawn
  // only when it is within three times the pending peak.
  const drawTotal = peak(total) <= 3 * peak(pending);
  return assembleBlock({
    id: `mdl-monthly-pending-${input.mdl}`,
    xKind: monthAxis(first, last),
    chart: "line",
    unit: "actions",
    series: [
      { id: "pending", label: "Pending actions", points: pending },
      ...(drawTotal
        ? [{ id: "total", label: "Total actions (pending and closed)", points: total }]
        : []),
    ],
    lag: span >= 13 ? 12 : 1,
    source: {
      label: "Judicial Panel on Multidistrict Litigation, pending MDL reports",
      url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
    },
    asOf: input.lastReportDate,
    notes: [
      "Each point is the figure the Panel printed for this MDL in that month's report; a month without a report is left as a gap, not drawn as zero.",
      drawTotal
        ? "Pending actions are the actions still open in the MDL. Total actions is the report's own total column, which also counts actions already closed."
        : "Pending actions are the actions still open in the MDL. The report's total column also counts actions already closed; it is much larger than the pending line, so it is not drawn and is shown in the summary above.",
      `The series holds the monthly reports kept in this corpus, from ${periodLabel(first, "month")}; earlier years are in the fiscal-year chart.`,
    ],
  });
}

export type FiscalYearPending = { fy: number; pending: number | null };

/** JPML Statistical Analysis: actions of one MDL pending on September 30 of each fiscal year. */
export function buildMdlFyPending(input: {
  mdl: number;
  rows: readonly FiscalYearPending[];
  leftCensored: boolean;
}): TrendBlockData | null {
  const points = yearPoints(input.rows.map((r) => ({ year: r.fy, value: r.pending })));
  if (!points.some((p) => p.value !== null)) return null;
  const blanks = points.filter((p) => p.value === null).map((p) => `FY${p.x}`);
  const lastFy = Number(points[points.length - 1]!.x);
  return assembleBlock({
    id: `mdl-fy-pending-${input.mdl}`,
    xKind: "fy",
    chart: "bar",
    unit: "actions",
    series: [{ id: "pending", label: "Actions pending on September 30", points }],
    source: {
      label: "Judicial Panel on Multidistrict Litigation, Statistical Analysis of MDL",
      url: "https://www.jpml.uscourts.gov/statistics-info",
    },
    asOf: `${lastFy}-09-30`,
    notes: [
      "Each bar is the number of actions the Panel's fiscal-year table prints as pending for this MDL on September 30. Fiscal years run October 1 to September 30 and are named for the year they end.",
      ...(blanks.length
        ? [
            `${blanks.join(", ")} ${blanks.length === 1 ? "is" : "are"} left blank: that year's edition failed the printed-total checks or does not list this MDL, so no value is drawn.`,
          ]
        : []),
      ...(input.leftCensored
        ? ["The first bar is the earliest edition held; the MDL may have been pending earlier."]
        : []),
    ],
  });
}

export type FiscalYearCases = { fy: number; cases: number };

/** The fiscal year (October 1 to September 30, named for the year it ends) that contains an ISO date. */
export function fiscalYearOf(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return Number(m[1]) + (month >= 10 ? 1 : 0);
}

/**
 * FJC Integrated Database: civil cases whose record carries this MDL docket number, by fiscal year of filing. The
 * file lists every civil case, so a year inside the range with no such case is a counted zero. The fiscal year the
 * file's filing dates stop in is partial.
 */
export function buildMdlFjcYears(input: {
  mdl: number;
  rows: readonly FiscalYearCases[];
  /** Filing dates in the file run through this ISO date. */
  through: string | null;
  /** Civil cases filed in all federal district courts per fiscal year (the same file), the national baseline. */
  national?: ReadonlyMap<number, number>;
}): TrendBlockData | null {
  const byFy = new Map<number, number>();
  for (const r of input.rows)
    if (Number.isInteger(r.fy) && r.cases >= 0 && !byFy.has(r.fy)) byFy.set(r.fy, r.cases);
  if (!byFy.size) return null;
  const fys = [...byFy.keys()].sort((a, b) => a - b);
  const lo = fys[0]!;
  const hi = fys[fys.length - 1]!;
  const throughFy = input.through ? fiscalYearOf(input.through) : null;
  const partialFy =
    throughFy !== null && input.through !== null && input.through < `${throughFy}-09-30`
      ? throughFy
      : null;
  const points: TrendPoint[] = [];
  for (let fy = lo; fy <= hi; fy += 1)
    points.push({
      x: String(fy),
      value: byFy.get(fy) ?? 0,
      ...(fy === partialFy ? { partial: true } : {}),
    });
  const share = (fy: number): string | null => {
    const n = input.national?.get(fy);
    const c = byFy.get(fy);
    if (n === undefined || n <= 0 || c === undefined || c <= 0) return null;
    return `In FY${fy} these ${formatCount(c)} cases were ${sharePct((100 * c) / n)} of the ${formatCount(n)} civil cases filed in all federal district courts.`;
  };
  const complete = points.filter((p) => !p.partial && p.value !== null);
  const peakFy = complete.reduce<TrendPoint | null>(
    (best, p) => (best === null || (p.value ?? 0) > (best.value ?? 0) ? p : best),
    null,
  );
  const lastFy = complete[complete.length - 1];
  const baseline = [
    ...(peakFy ? [share(Number(peakFy.x))] : []),
    ...(lastFy && lastFy.x !== peakFy?.x ? [share(Number(lastFy.x))] : []),
  ].filter((t): t is string => t !== null);
  return assembleBlock({
    id: `mdl-fjc-years-${input.mdl}`,
    xKind: "fy",
    chart: "bar",
    unit: "cases",
    series: [{ id: "cases", label: "Civil cases filed", points }],
    source: {
      label: "Federal Judicial Center, Integrated Database (civil cases)",
      url: "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present",
    },
    asOf: input.through,
    notes: [
      "A case is counted when its record carries this MDL docket number (field MDLDOCK). That is a historical association in the Federal Judicial Center's file, not the Panel's current membership list, and it counts cases in every district they were filed.",
      "Fiscal years run October 1 to September 30 and are named for the year they end. The file lists every civil case, so a year in the range with none is drawn as zero.",
      ...baseline,
      ...(partialFy !== null && input.through
        ? [
            `FY${partialFy}* holds filings only through ${longDate(input.through)}; it is drawn faded and is not used for the latest value or its change.`,
          ]
        : []),
    ],
  });
}

export type YearCount = { year: number; n: number };

/**
 * Matter-registry counts by year filed (member actions, or member dockets first filed in another court). The registry
 * is a partial count, so a year with no registry docket is a gap and not a zero; the year the registry was last
 * published in is partial.
 */
export function buildMdlRegistryYears(input: {
  id: "mdl-members-years" | "mdl-transferred-years";
  mdl: number;
  rows: readonly YearCount[];
  unit: string;
  seriesLabel: string;
  publishedYear: number | null;
  publishedOn: string | null;
  sourcePath: string;
  /** All dockets the record counts, of which only those with a filing year are in `rows`. */
  total: number | null;
  /** What `total` counts, e.g. "member actions". */
  totalLabel: string;
  extraNotes?: readonly string[];
}): TrendBlockData | null {
  const lastYear = input.rows.length ? Math.max(...input.rows.map((r) => r.year)) : null;
  const partialYear = lastYear !== null && input.publishedYear === lastYear ? lastYear : null;
  const plotted = input.rows.reduce((sum, r) => sum + r.n, 0);
  const points = yearPoints(
    input.rows.map((r) => ({
      year: r.year,
      value: r.n,
      ...(r.year === partialYear ? { partial: true } : {}),
    })),
  );
  if (!points.length) return null;
  return assembleBlock({
    id: `${input.id}-${input.mdl}`,
    xKind: "year",
    chart: "bar",
    unit: input.unit,
    series: [{ id: "n", label: input.seriesLabel, points }],
    source: { label: "Matter registry, MDL hierarchy record", url: input.sourcePath },
    asOf: null,
    notes: [
      "Counts only what the matter registry records, by the year each docket was filed. Membership is never inferred from a caption, product, judge or firm, so this is a partial count and not the size of the MDL.",
      "A year with no registry docket is left as a gap: it does not mean none was filed.",
      ...(input.total !== null && plotted < input.total
        ? [
            `${formatCount(plotted)} of ${formatCount(input.total)} ${input.totalLabel} have a filing year (their docket is joined to CourtListener by exact docket id); the other ${formatCount(input.total - plotted)} are not plotted.`,
          ]
        : []),
      ...(partialYear !== null
        ? [
            `${partialYear}* is the year the registry was last published${input.publishedOn ? ` (${longDate(input.publishedOn)})` : ""}; it is drawn faded and is not used for the latest value or its change.`,
          ]
        : []),
      ...(input.extraNotes ?? []),
    ],
  });
}

/** "12,345 of 20,000" for a coverage note. */
export const ofTotal = (n: number, total: number): string =>
  `${formatCount(n)} of ${formatCount(total)}`;
