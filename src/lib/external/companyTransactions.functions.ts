/**
 * Corporate transactions of a profiled company from FTC HSR early termination notices, exact-key only (see
 * companyTransactions.ts). The candidate read narrows the 28k notices with an ilike on the key's first word; the exact
 * key then decides every match, so the narrowing can only drop non-matches.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ilikeTerm, restGet } from "./rest.server";
import { readAllRows } from "@/lib/analytics/tally.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import { companyKey } from "./regulatoryRecords.functions";
import { parseHsrSeries } from "./ftcData";
import {
  matchTransactions,
  parseNotice,
  suspensionYears,
  uniqueKey,
  type CompanyTransaction,
} from "./companyTransactions";

export type CompanyTransactionsPayload = {
  status: "matched" | "no_match" | "shared_key" | "no_profile";
  name: string | null;
  key: string | null;
  rows: CompanyTransaction[];
  /** Calendar years in which early-termination grants collapsed (policy suspension), from the FTC series. */
  suspended: number[];
  calendar: { year: number; count: number }[];
  firstDate: string | null;
  lastDate: string | null;
};

const profileNames = memoAsync(READ_TTL_MS, async () => {
  const rows = await readAllRows<{ id: string; n: unknown }>(
    "corpus_records?select=id,n:item->summary->company->name&dataset=eq.company_sec_profiles&order=ordinal.asc",
    { max: 5_000 },
  );
  return rows.flatMap((r) =>
    /^\d{10}$/.test(r.id) && typeof r.n === "string" ? [{ cik: r.id, name: r.n }] : [],
  );
});

const hsrSeries = memoAsync(READ_TTL_MS, async () => {
  const { rows } = await restGet<unknown[]>(
    "corpus_records?select=id,s:item->series,cells:item->cells&dataset=eq.ftc_hsr_early_terminations&id=eq.series-by-year&limit=1",
  );
  return parseHsrSeries(rows[0]);
});

export const getCompanyTransactions = createServerFn({ method: "GET" })
  .inputValidator((d: { cik: string }) => z.object({ cik: z.string().regex(/^\d{10}$/) }).parse(d))
  .handler(async ({ data }): Promise<CompanyTransactionsPayload> => {
    const [profiles, series] = await Promise.all([profileNames(), hsrSeries()]);
    const calendar = series?.calendar ?? [];
    const base = {
      rows: [] as CompanyTransaction[],
      suspended: suspensionYears(calendar),
      calendar,
      firstDate: series?.firstDate ?? null,
      lastDate: series?.lastDate ?? null,
    };
    const own = profiles.find((p) => p.cik === data.cik);
    if (!own) return { ...base, status: "no_profile", name: null, key: null };
    const key = companyKey(own.name);
    if (
      !uniqueKey(
        key,
        profiles.map((p) => p.name),
        companyKey,
      )
    )
      return { ...base, status: "shared_key", name: own.name, key: key || null };
    const word = key.split(" ").find((w) => w.length >= 3) ?? key;
    const raw = await readAllRows<{ c: unknown; source_url: unknown }>(
      `corpus_records?select=id,c:item->cells,source_url&dataset=eq.ftc_hsr_early_terminations&title=ilike.${ilikeTerm(word)}&order=ordinal.asc`,
      { max: 20_000 },
    );
    const notices = raw.flatMap((r) => {
      const n = parseNotice(r);
      return n ? [n] : [];
    });
    const rows = matchTransactions(notices, key, companyKey);
    return { ...base, status: rows.length ? "matched" : "no_match", name: own.name, key, rows };
  });
