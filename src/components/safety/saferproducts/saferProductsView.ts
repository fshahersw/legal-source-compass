/**
 * Pure display helpers for the SaferProducts.gov consumer-report views. Every figure counts UNVERIFIED consumer
 * reports; the label travels with the numbers (see UNVERIFIED). Unknown values read "Not recorded", never a guess.
 */
import {
  int,
  NOT_RECORDED,
  pct,
  shareOf,
  signedPct,
  usableTakeaways,
  type Takeaway,
} from "@/components/analysis/analysisFormat";
import type {
  SaferProductsReports,
  SaferProductsSignals,
  SpCompany,
  SpGrowth,
  SpGrowthRow,
  SpPrecision,
  SpSeverity,
  SpTheme,
  SpYear,
  SpYearPoint,
} from "@/lib/external/saferProducts.functions";

export const UNVERIFIED = "Unverified consumer reports";
export const UNVERIFIED_SENTENCE =
  "CPSC publishes each report after minimum-information checks and does not verify every report. A report is not a finding of defect, causation or incidence, and counts are reports, not incidents.";

export const SEVERITY_ROWS: { key: keyof SpSeverity; label: string }[] = [
  { key: "death", label: "Death" },
  { key: "injury", label: "Injury (any level of care)" },
  { key: "incidentNoInjury", label: "Incident, no injury" },
  { key: "noIncident", label: "No incident" },
  { key: "unspecified", label: "Unspecified" },
];

/** A year label that marks a partial year, e.g. "2026*". */
export const yearLabel = (y: { year: number; partial: boolean }) =>
  y.partial ? `${y.year}*` : String(y.year);

export type YearBar = {
  year: number;
  label: string;
  reports: number;
  partial: boolean;
  /** Year-over-year note for the tooltip; says why a comparison is withheld instead of leaving it blank. */
  yoy: string;
};

/** Bars for the yearly chart. Published years carry the YoY text; submitted years carry none. */
export function yearBars(
  published: readonly SpYear[],
  submitted: readonly SpYearPoint[],
  basis: "published" | "submitted",
): YearBar[] {
  if (basis === "submitted") {
    return submitted.map((y) => ({
      year: y.year,
      label: yearLabel(y),
      reports: y.reports,
      partial: y.partial,
      yoy: "Year-over-year change is shown for the publication year only",
    }));
  }
  return published.map((y) => ({
    year: y.year,
    label: yearLabel(y),
    reports: y.reports,
    partial: y.partial,
    yoy: yoyNote(y),
  }));
}

export function yoyNote(y: SpYear): string {
  if (y.partial) return "Not compared: partial year";
  if (!y.yoyComparable) return "Not compared: the year before is partial";
  return y.yoyPct == null ? NOT_RECORDED : `${signedPct(y.yoyPct)} on the year before`;
}

/** Human line for a partial year: what it covers. */
export function partialYearNote(
  published: readonly SpYear[],
  window: { first: string; last: string } | null,
): string | null {
  const partial = published.filter((y) => y.partial).map((y) => y.year);
  if (!partial.length) return null;
  const years = partial.join(" and ");
  if (!window) return `${years} ${partial.length === 1 ? "is" : "are"} partial.`;
  return `${years} ${partial.length === 1 ? "is" : "are"} partial: the first report was published ${window.first} and the latest ${window.last}.`;
}

export function severitySegments(s: SpSeverity) {
  return SEVERITY_ROWS.map(({ key, label }) => ({ key, label, value: s[key] }));
}

/** Percentage points of the year-to-date change that come from the single largest manufacturer string. */
export function pointsFromLargest(
  ytd: NonNullable<SaferProductsReports["latestPartial"]>["ytd"],
): number | null {
  if (
    !ytd ||
    ytd.changePct == null ||
    !ytd.excludingLargest ||
    ytd.excludingLargest.changePct == null
  )
    return null;
  return ytd.changePct - ytd.excludingLargest.changePct;
}

/** "19 percentage points", rounded to whole points; the unit is part of the text so it is never read as a percent. */
export function pointsText(points: number): string {
  const n = Math.round(points);
  return `${n} percentage ${Math.abs(n) === 1 ? "point" : "points"}`;
}

