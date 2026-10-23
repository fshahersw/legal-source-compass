/**
 * Pure builders for the consumer-complaint blocks of the Analytics overview: CFPB complaints and FTC Consumer
 * Sentinel reports. Inputs are already-validated rows; the readers do the I/O.
 */
import { assembleBlock, longDate, yearPoints, type TrendBlockData } from "../trend";

export type CfpbYear = {
  year: number;
  complaints: number;
  complete: boolean;
  creditReporting: number | null;
};

/** CFPB Consumer Complaint Database: complaints received per calendar year. */
export function buildCfpbComplaints(input: {
  years: readonly CfpbYear[];
  from: string | null;
  to: string | null;
}): TrendBlockData | null {
  if (!input.years.length) return null;
  const partials = input.years.filter((y) => !y.complete).map((y) => y.year);
  const firstYear = Math.min(...input.years.map((y) => y.year));
  const lastYear = Math.max(...input.years.map((y) => y.year));
  const partialNotes: string[] = [];
  if (partials.includes(firstYear) && input.from)
    partialNotes.push(
      `${firstYear}* starts on ${longDate(input.from)}, when the database opened, so it covers part of the year.`,
    );
  if (partials.includes(lastYear) && input.to)
    partialNotes.push(`${lastYear}* runs through ${longDate(input.to)}.`);
  const anyCreditReporting = input.years.some((y) => y.creditReporting !== null);
  return assembleBlock({
    id: "cfpb-complaints",
    xKind: "year",
    chart: "line",
    unit: "complaints",
    series: [
      {
        id: "all",
        label: "All complaints",
        points: yearPoints(
          input.years.map((y) => ({ year: y.year, value: y.complaints, partial: !y.complete })),
        ),
      },
      ...(anyCreditReporting
        ? [
            {
              id: "credit-reporting",
              label: "of which credit reporting products",
              points: yearPoints(
                input.years.map((y) => ({
                  year: y.year,
                  value: y.creditReporting,
                  partial: !y.complete,
                })),
              ),
            },
          ]
        : []),
    ],
    source: {
      label: "Consumer Financial Protection Bureau, Consumer Complaint Database",
      url: "https://www.consumerfinance.gov/data-research/consumer-complaints/",
    },
    asOf: input.to,
    notes: [
      "Counts complaints by the date the CFPB received them. A complaint is a consumer's submission, not a finding of wrongdoing.",
      ...(anyCreditReporting
        ? [
            "Credit reporting products are grouped by the dataset's own rule on the CFPB product names; the line shows how much of the total they make up.",
          ]
        : []),
      ...partialNotes,
      ...(partials.length
        ? ["Partial years are not used for the latest value or its change."]
        : []),
    ],
  });
}

export type SentinelYear = {
  year: number;
  total: number | null;
  fraud: number | null;
  sourceUrl: string | null;
};

/** FTC Consumer Sentinel Network Data Books: reports received per calendar year. */
export function buildSentinel(input: { years: readonly SentinelYear[] }): TrendBlockData | null {
  if (!input.years.some((y) => y.total !== null)) return null;
  const latest = [...input.years].filter((y) => y.sourceUrl).sort((a, b) => b.year - a.year)[0];
  return assembleBlock({
    id: "ftc-sentinel",
    xKind: "year",
    chart: "line",
    unit: "reports",
    series: [
      {
        id: "total",
        label: "All reports",
        points: yearPoints(input.years.map((y) => ({ year: y.year, value: y.total }))),
      },
      {
        id: "fraud",
        label: "of which fraud",
        points: yearPoints(input.years.map((y) => ({ year: y.year, value: y.fraud }))),
      },
    ],
    source: {
      label: latest
        ? `FTC Consumer Sentinel Network Data Book ${latest.year}`
        : "FTC Consumer Sentinel Network Data Books",
      url: latest?.sourceUrl ?? "https://www.ftc.gov/enforcement/consumer-sentinel-network",
    },
    notes: [
      "Counts the reports the FTC prints for each calendar year in that year's Data Book (fraud, identity theft and other reports). Each figure is as that Data Book prints it; later editions are not used to restate it.",
      "Only the editions held are plotted, one per year; a year without a held edition is a gap.",
      "A report is a submission, not a finding of wrongdoing.",
    ],
  });
}
