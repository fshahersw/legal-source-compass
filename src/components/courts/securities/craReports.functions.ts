/**
 * Read access to the class action research report datasets (cra_reports, cra_facts). Inputs are validated against
 * allowlists: a chart id from CHARTS and a report id of the build's shape, so a request can only read these two
 * datasets. Rows are validated by craModel; rows that cannot be read are dropped and counted.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "@/lib/external/rest.server";
import {
  CHART_IDS,
  CHARTS,
  parseFact,
  parseReport,
  REPORT_ID,
  type ChartId,
  type CraFact,
  type CraReport,
} from "./craModel";

const FACT_SELECT = "select=id,source_url,label:item->cells->>series,p:item->profile";
/** Most single-year values one line has (filings, 1997–2025, in every report that prints them) is about 300. */
const LINE_LIMIT = 1000;
export const FACTS_PAGE = 50;

const cs = (v: Record<string, string[]>) => encodeURIComponent(JSON.stringify(v));

export type CraReportList = { reports: CraReport[]; dropped: number };
export type CraChartFacts = {
  chart: ChartId;
  facts: CraFact[];
  dropped: number;
  truncated: boolean;
};
export type CraReportFacts = {
  report: string;
  offset: number;
  total: number | null;
  facts: CraFact[];
  dropped: number;
};

export const getCraReports = createServerFn({ method: "GET" }).handler(
  async (): Promise<CraReportList> => {
    const r = await restGet<{ id: unknown; p: unknown }[]>(
      "corpus_records?select=id,p:item->profile&dataset=eq.cra_reports&order=ordinal.asc&limit=500",
    );
    const reports = r.rows.map(parseReport).filter((x): x is CraReport => !!x);
    return { reports, dropped: r.rows.length - reports.length };
  },
);

export function linePath(series: string, dimension: string): string {
  const dim = dimension ? `&item->profile->>dimension=eq.${encodeURIComponent(dimension)}` : "";
  return `corpus_records?${FACT_SELECT}&dataset=eq.cra_facts&filters=cs.${cs({ series: [series], period_type: ["year"] })}${dim}&order=ordinal.asc&limit=${LINE_LIMIT}`;
}

export const getCraChartFacts = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ chart: z.enum(CHART_IDS as [ChartId, ...ChartId[]]) }).parse(d))
  .handler(async ({ data }): Promise<CraChartFacts> => {
    const lines = CHARTS[data.chart];
    const paths = [...new Set(lines.map((l) => linePath(l.series, l.dimension)))];
    const results = await Promise.all(
      paths.map((p) =>
        restGet<{ id: unknown; source_url: unknown; label: unknown; p: unknown }[]>(p),
      ),
    );
    const rows = results.flatMap((r) => r.rows);
    const facts = rows.map(parseFact).filter((x): x is CraFact => !!x);
    return {
      chart: data.chart,
      facts,
      dropped: rows.length - facts.length,
      truncated: results.some((r) => r.rows.length >= LINE_LIMIT),
    };
  });

export function reportFactsPath(report: string): string {
  return `corpus_records?${FACT_SELECT}&dataset=eq.cra_facts&filters=cs.${cs({ report: [report] })}&order=ordinal.asc`;
}

export const getCraReportFacts = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        report: z.string().regex(REPORT_ID),
        offset: z.number().int().min(0).max(20000),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<CraReportFacts> => {
    const r = await restGet<{ id: unknown; source_url: unknown; label: unknown; p: unknown }[]>(
      reportFactsPath(data.report),
      { count: true, range: [data.offset, data.offset + FACTS_PAGE - 1] },
    );
    const facts = r.rows
      .map(parseFact)
      .filter((x): x is CraFact => !!x && x.reportId === data.report);
    return {
      report: data.report,
      offset: data.offset,
      total: r.total,
      facts,
      dropped: r.rows.length - facts.length,
    };
  });