export function spTakeaways(d: SaferProductsReports): Takeaway[] {
  const lc = d.latestComplete;
  const lp = d.latestPartial;
  const ytd = lp?.ytd ?? null;
  const ex = ytd?.excludingLargest ?? null;
  const points = pointsFromLargest(ytd);
  const top = d.categories[0];
  const injuryShare = d.severity ? shareOf(d.severity.injury, d.total) : null;
  return usableTakeaways([
    {
      id: "scale",
      figure: int(d.total),
      text: `${UNVERIFIED.toLowerCase()} published on SaferProducts.gov${d.publicationWindow ? `, ${d.publicationWindow.first} to ${d.publicationWindow.last}` : ""}. A report is not a finding of defect, causation or incidence.`,
      anchor: "sp-yearly",
      anchorLabel: "See the years",
    },
    lc && lc.yoyPct != null
      ? {
          id: "latest-year",
          figure: signedPct(lc.yoyPct),
          text: `unverified reports published in ${lc.year} (${int(lc.reports)}) against ${lc.year - 1}${lc.changeVs2019Pct != null ? `; ${signedPct(lc.changeVs2019Pct)} against 2019` : ""}. Both are complete years.`,
          anchor: "sp-yearly",
        }
      : null,
    lp && ytd && ytd.changePct != null
      ? {
          id: "ytd",
          figure: signedPct(ytd.changePct),
          text: `unverified reports published in ${lp.year} through ${ytd.through} (${int(ytd.reports)}) against ${int(ytd.priorYearSameWindow)} in the same window of ${lp.year - 1}${
            ex && ex.changePct != null
              ? `; ${signedPct(ex.changePct)} without ${ex.company}, the largest manufacturer string (${int(ex.removedReports)} reports)${points != null ? `, which explains about ${pointsText(points)} of the change` : ""}`
              : ""
          }.`,
        }
      : null,
    top && d.total > 0
      ? {
          id: "top-category",
          figure: pct(shareOf(top.reports, d.total), 1),
          text: `of all unverified reports sit in the ${top.name} category (${int(top.reports)}), the largest of ${int(d.categories.length)} product categories.`,
          anchor: "sp-categories",
        }
      : null,
    d.severity && injuryShare != null
      ? {
          id: "severity",
          figure: pct(injuryShare, 1),
          text: `of unverified reports name a primary victim with an injury (${int(d.severity.injury)}); ${int(d.severity.death)} name a death. These count reports, not persons.`,
          anchor: "sp-severity",
        }
      : null,
  ]);
}

// ----------------------------------------------------------------------------------------- growth

export type GrowthSort = "change" | "recent" | "prior" | "reports" | "name";

/** "2.18× (1.96 to 2.43)" — a rate ratio of recent over prior reports with its 95% interval. */
export function ratioLabel(g: SpGrowth): string {
  if (g.ratio == null) return NOT_RECORDED;
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return g.ci95 ? `${fmt(g.ratio)}× (${fmt(g.ci95[0])} to ${fmt(g.ci95[1])})` : `${fmt(g.ratio)}×`;
}

/** The rank among rows the dataset ranked, e.g. "4 of 68". */
export function rankLabel(g: SpGrowth): string {
  return g.rank != null && g.rankOf != null ? `${int(g.rank)} of ${int(g.rankOf)}` : "Not ranked";
}

export function sortGrowth(
  rows: readonly SpGrowthRow[],
  sort: GrowthSort,
  desc: boolean,
): SpGrowthRow[] {
  const key = (r: SpGrowthRow): number | string =>
    sort === "change"
      ? r.growth.changePct
      : sort === "recent"
        ? r.growth.recent
        : sort === "prior"
          ? r.growth.prior
          : sort === "reports"
            ? r.reports
            : r.name.toLowerCase();
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return a.name.localeCompare(b.name);
    return (ka < kb ? -1 : 1) * dir;
  });
}

