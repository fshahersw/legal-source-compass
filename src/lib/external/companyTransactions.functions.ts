/**
 * Corporate transactions of a profiled company from FTC HSR early termination notices, exact-key only (see
 * companyTransactions.ts). The candidate read narrows the 28k notices with an ilike on the key's longest word that is
 * not a stop word ("&" is "and" in the key but "&" in titles); the exact key then decides every match. A name with no
 * such word, or whose word matches more than CANDIDATE_CAP titles, is reported as "too_broad", not as no match.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ilikeTerm, restGet } from "./rest.server";
import { countRows, readAllRows } from "@/lib/analytics/tally.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import { companyKey } from "./regulatoryRecords.functions";
import { parseHsrSeries } from "./ftcData";
import {
  fillYears,
  matchTransactions,
  narrowingWord,
  parseNotice,
  suspensionYears,
  uniqueKey,
  type CompanyTransaction,
} from "./companyTransactions";

export type CompanyTransactionsPayload = {
  status: "matched" | "no_match" | "shared_key" | "no_profile" | "too_broad";
  name: string | null;
  key: string | null;
  rows: CompanyTransaction[];
  /** Calendar years in which early-termination grants collapsed (policy suspension), from the FTC series. */
  suspended: number[];
  calendar: { year: number; count: number }[];
  firstDate: string | null;
  lastDate: string | null;
};

/** At most this many candidate notices are read for one company. */
const CANDIDATE_CAP = 20_000;

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
    const calendar = fillYears(series?.calendar ?? []);
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
    const word = narrowingWord(key);
    if (!word) return { ...base, status: "too_broad", name: own.name, key };
    const path = `corpus_records?select=id,c:item->cells,source_url&dataset=eq.ftc_hsr_early_terminations&title=ilike.${ilikeTerm(word)}&order=ordinal.asc`;
    // a word too common to narrow the read is reported as such, not thrown as an error
    const candidates = await countRows(
      `corpus_records?dataset=eq.ftc_hsr_early_terminations&title=ilike.${ilikeTerm(word)}`,
    );
    if (candidates > CANDIDATE_CAP) return { ...base, status: "too_broad", name: own.name, key };
    const raw = await readAllRows<{ c: unknown; source_url: unknown }>(path, {
      max: CANDIDATE_CAP,
    });
    const notices = raw.flatMap((r) => {
      const n = parseNotice(r);
      return n ? [n] : [];
    });
    const rows = matchTransactions(notices, key, companyKey);
    return { ...base, status: rows.length ? "matched" : "no_match", name: own.name, key, rows };
  });

/** The FTC early-termination series by calendar year with its suspension years (merger review annotation). */
export const getHsrSuspension = createServerFn({ method: "GET" }).handler(async () => {
  const series = await hsrSeries();
  // years with no notice (2022, 2023) are absent from the series: filled with 0 so they are shown and counted
  const calendar = fillYears(series?.calendar ?? []);
  return { calendar, suspended: suspensionYears(calendar) };
});
