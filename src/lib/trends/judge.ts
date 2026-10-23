/**
 * Pure builders for the judge page's trend cards, from CourtListener's collection (dockets and opinions by year, panels by
 * year) and the financial-disclosure reports CourtListener holds. Every count is a count of what that collection holds,
 * never of a judge's whole caseload; a year with no record is a gap, not zero; the year the snapshot was taken in is partial.
 */
import {
  assembleBlock,
  formatCount,
  longDate,
  yearPoints,
  type TrendBlockData,
  type TrendSeries,
} from "@/lib/analytics/trend";

/** The date the CourtListener bulk-data snapshot behind the clb_* datasets was taken (their labels read "Sept 30, 2026"). */
export const CL_SNAPSHOT = "2026-09-30";

export type YearN = { yr: number; n: number };

const snapshotYear = (snapshot: string): number => Number(snapshot.slice(0, 4));
const yearEnd = (y: number) => `${y}-12-31`;

/** One count by calendar year of CourtListener's collection (assigned dockets, authored opinions, recorded panels). */
export function buildClYears(input: {
  id: string;
  rows: readonly YearN[];
  unit: string;
  seriesLabel: string;
  /** The count of everything the record holds, of which only the rows with a year are in `rows`. */
  total: number | null;
  totalLabel: string;
  /** What the count is, in one sentence. */
  counts: string;
  personId: number;
  snapshot?: string;
}): TrendBlockData | null {
  const snapshot = input.snapshot ?? CL_SNAPSHOT;
  const y = snapshotYear(snapshot);
  const points = yearPoints(
    input.rows.map((r) => ({
      year: r.yr,
      value: r.n,
      ...(r.yr === y && snapshot < yearEnd(y) ? { partial: true } : {}),
    })),
  );
  if (!points.length) return null;
  const plotted = input.rows.reduce((sum, r) => sum + r.n, 0);
  const hasPartial = points.some((p) => p.partial);
  return assembleBlock({
    id: input.id,
    xKind: "year",
    chart: "bar",
    unit: input.unit,
    series: [{ id: "n", label: input.seriesLabel, points }],
    source: {
      label: "CourtListener, person page and bulk data",
      url: `https://www.courtlistener.com/person/${input.personId}/`,
    },
    asOf: snapshot,
    notes: [
      `${input.counts} This is CourtListener's collection, not a complete caseload or a measure of quality.`,
      "A year with no record in the collection is left as a gap: it does not mean none existed.",
      ...(input.total !== null && plotted < input.total
        ? [
            `${formatCount(plotted)} of ${formatCount(input.total)} ${input.totalLabel} carry a year; the other ${formatCount(input.total - plotted)} are not plotted.`,
          ]
        : []),
      ...(hasPartial
        ? [
            `${y}* holds records only through ${longDate(snapshot)}; it is drawn faded and is not used for the latest value or its change.`,
          ]
        : []),
    ],
  });
}

export type DisclosureYearCounts = {
  year: number;
  reports: number;
  items: { investments: number; gifts: number; reimbursements: number; agreements: number };
};

const DISCLOSURE_SERIES = [
  ["investments", "Investments"],
  ["gifts", "Gifts"],
  ["reimbursements", "Reimbursements"],
  ["agreements", "Agreements"],
] as const;

/**
 * Items listed on a judge's financial disclosure reports, by report year, as CourtListener extracted them. A year with no
 * report on file is a gap; a year with a report and no item of a kind is a counted zero.
 */
export function buildDisclosureItems(input: {
  personId: number;
  years: readonly DisclosureYearCounts[];
}): TrendBlockData | null {
  const reported = input.years.filter((y) => y.reports > 0);
  if (reported.length < 2) return null;
  const series: TrendSeries[] = DISCLOSURE_SERIES.map(([key, label]) => ({
    id: key,
    label,
    points: yearPoints(reported.map((y) => ({ year: y.year, value: y.items[key] }))),
  }));
  return assembleBlock({
    id: `judge-disclosure-items-${input.personId}`,
    xKind: "year",
    chart: "line",
    unit: "items",
    series,
    source: {
      label: "CourtListener, financial disclosure reports",
      url: `https://www.courtlistener.com/person/${input.personId}/`,
    },
    asOf: null,
    notes: [
      "Each point is the number of items of that kind listed on the report or reports for that report year, as CourtListener extracted them. It counts items, not their value, and says nothing about conflicts or recusal.",
      "A year with no report on file is left as a gap. Only investments, gifts, reimbursements and agreements are drawn; the other sections are in the table.",
    ],
  });
}
