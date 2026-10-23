/**
 * Pure builder for the lens's adverse-event cards: openFDA FAERS (drugs) or MAUDE (devices) reports about the product an
 * MDL concerns, by the year FDA received them. Reports are submissions, not confirmed causes, and are affected by
 * litigation-driven reporting; the card says so and gives the national total of the latest complete year as the baseline.
 */
import {
  assembleBlock,
  formatCount,
  longDate,
  yearPoints,
  type TrendBlockData,
} from "@/lib/analytics/trend";

export type AdverseSystem = "faers" | "maude";

export type AdverseYear = {
  year: number;
  reports: number | null;
  /** Reports with a death outcome (FAERS) or a death event type (MAUDE). */
  deaths: number | null;
  partial: boolean;
  /** Every report of the system received that year. */
  nationalReports: number | null;
};

const SYSTEMS: Record<
  AdverseSystem,
  { name: string; deathLabel: string; source: { label: string; url: string }; what: string }
> = {
  faers: {
    name: "FAERS",
    deathLabel: "Reports with a death outcome",
    source: {
      label: "FDA Adverse Event Reporting System via openFDA (drugs and biologics)",
      url: "https://open.fda.gov/apis/drug/event/",
    },
    what: "FAERS reports whose drug field names the product, counted by the year FDA received them",
  },
  maude: {
    name: "MAUDE",
    deathLabel: "Reports with a death event type",
    source: {
      label: "FDA MAUDE device adverse events via openFDA",
      url: "https://open.fda.gov/apis/device/event/",
    },
    what: "MAUDE reports whose device fields name the product, counted by the year FDA received them",
  },
};

export function buildMdlAdverseYears(input: {
  mdl: number;
  system: AdverseSystem;
  rows: readonly AdverseYear[];
  dataThrough: string | null;
}): TrendBlockData | null {
  const sys = SYSTEMS[input.system];
  const rows = input.rows.filter((r) => r.reports !== null);
  if (!rows.length) return null;
  const point = (pick: (r: AdverseYear) => number | null) =>
    yearPoints(
      input.rows.map((r) => ({
        year: r.year,
        value: pick(r),
        ...(r.partial ? { partial: true } : {}),
      })),
    );
  const latest = [...rows].filter((r) => !r.partial).sort((a, b) => b.year - a.year)[0];
  const baseline =
    latest &&
    latest.nationalReports !== null &&
    latest.nationalReports > 0 &&
    latest.reports !== null
      ? `In ${latest.year}, these ${formatCount(latest.reports)} reports were ${((100 * latest.reports) / latest.nationalReports).toFixed(3)}% of the ${formatCount(latest.nationalReports)} ${sys.name} reports received that year.`
      : null;
  return assembleBlock({
    id: `mdl-${input.system}-years-${input.mdl}`,
    xKind: "year",
    chart: "bar",
    unit: "reports",
    series: [
      { id: "reports", label: "Reports", points: point((r) => r.reports) },
      { id: "deaths", label: sys.deathLabel, points: point((r) => r.deaths) },
    ],
    source: sys.source,
    asOf: input.dataThrough,
    notes: [
      `${sys.what}. A report says the product was mentioned with an adverse event, not that it caused it, and counts cannot be turned into rates without exposure data.`,
      "Reporting rises with publicity and litigation: claimants' lawyers file reports and manufacturers forward reports they learn of through lawsuits.",
      ...(baseline ? [baseline] : []),
      ...(input.dataThrough && input.rows.some((r) => r.partial)
        ? [
            `The current year holds reports only through ${longDate(input.dataThrough)}; it is drawn faded and is not used for the latest value or its change.`,
          ]
        : []),
    ],
  });
}
