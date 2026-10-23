/**
 * Pure builders for the two depth pages of the Analytics section: Enforcement trends (/analytics/enforcement) and
 * Safety trends (/analytics/safety). Same rules as the overview blocks: inputs are already-validated rows, no I/O,
 * no clock (dates arrive as arguments), partial periods never feed the latest value, gaps stay gaps.
 */
import {
  assembleBlock,
  formatCount,
  formatUsd,
  longDate,
  yearPoints,
  type TrendBlockData,
  type TrendSeries,
  type YearEntry,
} from "../trend";
import { findCoverageBreak, isPartialYear } from "./enforcement";

const partialNote = (years: number[], through: string | null): string[] =>
  years.length
    ? [
        through
          ? `${years.map((y) => `${y}*`).join(", ")} runs through ${longDate(through)}, the latest date held; it is not used for the latest value or its change.`
          : `${years.map((y) => `${y}*`).join(", ")} is a partial year; it is not used for the latest value or its change.`,
      ]
    : [];

// ------------------------------------------------------------------------------------------------ enforcement

const AMOUNT_NOTE =
  "A release is counted in the band of the largest figure it states next to a settlement, penalty, fine, restitution, forfeiture, disgorgement or judgment keyword; statutory maximums, alleged losses and stock paragraphs repeated across many releases are not counted. It is a stated figure, not a verified payment, and a release with no such figure is in no band.";

export type DojDivisionYear = { year: number; counts: Record<string, number> };

/** DOJ press releases tagged to each of the largest divisions, per release year. Tags overlap, so lines are not additive. */
export function buildDojDivisions(input: {
  years: readonly DojDivisionYear[];
  names: readonly string[];
  latestDate: string | null;
  today: string;
}): TrendBlockData | null {
  if (!input.years.length || !input.names.length) return null;
  const flag = (y: number) => isPartialYear(y, input.latestDate, input.today);
  const partials = input.years.filter((r) => flag(r.year)).map((r) => r.year);
  const first = Math.min(...input.years.map((r) => r.year));
  return assembleBlock({
    id: "doj-divisions",
    xKind: "year",
    chart: "line",
    unit: "press releases",
    series: input.names.map((name) => ({
      id: name,
      label: name,
      points: yearPoints(
        input.years.map((r) => ({
          year: r.year,
          value: r.counts[name] ?? 0,
          partial: flag(r.year),
        })),
      ),
    })),
    source: {
      label: "Department of Justice news API (justice.gov)",
      url: "https://www.justice.gov/developer/api-documentation/api_v1",
    },
    asOf: input.latestDate,
    notes: [
      "Counts press releases whose component tags include the division, by release year. A release can carry several tags (a division and an investigating agency, for example), so the lines overlap and must not be added together.",
      `The chart starts in ${first}, after the change in what the DOJ news API holds that the overview chart marks. Division names are as the API publishes them, and the four largest by releases are shown.`,
      "The latest value shown is for the first division in the legend.",
      ...partialNote(partials, input.latestDate),
    ],
  });
}

export type AmountBands = { tenM: number; hundredM: number; billion: number };
export type DojAmountYear = { year: number; total: number; bands: AmountBands };

const bandSeries = (
  years: readonly { year: number; bands: AmountBands }[],
  flag: (y: number) => boolean,
): TrendSeries[] => {
  const entries = (pick: (b: AmountBands) => number): YearEntry[] =>
    years.map((r) => ({ year: r.year, value: pick(r.bands), partial: flag(r.year) }));
  return [
    {
      id: "10m",
      label: "$10 million to under $100 million",
      points: yearPoints(entries((b) => b.tenM)),
    },
    {
      id: "100m",
      label: "$100 million to under $1 billion",
      points: yearPoints(entries((b) => b.hundredM)),
    },
    { id: "1b", label: "$1 billion or more", points: yearPoints(entries((b) => b.billion)) },
  ];
};

