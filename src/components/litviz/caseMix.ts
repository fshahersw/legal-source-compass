/**
 * Federal civil filings by case type over time, for a stacked bar chart: the largest groups in the latest complete
 * fiscal year, plus "All other case types" computed as the national total minus those groups (exact, no inference
 * about groups that have no row for a year). A year a shown group or the national total does not record is a gap,
 * never a zero; an unfinished fiscal year is kept and marked partial.
 */
import type { StackRow } from "@/components/charts/d3/maths";

export type GroupSeries = {
  id: string;
  label: string;
  years: readonly { fy: number; partial: boolean; filings: number | null }[];
};
export type NationalYear = { fy: number; partial: boolean; filings: number | null };

export const OTHER_KEY = "other";

export type CaseMix = {
  rows: StackRow[];
  keys: string[];
  labels: Record<string, string>;
  /** Latest complete fiscal year the groups are ranked on. */
  latestFy: number;
  /** Share of that year's national filings the shown groups hold (0-1), when computable. */
  shownShare: number | null;
};

export function caseMixRows(
  groups: readonly GroupSeries[],
  national: readonly NationalYear[],
  { top = 5, span = 20 }: { top?: number; span?: number } = {},
): CaseMix | null {
  const complete = national.filter((y) => !y.partial && y.filings != null);
  const latest = complete.at(-1);
  if (!latest || !groups.length) return null;
  const at = (g: GroupSeries, fy: number) => g.years.find((y) => y.fy === fy)?.filings ?? null;
  const ranked = groups
    .map((g) => ({ g, v: at(g, latest.fy) }))
    .filter((x): x is { g: GroupSeries; v: number } => x.v != null && x.v > 0)
    .sort((a, b) => b.v - a.v || a.g.label.localeCompare(b.g.label))
    .slice(0, top)
    .map((x) => x.g);
  if (!ranked.length) return null;
  const lastFy = Math.max(...national.map((y) => y.fy));
  const years = national
    .filter((y) => y.fy > lastFy - span)
    .slice()
    .sort((a, b) => a.fy - b.fy);
  const rows: StackRow[] = years.map((y) => {
    const values: Record<string, number | null> = {};
    let sum = 0;
    let known = y.filings != null;
    for (const g of ranked) {
      const v = at(g, y.fy);
      values[g.id] = v;
      if (v == null) known = false;
      else sum += v;
    }
    const other = known ? (y.filings as number) - sum : null;
    values[OTHER_KEY] = other != null && other >= 0 ? other : null;
    return { period: `FY${y.fy}`, values, ...(y.partial ? { partial: true } : {}) };
  });
  const shownLatest = ranked.reduce((s, g) => s + (at(g, latest.fy) ?? 0), 0);
  return {
    rows,
    keys: [...ranked.map((g) => g.id), OTHER_KEY],
    labels: {
      ...Object.fromEntries(ranked.map((g) => [g.id, g.label])),
      [OTHER_KEY]: "All other case types",
    },
    latestFy: latest.fy,
    shownShare: latest.filings ? shownLatest / latest.filings : null,
  };
}
