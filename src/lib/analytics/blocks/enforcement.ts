/**
 * Pure builders for the enforcement blocks of the Analytics overview: DOJ, SEC, FTC, EPA and OSHA. Inputs are
 * already-validated rows; the readers in ../overview.server.ts do the I/O. No clock: dates arrive as arguments.
 */
import {
  assembleBlock,
  formatCount,
  longDate,
  yearPoints,
  type TrendBlockData,
  type TrendSeries,
  type YearEntry,
} from "../trend";

/**
 * A calendar year is partial when the data's latest date falls before its last day. With no stated latest date the
 * year is treated as partial only when it is `today`'s year.
 */
export function isPartialYear(year: number, latestDate: string | null, today: string): boolean {
  if (latestDate) return latestDate < `${year}-12-31`;
  return year >= Number(today.slice(0, 4));
}

const partialNote = (years: number[], latestDate: string | null): string[] =>
  years.length
    ? [
        latestDate
          ? `${years.map((y) => `${y}*`).join(", ")} runs through ${longDate(latestDate)}, the latest date held; it is not used for the latest value or its change.`
          : `${years.map((y) => `${y}*`).join(", ")} is still in progress; it is not used for the latest value or its change.`,
      ]
    : [];

export type CountByYear = { year: number; count: number };

/** DOJ news-API press releases per release year (all components). */
export function buildDojPress(input: {
  byYear: readonly CountByYear[];
  latestDate: string | null;
  today: string;
}): TrendBlockData | null {
  if (!input.byYear.length) return null;
  const sorted = [...input.byYear].sort((a, b) => a.year - b.year);
  const entries: YearEntry[] = sorted.map((r) => ({
    year: r.year,
    value: r.count,
    partial: isPartialYear(r.year, input.latestDate, input.today),
  }));
  // The dataset holds roughly a tenth as many releases per year before 2013 as from 2013 on. The break is stated, not smoothed.
  const jump = findCoverageBreak(sorted);
  const partials = entries.filter((e) => e.partial).map((e) => e.year);
  return assembleBlock({
    id: "doj-press",
    xKind: "year",
    chart: "bar",
    unit: "press releases",
    series: [{ id: "releases", label: "Press releases", points: yearPoints(entries) }],
    markers: jump ? [{ x: String(jump.year), label: "Coverage changes" }] : [],
    source: {
      label: "Department of Justice news API (justice.gov)",
      url: "https://www.justice.gov/news",
    },
    asOf: input.latestDate,
    notes: [
      "Counts every press release in the DOJ news API (Office of Public Affairs, U.S. Attorneys' Offices and litigating divisions) by release date. A press release is not a case, charge or settlement, and one matter can have several.",
      ...(jump
        ? [
            `Years before ${jump.year} hold ${formatCount(jump.beforeMin)} to ${formatCount(jump.beforeMax)} releases; from ${jump.year}, ${formatCount(jump.afterMin)} or more. The dataset does not record why, so the jump is a change in what is held, not a trend.`,
          ]
        : []),
      ...partialNote(partials, input.latestDate),
    ],
  });
}

/** The first year whose count is at least five times the year before, when every earlier year is below a fifth of it. */
export function findCoverageBreak(sorted: readonly CountByYear[]): {
  year: number;
  beforeMin: number;
  beforeMax: number;
  afterMin: number;
} | null {
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (prev.count > 0 && cur.count >= prev.count * 5) {
      const before = sorted.slice(0, i).map((r) => r.count);
      const after = sorted.slice(i).map((r) => r.count);
      if (before.every((n) => n * 5 <= cur.count))
        return {
          year: cur.year,
          beforeMin: Math.min(...before),
          beforeMax: Math.max(...before),
          afterMin: Math.min(...after),
        };
    }
  }
  return null;
}

export type SecYear = { year: number; litigation: number; administrative: number };