/** Rows whose name, category or code contains every word of the query (case-insensitive). */
export function filterByText<T>(rows: readonly T[], query: string, text: (row: T) => string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...rows];
  return rows.filter((r) => {
    const hay = text(r).toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Negative-change rows only: the dataset's own "declining" list also holds positive changes. */
export function decliningRows(rows: readonly SpGrowthRow[]): SpGrowthRow[] {
  return rows
    .filter((r) => r.growth.changePct < 0)
    .sort((a, b) => a.growth.changePct - b.growth.changePct);
}

export function spSignalTakeaways(s: SaferProductsSignals): Takeaway[] {
  const type = s.levels.type;
  const w = s.windows;
  const fastest = sortGrowth(type.rows, "change", true)[0];
  const falling = decliningRows(type.rows)[0];
  const withPrecision = [...s.themes].sort((a, b) => b.reports - a.reports)[0];
  const min = w?.minReportsPerWindow;
  return usableTakeaways([
    fastest && w
      ? {
          id: "fastest",
          figure: signedPct(fastest.growth.changePct),
          text: `${fastest.name}: ${int(fastest.growth.recent)} unverified reports in ${w.recent} against ${int(fastest.growth.prior)} in ${w.prior} (rank ${rankLabel(fastest.growth)} among product types).`,
          anchor: "sp-growth",
          anchorLabel: "See the table",
        }
      : null,
    falling && w
      ? {
          id: "falling",
          figure: signedPct(falling.growth.changePct),
          text: `${falling.name}: ${int(falling.growth.recent)} unverified reports in ${w.recent} against ${int(falling.growth.prior)} in ${w.prior}, the largest fall among ranked product types.`,
          anchor: "sp-growth",
        }
      : null,
    type.eligible != null && type.total != null && min != null
      ? {
          id: "eligible",
          figure: `${int(type.eligible)} of ${int(type.total)}`,
          text: `product types have at least ${int(min)} unverified reports in both windows and are ranked; the rest are not ranked because their counts are too small to compare.`,
          anchor: "sp-growth",
        }
      : null,
    withPrecision
      ? {
          id: "hazard",
          figure: int(withPrecision.reports),
          text: `reports mention ${withPrecision.label.toLowerCase()} wording (${pct(withPrecision.sharePct, 1)} of all); ${precisionSentence(withPrecision.precision)}`,
          anchor: "sp-hazards",
        }
      : null,
  ]);
}

// -------------------------------------------------------------------------------------- hazard terms

/** "85% precision (95% interval 64% to 95%; 17 of 20 sampled matches)" or Not recorded. */
export function precisionLabel(p: SpPrecision | null): string {
  if (!p) return `Precision ${NOT_RECORDED}`;
  return `${pct(p.precisionPct, 0)} precision (95% interval ${pct(p.wilson95[0], 0)} to ${pct(p.wilson95[1], 0)}; ${int(p.correct)} of ${int(p.sampleSize)} sampled matches)`;
}

function precisionSentence(p: SpPrecision | null): string {
  return p
    ? `measured precision ${pct(p.precisionPct, 0)} (95% interval ${pct(p.wilson95[0], 0)} to ${pct(p.wilson95[1], 0)}, ${int(p.correct)} of ${int(p.sampleSize)} sampled matches).`
    : `precision ${NOT_RECORDED}.`;
}

/** Themes ordered by report count, the largest first. */
export function themesByReports(themes: readonly SpTheme[]): SpTheme[] {
  return [...themes].sort((a, b) => b.reports - a.reports);
}

// --------------------------------------------------------------------------------------- companies

export type CompanyRole = "manufacturer" | "retailer";
export type CompanySort = "reports" | "deaths" | "comment" | "name";

export function filterCompanies(
  companies: readonly SpCompany[],
  role: CompanyRole,
  query: string,
): SpCompany[] {
  return filterByText(
    companies.filter((c) => c.role === role),
    query,
    (c) => c.name,
  );
}

export function sortCompanies(
  rows: readonly SpCompany[],
  sort: CompanySort,
  desc: boolean,
): SpCompany[] {
  const dir = desc ? -1 : 1;
  const key = (c: SpCompany): number | string | null =>
    sort === "reports"
      ? c.reports
      : sort === "deaths"
        ? c.deaths
        : sort === "comment"
          ? c.commentRatePct
          : c.name.toLowerCase();
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    // Unknown values sort last in either direction.
    if (ka == null && kb == null) return a.name.localeCompare(b.name);
    if (ka == null) return 1;
    if (kb == null) return -1;
    if (ka === kb) return b.reports - a.reports || a.name.localeCompare(b.name);
    return (ka < kb ? -1 : 1) * dir;
  });
}

const MATCH_LEVEL: Record<string, string> = {
  exact_string: "exact name",
  normalised: "normalised name",
  normalised_after_location_strip: "name after dropping the recall firm's location",
};
const MATCH_LEVEL_SHORT: Record<string, string> = {
  exact_string: "exact name",
  normalised: "normalised name",
  normalised_after_location_strip: "location dropped",
};

/** A short form for a table sub-line; the long form stays in the cell's title. */
export function matchLevelShort(level: string): string {
  return MATCH_LEVEL_SHORT[level] ?? level.replace(/_/g, " ");
}

export function matchLevelLabel(level: string): string {
  return MATCH_LEVEL[level] ?? level.replace(/_/g, " ");
}

/**
 * The recall column text. Manufacturers either have a company-name match to a recall firm or none; retailer strings
 * were not matched at all. A name match is name equality, never "the recalled product".
 */
export function recallMatchText(c: SpCompany): { text: string; detail: string | null } {
  if (c.role === "retailer")
    return { text: "Not checked", detail: "Recall matching covers manufacturer strings only" };
  const m = c.recallMatch;
  if (!m)
    return { text: "No name match", detail: "No recall firm has this exact or normalised name" };
  const recalls =
    m.recalls == null
      ? NOT_RECORDED
      : `${int(m.recalls)} ${m.recalls === 1 ? "recall" : "recalls"}`;
  const bits = [
    `Company-name match (${matchLevelLabel(m.level)})`,
    m.firstRecall ? `first recall ${m.firstRecall}` : null,
    m.reportsBeforeFirstRecall != null
      ? `${int(m.reportsBeforeFirstRecall)} unverified reports published before it`
      : null,
  ].filter(Boolean);
  return { text: recalls, detail: bits.join("; ") };
}

export function companyCounts(companies: readonly SpCompany[]) {
  const manufacturers = companies.filter((c) => c.role === "manufacturer");
  return {
    manufacturers: manufacturers.length,
    retailers: companies.length - manufacturers.length,
    withRecallMatch: manufacturers.filter((c) => c.recallMatch).length,
    withProfile: companies.filter((c) => c.cik).length,
  };
}
