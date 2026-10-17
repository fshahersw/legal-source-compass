/** Federal district court caseload analytics (dataset court_analytics, keyed by court_spine id). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

export type NatureOfSuit = {
  category: string;
  filings: number;
  prior: number | null;
  change_pct: number | null;
};
export type CourtMdl = {
  mdl: number;
  title: string;
  pending: number;
  total: number;
  judge: string | null;
  type: string | null;
};
export type CourtAnalytics = {
  court_id: string;
  name: string;
  years: number[];
  metrics: Record<string, (number | null)[]>;
  standing: Record<string, { us: number | null; circuit: number | null }>;
  percentile: Record<string, number>;
  nature_of_suit: NatureOfSuit[];
  criminal: Record<string, number>;
  civil_total: number | null;
  mdls: CourtMdl[];
  mdl_actions: number;
  mdl_as_of: string;
};
export type NationalDistribution = Record<string, { min: number; median: number; max: number }>;
export type CourtAnalyticsResult = {
  court: CourtAnalytics;
  national: {
    metrics: Record<string, (number | null)[]>;
    distributions: NationalDistribution;
  } | null;
} | null;

type Item = { analytics?: unknown };

export const getCourtAnalytics = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(/^[a-z0-9_-]{1,40}$/) }).parse(d))
  .handler(async ({ data }): Promise<CourtAnalyticsResult> => {
    const r = await restGet<{ id: string; item: Item }[]>(
      `corpus_records?select=id,item&dataset=eq.court_analytics&id=in.(${encodeURIComponent(data.id)},summary:national)`,
    );
    const court = r.rows.find((row) => row.id === data.id)?.item.analytics as
      CourtAnalytics | undefined;
    if (!court) return null;
    const national = r.rows.find((row) => row.id === "summary:national")?.item.analytics as
      | { metrics: Record<string, (number | null)[]>; distributions: NationalDistribution }
      | undefined;
    return { court, national: national ?? null };
  });
