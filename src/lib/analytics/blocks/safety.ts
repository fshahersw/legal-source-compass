/**
 * Pure builders for the recall and adverse-event blocks of the Analytics overview: CPSC, NHTSA, FSIS, FDA recall
 * enforcement reports, FAERS and CAERS. Inputs are already-validated rows; the readers do the I/O.
 */
import {
  assembleBlock,
  longDate,
  yearPoints,
  type TrendBlockData,
  type TrendSeries,
  type YearEntry,
} from "../trend";
import { isPartialYear, type CountByYear } from "./enforcement";

const partialNote = (years: number[], through: string | null): string[] =>
  years.length
    ? [
        through
          ? `${years.map((y) => `${y}*`).join(", ")} runs through ${longDate(through)}; it is not used for the latest value or its change.`
          : `${years.map((y) => `${y}*`).join(", ")} is a partial year; it is not used for the latest value or its change.`,
      ]
    : [];

export type CpscYearInput = { year: number; recalls: number; partial: boolean };

/** CPSC Recall API: recalls announced per calendar year. */
export function buildCpscRecalls(input: {
  years: readonly CpscYearInput[];
  asOf: string | null;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const partials = input.years.filter((y) => y.partial).map((y) => y.year);
  return assembleBlock({
    id: "cpsc-recalls",
    xKind: "year",
    chart: "bar",
    unit: "recalls",
    series: [
      {
        id: "recalls",
        label: "Recalls",
        points: yearPoints(
          input.years.map((y) => ({ year: y.year, value: y.recalls, partial: y.partial })),
        ),
      },
    ],
    source: {
      label: "U.S. Consumer Product Safety Commission, Recall API",
      url: "https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information",
    },
    asOf: input.asOf,
    notes: [
      "Counts CPSC recall announcements by the year of the recall date. One recall can cover many products and units.",
      ...partialNote(partials, input.asOf),
    ],
  });
}

/** NHTSA recall campaigns per calendar year of the campaign date. */
export function buildNhtsaRecalls(input: {
  byYear: readonly CountByYear[];
  latestDate: string | null;
  today: string;
}): TrendBlockData | null {
  if (!input.byYear.length) return null;
  const entries: YearEntry[] = input.byYear.map((r) => ({
    year: r.year,
    value: r.count,
    partial: isPartialYear(r.year, input.latestDate, input.today),
  }));
  const partials = entries.filter((e) => e.partial).map((e) => e.year);
  return assembleBlock({
    id: "nhtsa-recalls",
    xKind: "year",
    chart: "bar",
    unit: "recall campaigns",
    series: [{ id: "campaigns", label: "Recall campaigns", points: yearPoints(entries) }],
    source: {
      label: "National Highway Traffic Safety Administration, recalls data",
      url: "https://www.nhtsa.gov/nhtsa-datasets-and-apis",
    },
    asOf: input.latestDate,
    notes: [
      "Counts NHTSA recall campaigns by the year the manufacturer's Part 573 report was received. One campaign can cover many vehicles, so this is not a count of vehicles recalled.",
      ...partialNote(partials, input.latestDate),
    ],
  });
}

export type FsisYear = { year: number; recalls: number; alerts: number };

/** FSIS listing: recalls (Class I, II and III) and public health alerts per calendar year. */
export function buildFsisRecalls(input: {
  years: readonly FsisYear[];
  latestDate: string | null;
  today: string;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const flag = (y: number) => isPartialYear(y, input.latestDate, input.today);
  const partials = input.years.filter((y) => flag(y.year)).map((y) => y.year);
  return assembleBlock({
    id: "fsis-recalls",
    xKind: "year",
    chart: "line",
    unit: "recalls",
    series: [
      {
        id: "recalls",
        label: "Recalls (Class I, II and III)",
        points: yearPoints(
          input.years.map((y) => ({ year: y.year, value: y.recalls, partial: flag(y.year) })),
        ),
      },
      {
        id: "alerts",
        label: "Public health alerts",
        points: yearPoints(
          input.years.map((y) => ({ year: y.year, value: y.alerts, partial: flag(y.year) })),
        ),
      },
    ],
    source: {
      label: "USDA Food Safety and Inspection Service, recalls",
      url: "https://www.fsis.usda.gov/recalls",
    },
    asOf: input.latestDate,
    notes: [
      "Counts listings by the year of the recall date on the FSIS recalls page. Expansions of an earlier recall are separate listings and are included, so a year can exceed the total in FSIS's annual summaries, which do not count them. A public health alert is not a recall and is drawn as a separate line.",
      ...partialNote(partials, input.latestDate),
    ],
  });
}

export type FdaYear = { year: number; drug: number; device: number; food: number };

/** openFDA enforcement reports: recalled-product entries per report year, by product type. */
export function buildFdaRecalls(input: {
  years: readonly FdaYear[];
  latestDate: string | null;
  today: string;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const flag = (y: number) => isPartialYear(y, input.latestDate, input.today);
  const entries = (pick: (y: FdaYear) => number): YearEntry[] =>
    input.years.map((y) => ({ year: y.year, value: pick(y), partial: flag(y.year) }));
  const total: TrendSeries = {
    id: "total",
    label: "All entries",
    points: yearPoints(entries((y) => y.drug + y.device + y.food)),
  };
  const partials = input.years.filter((y) => flag(y.year)).map((y) => y.year);
  return assembleBlock({
    id: "fda-recalls",
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
      "Each entry is one recalled product in an FDA enforcement report, counted by the report date. One recall event can cover several products, so entries are not recall events or firms.",
      "Drug, device and food entries come from three separate openFDA enforcement endpoints; other FDA product types are not in this count.",
      ...partialNote(partials, input.latestDate),
    ],
  });
}

export type ReportYearInput = { year: number; reports: number; partial: boolean };

const REPORT_CAVEAT =
  "Counts are reports, not incidence: a report says a product was mentioned with an adverse event, not that it caused it. Reporting rises with publicity and litigation, and counts change as FDA adds, deduplicates or revises reports.";

/** FAERS (openFDA drug/event): adverse-event reports by the year FDA first received them. */
export function buildFaers(input: {
  years: readonly ReportYearInput[];
  dataThrough: string | null;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const partials = input.years.filter((y) => y.partial).map((y) => y.year);
  return assembleBlock({
    id: "faers",
    xKind: "year",
    chart: "bar",
    unit: "reports",
    series: [
      {
        id: "reports",
        label: "Reports",
        points: yearPoints(
          input.years.map((y) => ({ year: y.year, value: y.reports, partial: y.partial })),
        ),
      },
    ],
    source: {
      label: "FDA Adverse Event Reporting System via openFDA",
      url: "https://open.fda.gov/apis/drug/event/",
    },
    asOf: input.dataThrough,
    notes: [
      "Counts reports by the year FDA first received them (receive date).",
      REPORT_CAVEAT,
      ...partialNote(partials, input.dataThrough),
    ],
  });
}

/** CAERS (openFDA food/event): food, dietary supplement and cosmetic adverse-event reports per year. */
export function buildCaers(input: {
  years: readonly ReportYearInput[];
  dataThrough: string | null;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const partials = input.years.filter((y) => y.partial).map((y) => y.year);
  return assembleBlock({
    id: "caers",
    xKind: "year",
    chart: "bar",
    unit: "reports",
    series: [
      {
        id: "reports",
        label: "Reports",
        points: yearPoints(
          input.years.map((y) => ({ year: y.year, value: y.reports, partial: y.partial })),
        ),
      },
    ],
    source: {
      label: "FDA CAERS via openFDA (food, supplement and cosmetic events)",
      url: "https://open.fda.gov/apis/food/event/",
    },
    asOf: input.dataThrough,
    notes: [
      "Counts reports by the year FDA created them (the date-created field).",
      REPORT_CAVEAT,
      ...partialNote(partials, input.dataThrough),
    ],
  });
}
