/**
 * SEC company intelligence for MDL defendants (datasets company_sec_profiles, company_sec_mdl_links,
 * company_sec_financials, built by scripts/enrichment/sec/build_company_sec.py).
 *
 * Every company<->MDL link is backed by the company's own SEC filing text; financial series are the
 * registrant's own XBRL facts. Stored JSON is validated defensively: malformed rows are dropped and
 * missing values stay null ("Not recorded"), never guessed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import {
  parseCompanySummary,
  parseFinancials,
  parseLink,
  parseOverview,
  type CompaniesData,
  type CompanyDetail,
} from "@/components/companies/companyData";

const TTL_MS = 10 * 60 * 1000;
let listCache: { at: number; value: CompaniesData | null } | null = null;
const detailCache = new Map<string, { at: number; value: CompanyDetail | null }>();

type Row = { id: string; source_url?: string | null; item: unknown };

async function readAll(dataset: string, select: string) {
  const rows: Row[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await restGet<Row[]>(
      `corpus_records?select=${select}&dataset=eq.${dataset}&order=ordinal.asc`,
      { range: [start, start + 999] },
    );
    rows.push(...page.rows);
    if (page.rows.length < 1000) return rows;
  }
}

export const getCompaniesIntelligence = createServerFn({ method: "GET" }).handler(
  async (): Promise<CompaniesData | null> => {
    if (listCache && Date.now() - listCache.at < TTL_MS) return listCache.value;
    const rows = await readAll(
      "company_sec_profiles",
      "id,summary:item->summary,overview:item->overview",
    );
    const overviewRow = rows.find((r) => r.id === "summary:overview") as
      (Row & { overview?: unknown }) | undefined;
    const overview = parseOverview(overviewRow?.overview);
    const companies = rows
      .filter((r) => r.id !== "summary:overview")
      .map((r) => parseCompanySummary((r as Row & { summary?: unknown }).summary))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const value = overview ? { overview, companies } : null;
    listCache = { at: Date.now(), value };
    return value;
  },
);

const CIK = /^\d{10}$/;

export const getCompanyDetail = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ cik: z.string().regex(CIK) }).parse(d))
  .handler(async ({ data }): Promise<CompanyDetail | null> => {
    const { cik } = data;
    const hit = detailCache.get(cik);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const [profile, financials, links] = await Promise.all([
      restGet<Row[]>(
        `corpus_records?select=id,source_url,item&dataset=eq.company_sec_profiles&id=eq.${cik}&limit=1`,
      ),
      restGet<Row[]>(
        `corpus_records?select=id,source_url,item&dataset=eq.company_sec_financials&id=eq.${cik}&limit=1`,
      ),
      restGet<Row[]>(
        `corpus_records?select=id,source_url,item:item->link&dataset=eq.company_sec_mdl_links&id=like.${cik}:*&order=id.asc&limit=200`,
      ),
    ]);
    const profileItem = profile.rows[0]?.item as { summary?: unknown } | undefined;
    const summary = parseCompanySummary(profileItem?.summary);
    if (!summary) {
      detailCache.set(cik, { at: Date.now(), value: null });
      return null;
    }
    const value: CompanyDetail = {
      summary,
      sourceUrl: profile.rows[0]?.source_url ?? null,
      financials: parseFinancials(financials.rows[0]?.item),
      links: links.rows.map((r) => parseLink(r.item)).filter((l) => l !== null),
    };
    detailCache.set(cik, { at: Date.now(), value });
    return value;
  });
