/**
 * Pure builders for the courts and judiciary blocks of the Analytics overview. Each takes already-validated rows
 * (the readers in ../overview.server.ts parse the stored JSON) and returns the block, or null when there is nothing
 * to draw. No I/O, no clock: the caller passes the dates it needs.
 */
import {
  assembleBlock,
  congressIsOpen,
  densifyMonths,
  formatCount,
  longDate,
  ordinal,
  yearPoints,
  type TrendBlockData,
  type TrendPoint,
  type TrendSeries,
} from "../trend";

export type FiscalYearFlow = {
  fy: number;
  /** The fiscal year was still in progress at the snapshot. */
  partial: boolean;
  filed: number | null;
  terminated: number | null;
};

function flowSeries(rows: readonly FiscalYearFlow[], filedLabel: string, terminatedLabel: string) {
  const filed: TrendSeries = {
    id: "filed",
    label: filedLabel,
    points: yearPoints(rows.map((r) => ({ year: r.fy, value: r.filed, partial: r.partial }))),
  };
  const terminated: TrendSeries = {
    id: "terminated",
    label: terminatedLabel,
    points: yearPoints(rows.map((r) => ({ year: r.fy, value: r.terminated, partial: r.partial }))),
  };
  return [filed, terminated];
}

const compact = (note: string | null): string[] => (note ? [note] : []);

function partialNote(rows: readonly FiscalYearFlow[], through: string | null): string | null {
  const partial = rows.filter((r) => r.partial).map((r) => r.fy);
  if (!partial.length) return null;
  const label = partial.map((fy) => `FY${fy}*`).join(", ");
  return through
    ? `${label} runs through ${longDate(through)} only; it is drawn dashed and is not used for the latest value or its change.`
    : `${label} is still in progress; it is drawn dashed and is not used for the latest value or its change.`;
}

/** FJC Integrated Database: civil cases filed and terminated per fiscal year. */
export function buildFederalCivil(input: {
  rows: readonly FiscalYearFlow[];
  throughDate: string | null;
}): TrendBlockData | null {
  if (!input.rows.some((r) => r.filed !== null)) return null;
  return assembleBlock({
    id: "federal-civil",
    xKind: "fy",
    chart: "line",
    unit: "cases",
    series: flowSeries(input.rows, "Filed", "Terminated"),
    source: {
      label: "Federal Judicial Center, Integrated Database (civil cases)",
      url: "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present",
    },
    asOf: input.throughDate,
    notes: [
      "Fiscal years run October 1 to September 30 and are named for the year they end.",
      "Filed and terminated are counted separately: a year's terminations include cases filed in earlier years, so the two lines can cross.",
      ...compact(partialNote(input.rows, input.throughDate)),
    ],
  });
}

/** FJC Integrated Database: criminal defendants filed and terminated per fiscal year. */
export function buildFederalCriminal(input: {
  rows: readonly FiscalYearFlow[];
  throughDate: string | null;
}): TrendBlockData | null {
  if (!input.rows.some((r) => r.filed !== null)) return null;
  return assembleBlock({
    id: "federal-criminal",
    xKind: "fy",
    chart: "line",
    unit: "defendants",
    series: flowSeries(input.rows, "Filed", "Terminated"),
    source: {
      label: "Federal Judicial Center, Integrated Database (criminal defendants)",
      url: "https://www.fjc.gov/research/idb/criminal-defendants-filed-terminated-and-pending-fy-1996-present",
    },
    asOf: input.throughDate,
    notes: [
      "Counts are defendants, not cases: one case can have several defendants. Filed and terminated include inter-district transfers, as in the Administrative Office's Judicial Business Table D.",
      "Fiscal years run October 1 to September 30 and are named for the year they end.",
      ...compact(partialNote(input.rows, input.throughDate)),
    ],
  });
}

export type MdlFiscalYear = {
  fy: number;
  pending: number | null;
  /** Months the printed report period covers (12, except FY1992 which prints 15). */
  periodMonths: number | null;
};

export type MdlMonthlyReport = { date: string; pending: number; mdls: number };

/** JPML fiscal-year statistics: actions pending in transferee districts at the end of each fiscal year. */
export function buildMdlPending(input: {
  years: readonly MdlFiscalYear[];
  monthly: readonly MdlMonthlyReport[];
}): TrendBlockData | null {
  if (!input.years.some((y) => y.pending !== null)) return null;
  const long = input.years.filter((y) => y.periodMonths !== null && y.periodMonths !== 12);
  const monthly = [...input.monthly].sort((a, b) => a.date.localeCompare(b.date));
  const first = monthly[0];
  const last = monthly[monthly.length - 1];
  return assembleBlock({
    id: "mdl-pending",
    xKind: "fy",
    chart: "bar",
    unit: "actions",
    series: [
      {
        id: "pending",
        label: "Actions pending at fiscal-year end",
        points: yearPoints(input.years.map((y) => ({ year: y.fy, value: y.pending }))),
      },
    ],
    source: {
      label: "Judicial Panel on Multidistrict Litigation, fiscal-year statistics",
      url: "https://www.jpml.uscourts.gov/statistics-info",
    },
    notes: [
      "Each bar is the total of actions pending in MDL transferee districts on September 30 of that fiscal year, as printed in the Panel's circuit-and-district table.",
      ...long.map(
        (y) =>
          `FY${y.fy} prints a ${y.periodMonths}-month period, not twelve; it is shown as published.`,
      ),
      ...(first && last && first.date !== last.date
        ? [
            `The Panel's monthly pending-MDL report of ${last.date} lists ${formatCount(last.pending)} pending actions in ${formatCount(last.mdls)} MDLs; the report of ${first.date}, the first monthly report held, lists ${formatCount(first.pending)} in ${formatCount(first.mdls)}.`,
          ]
        : []),
    ],
  });
}

