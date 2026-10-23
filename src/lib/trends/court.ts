/**
 * Pure builder for the lens's transferee-court card: products-liability cases filed in the court, by fiscal year, from the
 * U.S. Courts Judicial Business tables, with the court's share of its own civil filings, its share of all such filings
 * nationally and its rank as the baselines. A year the tables do not give is a gap, not zero.
 */
import { assembleBlock, yearPoints, type TrendBlockData } from "@/lib/analytics/trend";
import { sharePct } from "./mdl";

const sharePercent = (p: number): string => sharePct(p);

export function buildCourtPlYears(input: {
  courtId: string;
  courtName: string;
  years: readonly number[];
  /** Products-liability cases filed, per fiscal year. */
  pl: readonly (number | null)[];
  /** All civil cases filed in the court, per fiscal year. */
  civil: readonly (number | null)[];
  /** The court's share of all products-liability filings nationally, per fiscal year, in percent. */
  nationalShare: readonly (number | null)[];
  rank: { pl: number | null; of: number | null };
}): TrendBlockData | null {
  const entries = input.years.map((year, i) => ({ year, value: input.pl[i] ?? null }));
  const points = yearPoints(entries);
  if (!points.some((p) => p.value !== null)) return null;
  const lastIdx = (() => {
    for (let i = input.years.length - 1; i >= 0; i -= 1)
      if ((input.pl[i] ?? null) !== null) return i;
    return -1;
  })();
  const fy = lastIdx >= 0 ? input.years[lastIdx]! : null;
  const filed = lastIdx >= 0 ? input.pl[lastIdx]! : null;
  const civil = lastIdx >= 0 ? (input.civil[lastIdx] ?? null) : null;
  const national = lastIdx >= 0 ? (input.nationalShare[lastIdx] ?? null) : null;
  // The stored ranks are for the table's final fiscal year, so they are stated only when that is the year described.
  const rankApplies = lastIdx === input.years.length - 1;
  const baseline: string[] = [];
  if (fy !== null && filed !== null && civil !== null && civil > 0)
    baseline.push(
      `In FY${fy} these ${filed.toLocaleString("en-US")} cases were ${sharePercent((100 * filed) / civil)} of the ${civil.toLocaleString("en-US")} civil cases filed in the court.`,
    );
  if (fy !== null && national !== null)
    baseline.push(
      `The court held ${sharePercent(national)} of all products-liability cases filed in federal district courts in FY${fy}${rankApplies && input.rank.pl && input.rank.of ? `, ranking ${input.rank.pl} of ${input.rank.of} districts` : ""}.`,
    );
  return assembleBlock({
    id: `court-pl-years-${input.courtId}`,
    xKind: "fy",
    chart: "bar",
    unit: "cases",
    series: [{ id: "pl", label: "Products-liability cases filed", points }],
    source: {
      label: "U.S. Courts, Judicial Business of the U.S. Courts (tables C-3 and C-11)",
      url: "https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-business-united-states-courts",
    },
    asOf: null,
    notes: [
      `Counts products-liability cases filed in ${input.courtName} in each fiscal year (October 1 to September 30, named for the year it ends). The counts include MDL actions transferred to the court, so a large MDL can dominate a year.`,
      ...baseline,
    ],
  });
}
