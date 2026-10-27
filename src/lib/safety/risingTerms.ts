/**
 * Rising-reaction monitor: which MedDRA preferred terms are rising in a product's adverse-event reports. Built from the
 * period × term counts of safety_term_quarters_v1 (each period keeps only its top 25 terms). A term missing from a
 * truncated period is not recorded, never 0, so growth is computed only where the term is recorded in every period of
 * both windows. Pure and tested (risingTerms.test.ts).
 */

export type TermCell = (term: string, period: string) => number | null;

export type RisingTerm = {
  term: string;
  recent: number;
  prior: number;
  change: number | null;
  increase: number;
};

export type RisingResult = {
  /** Periods per window (4 quarters, or 1 year when the product's breakdowns are yearly). */
  k: number;
  grain: "quarter" | "year";
  recentPeriods: string[];
  priorPeriods: string[];
  rising: RisingTerm[];
  /** Terms left out because a period of either window does not record them. */
  notComparable: number;
};

export const isQuarter = (p: string) => /^\d{4}-Q[1-4]$/.test(p);

export function risingTerms(
  terms: readonly string[],
  periods: readonly string[],
  value: TermCell,
  limit = 8,
): RisingResult | null {
  const sorted = [...periods].sort();
  const grain = sorted.length && sorted.every(isQuarter) ? "quarter" : "year";
  const k = grain === "quarter" ? 4 : 1;
  if (sorted.length < 2 * k) return null;
  const recentPeriods = sorted.slice(-k);
  const priorPeriods = sorted.slice(-2 * k, -k);
  const rising: RisingTerm[] = [];
  let notComparable = 0;
  for (const term of terms) {
    const r = recentPeriods.map((p) => value(term, p));
    const q = priorPeriods.map((p) => value(term, p));
    if ([...r, ...q].some((v) => v === null)) {
      notComparable += 1;
      continue;
    }
    const recent = (r as number[]).reduce((a, b) => a + b, 0);
    const prior = (q as number[]).reduce((a, b) => a + b, 0);
    if (recent <= prior) continue;
    rising.push({
      term,
      recent,
      prior,
      increase: recent - prior,
      change: prior > 0 ? Math.round(((recent - prior) / prior) * 1000) / 10 : null,
    });
  }
  rising.sort((a, b) => b.increase - a.increase || a.term.localeCompare(b.term));
  return { k, grain, recentPeriods, priorPeriods, rising: rising.slice(0, limit), notComparable };
}

/** Index-chart series for the given terms over the periods (null where a period does not record the term). */
export function termSeries(
  terms: readonly string[],
  periods: readonly string[],
  value: TermCell,
): { id: string; label: string; points: { date: string; value: number | null }[] }[] {
  const sorted = [...periods].sort();
  return terms.map((t) => ({
    id: t,
    label: t,
    points: sorted.map((p) => ({ date: p, value: value(t, p) })),
  }));
}
