/**
 * Pure builder for the company page's enforcement trend: DOJ press releases, SEC actions and FTC enforcement actions that
 * name the company (matched only when a named party equals the SEC registrant name after exact normalisation), counted by
 * the year of the agency's own date. A count of items the agencies published, never of money or of guilt. A source whose
 * rows may have been cut off by the page's read limit is left out rather than charted short.
 */
import { emptyPeriods, totalSeries } from "./summary";
import {
  assembleBlock,
  formatCount,
  yearPoints,
  type TrendBlockData,
  type TrendSeries,
} from "@/lib/analytics/trend";

export type DatedSource = {
  /** ISO date of each item the page loaded (null when the agency lists none). */
  dates: readonly (string | null)[];
  /** Rows the page asked for at most; a source that returned this many may have more. */
  limit: number;
  /** The total the corpus reports for the source, when it reports one. */
  total: number | null;
};

/** The reads behind the company enforcement panel stop at these row counts. */
export const COMPANY_READ_LIMITS = { doj: 200, sec: 100, ftc: 100 } as const;

const yearOf = (d: string | null): number | null => {
  const m = d && /^(\d{4})-\d{2}-\d{2}$/.exec(d);
  return m ? Number(m[1]) : null;
};

/** True when the source returned fewer rows than exist, or as many as the read allows. */
export function mayBeTruncated(s: DatedSource): boolean {
  if (s.total !== null) return s.dates.length < s.total;
  return s.dates.length >= s.limit;
}

export function buildCompanyEnforcementYears(input: {
  cik: string;
  doj: DatedSource;
  sec: DatedSource;
  ftc: DatedSource;
  /** ISO date "today"; the year it falls in is partial. */
  today: string;
  /** Minimum dated items before a trend is worth drawing. */
  minItems?: number;
}): TrendBlockData | null {
  const parts: { id: string; label: string; source: DatedSource }[] = [
    { id: "doj", label: "DOJ press releases", source: input.doj },
    { id: "sec", label: "SEC actions", source: input.sec },
    { id: "ftc", label: "FTC actions", source: input.ftc },
  ];
  const usable = parts.filter((p) => !mayBeTruncated(p.source));
  const dropped = parts.filter((p) => mayBeTruncated(p.source) && p.source.dates.length > 0);
  const counts = usable.map((p) => {
    const by = new Map<number, number>();
    let undated = 0;
    for (const d of p.source.dates) {
      const y = yearOf(d);
      if (y === null) undated += 1;
      else by.set(y, (by.get(y) ?? 0) + 1);
    }
    return { ...p, by, undated };
  });
  const years = [...new Set(counts.flatMap((c) => [...c.by.keys()]))].sort((a, b) => a - b);
  const items = counts.reduce((n, c) => n + [...c.by.values()].reduce((a, b) => a + b, 0), 0);
  if (years.length < 2 || items < (input.minItems ?? 5)) return null;
  const thisYear = Number(input.today.slice(0, 4));
  // The span runs to the current year, so the years since the newest item show as blank rather than being cut off.
  const first = years[0]!;
  const last = Math.max(years[years.length - 1]!, thisYear);
  // The sources do not cover the same years, so a year with no matched item is left blank, not drawn as zero.
  const series: TrendSeries[] = counts.map((c) => ({
    id: c.id,
    label: c.label,
    points: yearPoints(
      Array.from({ length: last - first + 1 }, (_, i) => {
        const year = first + i;
        return {
          year,
          value: c.by.get(year) ?? null,
          ...(year === thisYear ? { partial: true } : {}),
        };
      }),
    ),
  }));
  const lead = totalSeries({ label: "All sources", from: series });
  const undated = counts.reduce((n, c) => n + c.undated, 0);
  const block = assembleBlock({
    id: `company-enforcement-years-${input.cik}`,
    xKind: "year",
    chart: "bar",
    stacked: true,
    unit: "items",
    series,
    ...(lead ? { latestFrom: lead } : {}),
    source: {
      label: "DOJ, SEC and FTC enforcement data on the Enforcement page",
      url: "/law/enforcement",
    },
    asOf: null,
    notes: [
      "Counts items an agency published that name this company, by the year of the agency's own date: DOJ press releases, SEC litigation releases and administrative proceedings, and FTC enforcement actions. It counts items, not money, and says nothing about the outcome.",
      "An item is matched only when a named party equals the SEC registrant name after exact normalisation, so actions against subsidiaries or differently written names are not counted. The three sources do not cover the same years, so a year with no matched item is left blank rather than drawn as zero.",
      "FTC cases are listed in the table but not charted: the date the FTC lists for a case is when its page was last updated.",
      ...(dropped.length
        ? [
            `${dropped.map((d) => d.label).join(" and ")} ${dropped.length === 1 ? "has" : "have"} more items than the page loads, so ${dropped.length === 1 ? "it is" : "they are"} left out rather than drawn short.`,
          ]
        : []),
      ...(undated
        ? [
            `${formatCount(undated)} ${undated === 1 ? "item has" : "items have"} no date and ${undated === 1 ? "is" : "are"} not plotted.`,
          ]
        : []),
    ],
  });
  return { ...block, gaps: emptyPeriods(series) };
}
