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
  mdlRecordRefs,
  parseCompanySummary,
  parseFinancials,
  parseLink,
  parseOverview,
  type CompaniesData,
  type CompanyDetail,
  type CompanyLink,
  type MdlRecordLookup,
} from "@/components/companies/companyData";

const TTL_MS = 10 * 60 * 1000;
/** A profile whose MDL record lookup failed is kept only briefly, so links come back once the read recovers. */
const DEGRADED_TTL_MS = 30 * 1000;
let listCache: { at: number; value: CompaniesData | null } | null = null;
const detailCache = new Map<string, { at: number; ttl: number; value: CompanyDetail | null }>();

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

/**
 * Which linked MDL numbers have a record to open: mdl_analytics (pending and recently reported MDLs, id = number)
 * and mdl_terminated_history (JPML terminated-litigation rows, matched on their recorded MDL number).
 *
 * The lookup only decides whether a number is linked, so it never fails the profile: a failed read returns null
 * (shown as "lookup unavailable"). A terminated-history response that fills its limit, or reports more matching
 * rows than it returned, may be missing rows; numbers that depend on it are then "unknown", never resolved from it.
 */
async function existingMdlRecords(mdls: number[]): Promise<Record<string, MdlRecordLookup> | null> {
  const numbers = [...new Set(mdls)].filter((n) => Number.isInteger(n) && n > 0);
  if (!numbers.length) return {};
  const list = numbers.join(",");
  const limit = numbers.length * 10;
  try {
    const [analytics, terminated] = await Promise.all([
      restGet<{ id: string }[]>(
        `corpus_records?select=id&dataset=eq.mdl_analytics&id=in.(${list})&order=id.asc&limit=${numbers.length}`,
      ),
      restGet<{ id: string; mdl: unknown }[]>(
        `corpus_records?select=id,mdl:item->history->mdl&dataset=eq.mdl_terminated_history&item->history->>mdl=in.(${list})&order=id.asc&limit=${limit}`,
        { count: true },
      ),
    ]);
    const complete =
      terminated.rows.length < limit &&
      (terminated.total === null || terminated.total <= terminated.rows.length);
    return mdlRecordRefs(
      numbers,
      analytics.rows.map((r) => r.id),
      terminated.rows,
      complete,
    );
  } catch (err) {
    console.error(
      `MDL record lookup failed; MDL numbers shown unlinked: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

const CIK = /^\d{10}$/;

export const getCompanyDetail = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ cik: z.string().regex(CIK) }).parse(d))
  .handler(async ({ data }): Promise<CompanyDetail | null> => {
    const { cik } = data;
    const hit = detailCache.get(cik);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
    // The MDL record lookup starts as soon as the links arrive, overlapping the profile and financials reads.
    const linksRead = restGet<Row[]>(
      `corpus_records?select=id,source_url,item:item->link&dataset=eq.company_sec_mdl_links&id=like.${cik}:*&order=id.asc&limit=200`,
    ).then((r) =>
      r.rows.map((row) => parseLink(row.item)).filter((l): l is CompanyLink => l !== null),
    );
    const [profile, financials, parsedLinks, mdlRecords] = await Promise.all([
      restGet<Row[]>(
        `corpus_records?select=id,source_url,item&dataset=eq.company_sec_profiles&id=eq.${cik}&limit=1`,
      ),
      restGet<Row[]>(
        `corpus_records?select=id,source_url,item&dataset=eq.company_sec_financials&id=eq.${cik}&limit=1`,
      ),
      linksRead,
      linksRead.then((ls) => existingMdlRecords(ls.map((l) => l.mdl))),
    ]);
    const profileItem = profile.rows[0]?.item as { summary?: unknown } | undefined;
    const summary = parseCompanySummary(profileItem?.summary);
    if (!summary) {
      detailCache.set(cik, { at: Date.now(), ttl: TTL_MS, value: null });
      return null;
    }
    const value: CompanyDetail = {
      summary,
      sourceUrl: profile.rows[0]?.source_url ?? null,
      financials: parseFinancials(financials.rows[0]?.item),
      financialsSourceUrl: financials.rows[0]?.source_url ?? null,
      mdlRecords,
      links: parsedLinks,
    };
    detailCache.set(cik, {
      at: Date.now(),
      ttl: mdlRecords === null ? DEGRADED_TTL_MS : TTL_MS,
      value,
    });
    return value;
  });