/** SEC litigation releases and administrative proceedings published per year. */
export function buildSecReleases(input: {
  years: readonly SecYear[];
  latestDate: string | null;
  today: string;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const flags = new Map(
    input.years.map((r) => [r.year, isPartialYear(r.year, input.latestDate, input.today)] as const),
  );
  const entries = (pick: (r: SecYear) => number): YearEntry[] =>
    input.years.map((r) => ({ year: r.year, value: pick(r), partial: flags.get(r.year) === true }));
  const total: TrendSeries = {
    id: "total",
    label: "All releases",
    points: yearPoints(entries((r) => r.litigation + r.administrative)),
  };
  const first = [...input.years].sort((a, b) => a.year - b.year)[0]!;
  const second = [...input.years].sort((a, b) => a.year - b.year)[1];
  const partials = [...flags].filter(([, p]) => p).map(([y]) => y);
  return assembleBlock({
    id: "sec-releases",
    xKind: "year",
    chart: "bar",
    stacked: true,
    unit: "releases",
    series: [
      { id: "lr", label: "Litigation releases", points: yearPoints(entries((r) => r.litigation)) },
      {
        id: "ap",
        label: "Administrative proceedings",
        points: yearPoints(entries((r) => r.administrative)),
      },
    ],
    latestFrom: total,
    source: {
      label: "SEC litigation releases and administrative proceedings lists (sec.gov)",
      url: "https://www.sec.gov/enforcement-litigation/litigation-releases",
    },
    asOf: input.latestDate,
    notes: [
      "Counts releases and proceedings the SEC lists, by the year of the release date. One release can name several respondents, and an administrative proceeding is not a court case, so the counts are not numbers of cases or defendants.",
      ...(second && first.administrative * 5 <= second.administrative
        ? [
            `${first.year} lists ${formatCount(first.administrative)} administrative proceedings against ${formatCount(second.administrative)} in ${second.year}; the dataset does not record why.`,
          ]
        : []),
      ...partialNote(partials, input.latestDate),
    ],
  });
}

export const FTC_KIND_LABELS: Record<string, string> = {
  merger: "Merger enforcement",
  nonmerger: "Nonmerger (conduct)",
  bc_penalty: "Competition civil penalty",
  bcp_penalty: "Consumer protection civil penalty",
};

export type FtcYear = { year: number; counts: Record<string, number> };

/** FTC actions in the four FTC enforcement data files, by the calendar year of the action's date. */
export function buildFtcActions(input: {
  years: readonly FtcYear[];
  undated: number;
  latestDate: string | null;
  today: string;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const kinds = Object.keys(FTC_KIND_LABELS);
  const flag = (y: number) => isPartialYear(y, input.latestDate, input.today);
  const entries = (kind: string): YearEntry[] =>
    input.years.map((r) => ({ year: r.year, value: r.counts[kind] ?? 0, partial: flag(r.year) }));
  const total: TrendSeries = {
    id: "total",
    label: "All listed actions",
    points: yearPoints(
      input.years.map((r) => ({
        year: r.year,
        value: kinds.reduce((s, k) => s + (r.counts[k] ?? 0), 0),
        partial: flag(r.year),
      })),
    ),
  };
  const partials = input.years.filter((r) => flag(r.year)).map((r) => r.year);
  const firstBcp = [...input.years]
    .sort((a, b) => a.year - b.year)
    .find((r) => (r.counts["bcp_penalty"] ?? 0) > 0);
  const firstYear = Math.min(...input.years.map((r) => r.year));
  return assembleBlock({
    id: "ftc-actions",
    xKind: "year",
    chart: "bar",
    stacked: true,
    unit: "actions",
    series: kinds.map((k) => ({
      id: k,
      label: FTC_KIND_LABELS[k]!,
      points: yearPoints(entries(k)),
    })),
    latestFrom: total,
    markers:
      firstBcp && firstBcp.year > firstYear
        ? [{ x: String(firstBcp.year), label: "Consumer penalties begin" }]
        : [],
    source: {
      label: "FTC enforcement data sets (ftc.gov open government)",
      url: "https://www.ftc.gov/policy-notices/open-government/data-sets",
    },
    asOf: input.latestDate,
    notes: [
      "Counts the actions listed in the FTC's published merger, non-merger and civil-penalty data files, by the year of the action's date. These files do not list every FTC enforcement action.",
      ...(firstBcp && firstBcp.year > firstYear
        ? [
            `The consumer protection civil-penalty file starts in ${firstBcp.year}, so earlier years show the other three files only.`,
          ]
        : []),
      ...(input.undated
        ? [
            `${formatCount(input.undated)} listed actions carry no date in the FTC file (merger actions the FTC withheld details of) and are not plotted.`,
          ]
        : []),
      ...partialNote(partials, input.latestDate),
    ],
  });
}

export type EpaYear = { fy: number; opened: number | null; judicial: number | null };

/** EPA ECHO (ICIS-FE&C): civil enforcement cases opened per federal fiscal year, all EPA programs. */
export function buildEpaCases(input: {
  years: readonly EpaYear[];
  latestCompleteFy: number | null;
  fileDate: string | null;
}): TrendBlockData | null {
  const limit = input.latestCompleteFy ?? Math.max(...input.years.map((y) => y.fy));
  const shown = input.years.filter((y) => y.fy <= limit);
  const later = input.years.filter((y) => y.fy > limit && y.opened !== null);
  if (!shown.some((y) => y.opened !== null)) return null;
  const sorted = [...shown].sort((a, b) => a.fy - b.fy);
  const first = sorted.find((y) => y.opened !== null)!;
  const dense = (pick: (y: EpaYear) => number | null): TrendSeries["points"] =>
    yearPoints(shown.map((y) => ({ year: y.fy, value: pick(y) })));
  return assembleBlock({
    id: "epa-cases",
    xKind: "fy",
    chart: "line",
    unit: "cases",
    series: [
      { id: "opened", label: "Cases opened", points: dense((y) => y.opened) },
      { id: "judicial", label: "of which judicial", points: dense((y) => y.judicial) },
    ],
    source: {
      label: "EPA Enforcement and Compliance History Online (ECHO), case downloads",
      url: "https://echo.epa.gov/tools/data-downloads",
    },
    asOf: input.fileDate,
    notes: [
      "Counts civil enforcement cases (judicial and administrative) by the fiscal year ECHO assigns to the case's opening, as recorded in the ICIS-FE&C file. The fiscal year runs October 1 to September 30.",
      `The file records ${formatCount(first.opened)} cases in FY${first.fy} (the first year held); the source does not say whether low early counts reflect fewer cases or less complete recording.`,
      ...later.map(
        (y) =>
          `FY${y.fy} holds ${formatCount(y.opened)} cases opened by the file date and is not plotted as a complete year.`,
      ),
    ],
  });
}

export type OshaYearInput = {
  fy: number;
  inspections: number;
  statePlan: number | null;
  partial: boolean;
};

/** DOL OSHA inspection file: inspections opened per federal fiscal year, Federal OSHA and State Plans together. */
export function buildOshaInspections(input: {
  years: readonly OshaYearInput[];
  snapshot: string | null;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const partials = input.years.filter((y) => y.partial).map((y) => y.fy);
  return assembleBlock({
    id: "osha-inspections",
    xKind: "fy",
    chart: "line",
    unit: "inspections",
    series: [
      {
        id: "all",
        label: "All inspections",
        points: yearPoints(
          input.years.map((y) => ({ year: y.fy, value: y.inspections, partial: y.partial })),
        ),
      },
      {
        id: "state-plan",
        label: "of which State Plan",
        points: yearPoints(
          input.years.map((y) => ({ year: y.fy, value: y.statePlan, partial: y.partial })),
        ),
      },
    ],
    source: {
      label: "U.S. Department of Labor, OSHA inspection data set (open data portal)",
      url: "https://dataportal.dol.gov/datasets/10334",
    },
    asOf: input.snapshot,
    notes: [
      "Counts inspections by the fiscal year of the inspection's open date (October 1 to September 30). The file holds Federal OSHA and State Plan inspections; the State Plan share is classified by a derived rule on the reporting ID, because the file's own flag is blank.",
      ...(partials.length
        ? [
            `${partials.map((y) => `FY${y}*`).join(", ")} is later than the latest complete fiscal year the dataset states; it is drawn dashed and is not used for the latest value or its change.`,
          ]
        : []),
    ],
  });
}
