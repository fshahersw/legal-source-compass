/**
 * Case lens: everything recorded about one MDL across datasets — JPML trajectory, transferee court caseload,
 * the transferee judge's FJC profile, the product's agency signal and automated safety flags. Joins are by
 * exact MDL number (JSON containment), never by name similarity; an ambiguous join returns nothing.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import type { CourtAnalytics, NationalDistribution } from "./courtAnalytics.functions";
import type { FjcProfile } from "./judgeProfiles.functions";
import { toSignals, type MassTortSignal } from "./massTortSignals.functions";
import { parseInsight, type SafetyInsight } from "./safetyInsights.functions";
import {
  parseCompanySummary,
  parseLink,
  type CompanyLink,
  type CompanySummary,
} from "@/components/companies/companyData";

import { parseCourtPage, type CourtMdl } from "./mdlIntel.functions";

export type LensCompany = {
  cik: string;
  name: string;
  link: CompanyLink;
  summary: CompanySummary | null;
};

export type LensMdl = {
  mdl: number;
  title: string;
  type: string | null;
  status: string | null;
  district: string | null;
  judge: string | null;
  pending: number | null;
  total: number | null;
  asOf: string | null;
  growth: string | null;
  rank: number | null;
  dateTransferred: string | null;
  dateFiled: string | null;
  masterDocket: string | null;
  ageYears: number | null;
  new12m: number | null;
  resolved12m: number | null;
  change12m: number | null;
  peakPending: number | null;
  series: { date: string; pending: number; total: number }[];
  badges: string[];
};
export type MdlLens = {
  mdl: LensMdl | null;
  court: CourtAnalytics | null;
  courtDistributions: NationalDistribution | null;
  judge: FjcProfile | null;
  judgeAmbiguous: boolean;
  signal: MassTortSignal | null;
  insights: SafetyInsight[];
  /** Registrants whose own SEC filings name this MDL (company_sec_mdl_links); tier and role as recorded. */
  companies: LensCompany[];
  /** Official transferee-court MDL page facts (mdl_intel_court_pages): verbatim quotes and listed orders. */
  courtPage: CourtMdl | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const contains = (mdl: number) => encodeURIComponent(JSON.stringify([{ mdl }]));

function toMdl(item: Record<string, unknown> | undefined, mdl: number): LensMdl | null {
  if (!item) return null;
  const a = (item["analytics"] ?? {}) as Record<string, unknown>;
  const cells = (item["cells"] ?? {}) as Record<string, unknown>;
  const series = Array.isArray(a["series"]) ? a["series"] : [];
  return {
    mdl,
    title: str(item["title"]) ?? str(cells["litigation"]) ?? `MDL ${mdl}`,
    type: str(a["type"]) ?? str(cells["type"]),
    status: str(a["status"]) ?? str(cells["status"]),
    district: str(a["district"]) ?? str(cells["district"]),
    judge: str(a["judge"]) ?? str(cells["judge"]),
    pending: num(a["pending"]),
    total: num(a["total"]),
    asOf: str(a["as_of"]),
    growth: str(a["growth"]),
    rank: num(item["rank"]),
    dateTransferred: str(a["date_transferred"]),
    dateFiled: str(a["date_filed"]),
    masterDocket: str(a["master_docket"]),
    ageYears: num(a["age_years"]),
    new12m: num(a["new_12m"]),
    resolved12m: num(a["resolved_12m"]),
    change12m: num(a["change_12m"]),
    peakPending: num(a["peak_pending"]),
    series: series.flatMap((p) => {
      const point = p as Record<string, unknown>;
      const pending = num(point["pending"]);
      const total = num(point["total"]);
      return str(point["date"]) && pending != null && total != null
        ? [{ date: str(point["date"])!, pending, total }]
        : [];
    }),
    badges: Array.isArray(item["badges"])
      ? item["badges"].filter((b): b is string => typeof b === "string")
      : [],
  };
}