export type SecuritiesYear = { year: number; filings: number | null; partial: boolean };

/** Stanford Securities Class Action Clearinghouse: federal securities class action filings per calendar year. */
export function buildSecurities(input: {
  years: readonly SecuritiesYear[];
  throughDate: string | null;
}): TrendBlockData | null {
  if (!input.years.some((y) => y.filings !== null)) return null;
  const partial = input.years.filter((y) => y.partial).map((y) => y.year);
  return assembleBlock({
    id: "securities-class-actions",
    xKind: "year",
    chart: "bar",
    unit: "filings",
    series: [
      {
        id: "filings",
        label: "Filings",
        points: yearPoints(
          input.years.map((y) => ({ year: y.year, value: y.filings, partial: y.partial })),
        ),
      },
    ],
    source: {
      label: "Stanford Law School Securities Class Action Clearinghouse",
      url: "https://securities.stanford.edu/",
    },
    asOf: input.throughDate,
    notes: [
      "Counts are filings of federal securities class actions by calendar year, as published by the Clearinghouse in cooperation with Cornerstone Research.",
      ...(partial.length
        ? [
            input.throughDate
              ? `${partial.map((y) => `${y}*`).join(", ")} runs through ${longDate(input.throughDate)}; the Clearinghouse publishes no newer filings. It is not used for the latest value.`
              : `${partial.map((y) => `${y}*`).join(", ")} is a partial year and is not used for the latest value.`,
          ]
        : []),
    ],
  });
}

export type VacancyMonthInput = {
  month: string;
  /** Vacancies the month's list printed, only when the whole list was read. */
  vacanciesListed: number | null;
};

/** AO monthly vacancy lists: current judgeships vacant, one point per month the whole list was read. */
export function buildVacancies(input: {
  months: readonly VacancyMonthInput[];
  asOf: string | null;
}): TrendBlockData | null {
  const recorded = input.months.filter((m) => m.vacanciesListed !== null);
  if (!recorded.length) return null;
  const sorted = [...input.months].sort((a, b) => a.month.localeCompare(b.month));
  const values = new Map(sorted.map((m) => [m.month, m.vacanciesListed] as const));
  const points: TrendPoint[] = densifyMonths(
    values,
    sorted[0]!.month,
    sorted[sorted.length - 1]!.month,
  );
  const missing = points.filter((p) => p.value === null).length;
  return assembleBlock({
    id: "judicial-vacancies",
    xKind: "month",
    chart: "line",
    unit: "vacancies",
    series: [{ id: "vacancies", label: "Vacancies listed", points }],
    // Compared with the same month a year earlier: a vacancy list is a snapshot, so month to month is mostly noise.
    lag: 12,
    source: {
      label: "Administrative Office of the U.S. Courts, judicial vacancies archive",
      url: "https://www.uscourts.gov/data-news/judicial-vacancies/archive-judicial-vacancies",
    },
    asOf: input.asOf,
    notes: [
      "Each point is the number of vacancies on that month's published list, counted only when the whole list was read.",
      `${formatCount(missing)} of ${formatCount(points.length)} months are not recorded and are left as gaps: scanned reports without a text layer, report layouts not supported, or lists only partly read. Gaps are not zero vacancies.`,
      "The change compares the latest month with the same month a year earlier.",
    ],
  });
}

export type NominationCongress = { congress: number; received: number; confirmed: number };

/** Congress.gov: nominations to Article III and territorial judgeships received, and confirmed, per Congress. */
export function buildNominations(input: {
  congresses: readonly NominationCongress[];
  asOf: string;
}): TrendBlockData | null {
  if (!input.congresses.length) return null;
  const sorted = [...input.congresses].sort((a, b) => a.congress - b.congress);
  const mark = (n: number) => congressIsOpen(n, input.asOf);
  const open = sorted.filter((c) => mark(c.congress)).map((c) => c.congress);
  const pt = (c: NominationCongress, v: number): TrendPoint => ({
    x: String(c.congress),
    value: v,
    ...(mark(c.congress) ? { partial: true } : {}),
  });
  return assembleBlock({
    id: "judicial-nominations",
    xKind: "congress",
    chart: "bar",
    unit: "nominations",
    series: [
      { id: "received", label: "Received", points: sorted.map((c) => pt(c, c.received)) },
      { id: "confirmed", label: "Confirmed", points: sorted.map((c) => pt(c, c.confirmed)) },
    ],
    source: {
      label: "Congress.gov (Library of Congress), nominations",
      url: "https://www.congress.gov/nomination",
    },
    asOf: input.asOf,
    notes: [
      "Each record is one nomination (a PN citation, including part numbers) to the Supreme Court, courts of appeals, district courts, Court of International Trade or a territorial district court. Other judiciary nominations are excluded.",
      "A nomination returned to the President, withdrawn or still pending at the end of a Congress counts under Received but not Confirmed.",
      ...(open.length
        ? [
            `The ${open.map((n) => ordinal(n)).join(", ")} Congress is still sitting (data as of ${longDate(input.asOf)}), so it is drawn as a partial period and not used for the latest value.`,
          ]
        : []),
    ],
  });
}