const bandTotal = (
  years: readonly { year: number; bands: AmountBands }[],
  flag: (y: number) => boolean,
): TrendSeries => ({
  id: "total",
  label: "Releases stating $10 million or more",
  points: yearPoints(
    years.map((r) => ({
      year: r.year,
      value: r.bands.tenM + r.bands.hundredM + r.bands.billion,
      partial: flag(r.year),
    })),
  ),
});

/** DOJ press releases by the size band of the largest resolution figure they state. */
export function buildDojAmounts(input: {
  years: readonly DojAmountYear[];
  latestDate: string | null;
  today: string;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const flag = (y: number) => isPartialYear(y, input.latestDate, input.today);
  const sorted = [...input.years].sort((a, b) => a.year - b.year);
  const jump = findCoverageBreak(sorted.map((r) => ({ year: r.year, count: r.total })));
  const partials = sorted.filter((r) => flag(r.year)).map((r) => r.year);
  return assembleBlock({
    id: "doj-amounts",
    xKind: "year",
    chart: "bar",
    stacked: true,
    unit: "press releases",
    series: bandSeries(sorted, flag),
    latestFrom: bandTotal(sorted, flag),
    markers: jump ? [{ x: String(jump.year), label: "Coverage changes" }] : [],
    source: {
      label: "Department of Justice news API (justice.gov)",
      url: "https://www.justice.gov/developer/api-documentation/api_v1",
    },
    asOf: input.latestDate,
    notes: [
      AMOUNT_NOTE,
      ...(jump
        ? [
            `Before ${jump.year} the dataset holds far fewer releases a year (${formatCount(jump.beforeMin)} to ${formatCount(jump.beforeMax)}, against ${formatCount(jump.afterMin)} or more later), so earlier bars count a smaller set of releases.`,
          ]
        : []),
      ...partialNote(partials, input.latestDate),
    ],
  });
}

export type SecAmountYear = { year: number; bands: AmountBands };

/** SEC litigation releases by the size band of the largest resolution figure they state. */
export function buildSecAmounts(input: {
  years: readonly SecAmountYear[];
  latestDate: string | null;
  today: string;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const flag = (y: number) => isPartialYear(y, input.latestDate, input.today);
  const sorted = [...input.years].sort((a, b) => a.year - b.year);
  const partials = sorted.filter((r) => flag(r.year)).map((r) => r.year);
  return assembleBlock({
    id: "sec-amounts",
    xKind: "year",
    chart: "bar",
    stacked: true,
    unit: "litigation releases",
    series: bandSeries(sorted, flag),
    latestFrom: bandTotal(sorted, flag),
    source: {
      label: "SEC litigation releases (sec.gov)",
      url: "https://www.sec.gov/enforcement-litigation/litigation-releases",
    },
    asOf: input.latestDate,
    notes: [
      AMOUNT_NOTE,
      "Only litigation releases are counted here: the figure is read from each release's own text, and administrative proceedings are not read for figures.",
      ...partialNote(partials, input.latestDate),
    ],
  });
}

export type PenaltyYear = { fy: number; penalty: number | null; partial?: boolean };

const peakNote = (years: readonly PenaltyYear[]): string[] => {
  const recorded = years.filter((y) => y.penalty !== null && !y.partial);
  if (recorded.length < 3) return [];
  const peak = recorded.reduce((a, b) => (b.penalty! > a.penalty! ? b : a));
  return [
    `The largest year is FY${peak.fy}, at ${formatUsd(peak.penalty)}; a single large case can dominate a year, so read the totals beside the case counts.`,
  ];
};

/** EPA ECHO: federal penalties on settlements entered in each federal fiscal year, summed from the amounts recorded. */
export function buildEpaPenalties(input: {
  years: readonly { fy: number; penalty: number | null }[];
  latestCompleteFy: number | null;
  fileDate: string | null;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const limit = input.latestCompleteFy ?? Math.max(...input.years.map((y) => y.fy));
  const shown = input.years.filter((y) => y.fy <= limit);
  if (!shown.some((y) => y.penalty !== null)) return null;
  return assembleBlock({
    id: "epa-penalties",
    xKind: "fy",
    chart: "bar",
    format: "usd",
    unit: "dollars",
    series: [
      {
        id: "penalty",
        label: "Federal penalties",
        points: yearPoints(shown.map((y) => ({ year: y.fy, value: y.penalty }))),
      },
    ],
    source: {
      label: "EPA Enforcement and Compliance History Online (ECHO), case downloads",
      url: "https://echo.epa.gov/tools/data-downloads",
    },
    asOf: input.fileDate,
    notes: [
      "Each bar is the computed sum of the federal penalty amounts (ECHO's FED_PENALTY_ASSESSED_AMT) recorded on the settlements entered in that federal fiscal year, in dollars as recorded and not adjusted for inflation. It counts when a settlement was entered, not when the case opened, so it does not follow the case counts of the overview. A settlement the file does not date to a fiscal year is in no bar, and one entered after the file date is not counted yet.",
      ...peakNote(shown),
    ],
  });
}

/** DOL OSHA inspection file: current penalties on inspections opened in each fiscal year, summed from recorded amounts. */
export function buildOshaPenalties(input: {
  years: readonly PenaltyYear[];
  snapshot: string | null;
}): TrendBlockData | null {
  if (!input.years.some((y) => y.penalty !== null)) return null;
  const partials = input.years.filter((y) => y.partial).map((y) => y.fy);
  return assembleBlock({
    id: "osha-penalties",
    xKind: "fy",
    chart: "bar",
    format: "usd",
    unit: "dollars",
    series: [
      {
        id: "penalty",
        label: "Current penalties",
        points: yearPoints(
          input.years.map((y) => ({ year: y.fy, value: y.penalty, partial: y.partial === true })),
        ),
      },
    ],
    source: {
      label: "U.S. Department of Labor, OSHA inspection data set (open data portal)",
      url: "https://dataportal.dol.gov/datasets/10334",
    },
    asOf: input.snapshot,
    notes: [
      "Each bar is the computed sum of the current-penalty amounts recorded on the citation items of inspections opened in that federal fiscal year, excluding failure-to-abate amounts. These are sums of recorded amounts, not OSHA's official totals, and are not adjusted for inflation.",
      "A blank amount adds nothing and is never filled in. Many items issued in FY1991 to FY2010 have a blank current penalty (the dataset counts about 31% of serious and 79% to 87% of other-than-serious items), and from FY2017 blanks are absent and zero amounts appear instead, so the earlier bars read lower than the later ones for that reason as well as any change in penalties.",
      ...peakNote(input.years),
      ...(partials.length
        ? [
            `${partials.map((y) => `FY${y}*`).join(", ")} is later than the latest complete fiscal year the dataset states; it is drawn faded and is not used for the latest value or its change.`,
          ]
        : []),
    ],
  });
}

// ------------------------------------------------------------------------------------------------ safety

export type FaersOutcomeYear = {
  year: number;
  partial: boolean;
  serious: number | null;
  deaths: number | null;
  lawyer: number | null;
};

/** FAERS (openFDA): reports with a serious outcome, a death outcome and a lawyer as primary reporter, per year received. */
export function buildFaersOutcomes(input: {
  years: readonly FaersOutcomeYear[];
  dataThrough: string | null;
}): TrendBlockData | null {
  if (!input.years.some((y) => y.serious !== null || y.deaths !== null || y.lawyer !== null))
    return null;
  const line = (pick: (y: FaersOutcomeYear) => number | null): YearEntry[] =>
    input.years.map((y) => ({ year: y.year, value: pick(y), partial: y.partial }));
  const partials = input.years.filter((y) => y.partial).map((y) => y.year);
  return assembleBlock({
    id: "faers-outcomes",
    xKind: "year",
    chart: "line",
    unit: "reports",
    series: [
      { id: "serious", label: "Serious outcome", points: yearPoints(line((y) => y.serious)) },
      { id: "deaths", label: "Death outcome", points: yearPoints(line((y) => y.deaths)) },
      {
        id: "lawyer",
        label: "Lawyer as primary reporter",
        points: yearPoints(line((y) => y.lawyer)),
      },
    ],
    source: {
      label: "FDA Adverse Event Reporting System via openFDA",
      url: "https://open.fda.gov/apis/drug/event/",
    },
    asOf: input.dataThrough,
    notes: [
      "Counts reports by the year FDA first received them. The three lines overlap: a report can have a serious outcome, a death outcome and a lawyer as reporter at once.",
      "Counts are reports, not incidence: a report says a product was mentioned with an adverse event, not that it caused it. Reporting rises with publicity and litigation (claimants' lawyers file reports, and manufacturers forward reports they learn of through lawsuits), so the lawyer line in particular reflects litigation activity.",
      "The latest value shown is for the first line in the legend.",
      ...partialNote(partials, input.dataThrough),
    ],
  });
}

export type SaferProductsYear = { year: number; reports: number; partial: boolean };

/** SaferProducts.gov: consumer product reports CPSC published, by publication year. */
export function buildSaferProducts(input: {
  years: readonly SaferProductsYear[];
  /** First and last publication date in the export. */
  window: { first: string | null; last: string | null };
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const partials = input.years.filter((y) => y.partial).map((y) => y.year);
  const first = [...input.years].sort((a, b) => a.year - b.year)[0]!;
  return assembleBlock({
    id: "saferproducts-reports",
    xKind: "year",
    chart: "bar",
    unit: "reports",
    series: [
      {
        id: "reports",
        label: "Reports published",
        points: yearPoints(
          input.years.map((y) => ({ year: y.year, value: y.reports, partial: y.partial })),
        ),
      },
    ],
    source: {
      label: "U.S. Consumer Product Safety Commission, SaferProducts.gov",
      url: "https://www.saferproducts.gov/",
    },
    asOf: input.window.last,
    notes: [
      "Counts the reports CPSC published on SaferProducts.gov, by the year of publication. They are unverified consumer submissions, not findings of defect or cause, and counts are affected by publicity, litigation and recalls.",
      ...(first.partial && input.window.first
        ? [
            `${first.year}* starts on ${longDate(input.window.first)}, the first publication in the export, so it covers part of the year.`,
          ]
        : []),
      ...partialNote(
        partials.filter((y) => y !== first.year),
        input.window.last,
      ),
    ],
  });
}

export type CpscHazardYear = {
  year: number;
  partial: boolean;
  hazards: Readonly<Record<string, number>>;
  deathMentions: number;
};

/** CPSC recalls by the hazard named in the title or hazard statement: the four most common hazards, one line each. */
export function buildCpscHazards(input: {
  years: readonly CpscHazardYear[];
  labels: Readonly<Record<string, string>>;
  asOf: string | null;
  top?: number;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const totals = new Map<string, number>();
  for (const y of input.years)
    for (const [id, n] of Object.entries(y.hazards)) totals.set(id, (totals.get(id) ?? 0) + n);
  const ids = [...totals.entries()]
    .filter(([id]) => id !== "other")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, input.top ?? 4)
    .map(([id]) => id);
  if (!ids.length) return null;
  const partials = input.years.filter((y) => y.partial).map((y) => y.year);
  return assembleBlock({
    id: "cpsc-hazards",
    xKind: "year",
    chart: "line",
    unit: "recalls",
    series: ids.map((id) => ({
      id,
      label: input.labels[id] ?? id,
      points: yearPoints(
        input.years.map((y) => ({ year: y.year, value: y.hazards[id] ?? 0, partial: y.partial })),
      ),
    })),
    source: {
      label: "U.S. Consumer Product Safety Commission, Recall API",
      url: "https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information",
    },
    asOf: input.asOf,
    notes: [
      "Counts recalls by the year of the recall date whose title or hazard statement matches the hazard's documented patterns. A recall can match several hazards, so the lines overlap and must not be added. Recalls matching none are in the dataset's other or unclassified group, which is not drawn.",
      `The four hazards with the most recalls over the whole series are drawn, most common first; the latest value shown is for the first.`,
      ...partialNote(partials, input.asOf),
    ],
  });
}

/**
 * First year in which the CPSC recall record carries an injury statement for nearly every recall (190 of 191 in 2000,
 * against 39 of 156 in 1999, 9 of 133 in 1998 and none before, counted from the recall files). The death count reads
 * that statement, so earlier years would show zero because the text is missing, not because no death occurred.
 */
export const CPSC_INJURY_STATEMENT_FROM = 2000;

/** CPSC recalls whose injury statement mentions a product-related death, from the first year that statement is recorded. */
export function buildCpscDeaths(input: {
  years: readonly CpscHazardYear[];
  asOf: string | null;
  from?: number;
}): TrendBlockData | null {
  const from = input.from ?? CPSC_INJURY_STATEMENT_FROM;
  const years = input.years.filter((y) => y.year >= from);
  if (!years.length) return null;
  const partials = years.filter((y) => y.partial).map((y) => y.year);
  return assembleBlock({
    id: "cpsc-deaths",
    xKind: "year",
    chart: "bar",
    unit: "recalls",
    series: [
      {
        id: "deaths",
        label: "Recalls mentioning a death",
        points: yearPoints(
          years.map((y) => ({ year: y.year, value: y.deathMentions, partial: y.partial })),
        ),
      },
    ],
    source: {
      label: "U.S. Consumer Product Safety Commission, Recall API",
      url: "https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information",
    },
    asOf: input.asOf,
    notes: [
      "Counts recalls whose injury statement mentions a death after negated phrases are removed, unless every death sentence carries a background marker (for example CPSC estimates, an earlier year, or another firm's product). It is a text mention, not a verified count of deaths, and one recall can mention several.",
      `The chart starts in ${from}. CPSC records an injury statement for 190 of 191 recalls in 2000, against 39 of 156 in 1999, 9 of 133 in 1998 and none before, so earlier years would read as zero because the text is missing, not because no death occurred.`,
      ...partialNote(partials, input.asOf),
    ],
  });
}

export type FdaClassIYear = { year: number; drug: number; device: number; food: number };

/** openFDA enforcement reports: Class I (most serious) recalled-product entries per report year, by product type. */
export function buildFdaClassI(input: {
  years: readonly FdaClassIYear[];
  latestDate: string | null;
  today: string;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const flag = (y: number) => isPartialYear(y, input.latestDate, input.today);
  const entries = (pick: (y: FdaClassIYear) => number): YearEntry[] =>
    input.years.map((y) => ({ year: y.year, value: pick(y), partial: flag(y.year) }));
  const total: TrendSeries = {
    id: "total",
    label: "All Class I entries",
    points: yearPoints(entries((y) => y.drug + y.device + y.food)),
  };
  const partials = input.years.filter((y) => flag(y.year)).map((y) => y.year);
  return assembleBlock({
    id: "fda-class-i",
    xKind: "year",
    chart: "bar",
    stacked: true,
    unit: "entries",
    series: [
      { id: "drug", label: "Drug", points: yearPoints(entries((y) => y.drug)) },
      { id: "device", label: "Device", points: yearPoints(entries((y) => y.device)) },
      { id: "food", label: "Food", points: yearPoints(entries((y) => y.food)) },
    ],
    latestFrom: total,
    source: {
      label: "FDA enforcement reports via openFDA (drug, device and food endpoints)",
      url: "https://open.fda.gov/apis/drug/enforcement/",
    },
    asOf: input.latestDate,
    notes: [
      "Class I is FDA's classification for a recall where there is a reasonable probability that the product will cause serious adverse health consequences or death. Each entry is one recalled product in an enforcement report, counted by report date, so one recall event can contribute several entries.",
      "Entries FDA has not yet classified are not in any class and are not counted here.",
      ...partialNote(partials, input.latestDate),
    ],
  });
}
