import type { AgencyActivity, DocType, Series } from "@/lib/external/rulemaking.functions";

export const TYPE_LABEL: Record<DocType, string> = {
  RULE: "Final rules",
  PRORULE: "Proposed rules",
  NOTICE: "Notices",
};

/** Registry names for agency marks (src/lib/visuals/registry.json); unknown names fall back to an icon. */
export const AGENCY_MARK_NAME: Record<string, string> = {
  FDA: "Food and Drug Administration",
  CPSC: "Consumer Product Safety Commission",
  NHTSA: "National Highway Traffic Safety Administration",
  EPA: "Environmental Protection Agency",
  FTC: "Federal Trade Commission",
  OSHA: "Occupational Safety and Health Administration",
  CMS: "Centers for Medicare & Medicaid Services",
  FAA: "Federal Aviation Administration",
  CFPB: "Consumer Financial Protection Bureau",
  SEC: "Securities and Exchange Commission",
};

/** Complete calendar years only: the current (partial) year is excluded so trends are not understated. */
export function yearlyRows(a: AgencyActivity, from = 2000) {
  const years = new Set<string>();
  for (const t of ["RULE", "PRORULE", "NOTICE"] as const)
    for (const y of Object.keys(a.yearly[t]))
      if (Number(y) >= from && y < a.partialYear) years.add(y);
  return [...years].sort().map((year) => ({
    year,
    RULE: a.yearly.RULE[year] ?? 0,
    PRORULE: a.yearly.PRORULE[year] ?? 0,
    NOTICE: a.yearly.NOTICE[year] ?? 0,
    significant: a.significantYearly.RULE[year] ?? 0,
  }));
}

/** Last `n` months up to and including the partial current month, marked partial. */
export function monthlyRows(a: AgencyActivity, n = 36) {
  const months = new Set<string>();
  for (const t of ["RULE", "PRORULE", "NOTICE"] as const)
    for (const m of Object.keys(a.monthly[t])) months.add(m);
  return [...months]
    .sort()
    .slice(-n)
    .map((month) => ({
      month,
      RULE: a.monthly.RULE[month] ?? 0,
      PRORULE: a.monthly.PRORULE[month] ?? 0,
      NOTICE: a.monthly.NOTICE[month] ?? 0,
      partial: month === a.partialMonth,
    }));
}

export function mean(values: number[]) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

/** Last complete year's value and its ratio to the average of the five years before it. */
export function lastYearVsAverage(s: Series, partialYear: string) {
  const last = String(Number(partialYear) - 1);
  const prior = Array.from({ length: 5 }, (_, i) => s[String(Number(last) - 1 - i)] ?? 0);
  const avg = mean(prior);
  const value = s[last] ?? 0;
  return { year: last, value, avg5: avg, ratio: avg ? value / avg : null };
}