export const getMdlLens = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ mdl: z.number().int().min(1).max(99999) }).parse(d))
  .handler(async ({ data }): Promise<MdlLens> => {
    const id = String(data.mdl);
    const linkFilter = encodeURIComponent(JSON.stringify({ mdl: [id] }));
    const [mdl, court, national, judges, signal, insights, links, page] = await Promise.all([
      restGet<{ item: Record<string, unknown> }[]>(
        `corpus_records?select=item&dataset=eq.mdl_analytics&id=eq.${id}&limit=1`,
      ),
      restGet<{ id: string; item: { analytics?: CourtAnalytics } }[]>(
        `corpus_records?select=id,item&dataset=eq.court_analytics&item->analytics->mdls=cs.${contains(data.mdl)}&limit=3`,
      ),
      restGet<{ item: { analytics?: { distributions?: NationalDistribution } } }[]>(
        "corpus_records?select=item&dataset=eq.court_analytics&id=eq.summary:national&limit=1",
      ),
      restGet<{ id: string; item: { profile?: FjcProfile } }[]>(
        `corpus_records?select=id,item&dataset=eq.judge_profiles_fjc&item->profile->mdls=cs.${contains(data.mdl)}&limit=3`,
      ),
      restGet<{ item: Parameters<typeof toSignals>[0] }[]>(
        `corpus_records?select=item&dataset=eq.agency_safety_mass_tort_signals&id=eq.${id}&limit=1`,
      ),
      restGet<{ item: { insight?: unknown } }[]>(
        `corpus_records?select=item&dataset=eq.agency_safety_insights&item->insight->>entity=eq.${encodeURIComponent(`MDL ${id}`)}&limit=10`,
      ),
      restGet<{ id: string; link: Record<string, unknown> | null }[]>(
        `corpus_records?select=id,link:item->link&dataset=eq.company_sec_mdl_links&filters=cs.${linkFilter}&limit=50`,
      ),
      restGet<{ court: unknown }[]>(
        `corpus_records?select=court:item->court&dataset=eq.mdl_intel_court_pages&id=eq.${id}&limit=1`,
      ),
    ]);
    const parsedLinks = links.rows.flatMap((row) => {
      const link = parseLink(row.link);
      const cik = typeof row.link?.["cik"] === "string" ? row.link["cik"] : null;
      const name = typeof row.link?.["company"] === "string" ? row.link["company"] : null;
      return link && cik && /^\d{10}$/.test(cik) && link.mdl === data.mdl
        ? [{ cik, name: name ?? cik, link }]
        : [];
    });
    const summaries = parsedLinks.length
      ? await restGet<{ id: string; summary: unknown }[]>(
          `corpus_records?select=id,summary:item->summary&dataset=eq.company_sec_profiles&id=in.(${parsedLinks.map((l) => l.cik).join(",")})`,
        )
      : { rows: [] as { id: string; summary: unknown }[] };
    const byCik = new Map(summaries.rows.map((r) => [r.id, parseCompanySummary(r.summary)]));
    const tierOrder = { A: 0, B: 1, C: 2 } as const;
    const companies = parsedLinks
      .map((l) => ({ ...l, summary: byCik.get(l.cik) ?? null }))
      .sort(
        (a, b) =>
          tierOrder[a.link.tier] - tierOrder[b.link.tier] ||
          b.link.verifiedCount - a.link.verifiedCount,
      );
    return {
      mdl: toMdl(mdl.rows[0]?.item, data.mdl),
      // A court or judge is shown only when exactly one record lists this MDL.
      court: court.rows.length === 1 ? (court.rows[0]!.item.analytics ?? null) : null,
      courtDistributions: national.rows[0]?.item.analytics?.distributions ?? null,
      judge: judges.rows.length === 1 ? (judges.rows[0]!.item.profile ?? null) : null,
      judgeAmbiguous: judges.rows.length > 1,
      signal: signal.rows[0] ? (toSignals(signal.rows[0].item)[0] ?? null) : null,
      companies,
      courtPage: page.rows[0] ? parseCourtPage(page.rows[0].court) : null,
      insights: insights.rows.flatMap(({ item }) => {
        const parsed = parseInsight(item?.insight);
        return parsed ? [parsed] : [];
      }),
    };
  });
