/**
 * Defendant disclosure radar (company_sec_legal_proceedings): reads every held 10-K's Item 3 and litigation notes
 * (verbatim text, about 4.7 MB in all) once per 10 minutes on the server, and returns only the compact radar
 * (counts, first disclosures with a short verbatim excerpt and the accession). See companyDisclosure.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { readAllRows } from "@/lib/analytics/tally.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import { disclosureRadar, type DisclosureRadar, type FilingText } from "./companyDisclosure";

type Raw = { id: unknown; source_url: unknown; f: unknown; t3: unknown; n: unknown; m: unknown };

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export function parseFilingText(r: Raw): FilingText | null {
  const f = obj(r.f);
  const cik = str(f?.["cik"]);
  const accession = str(f?.["accession"]);
  const period = str(f?.["period"]);
  const company = str(f?.["company"]);
  if (
    !cik ||
    !/^\d{10}$/.test(cik) ||
    !accession ||
    !period ||
    !/^\d{4}-\d{2}-\d{2}$/.test(period) ||
    !company
  )
    return null;
  const notes = Array.isArray(r.n)
    ? (r.n as unknown[]).flatMap((x) => {
        const t = str(obj(x)?.["text"]);
        return t ? [t] : [];
      })
    : [];
  const text = [str(r.t3) ?? "", ...notes].join("\n");
  const mdls = Array.isArray(r.m)
    ? (r.m as unknown[]).flatMap((x) => {
        const n = obj(x)?.["mdl_number"];
        return typeof n === "number" && Number.isInteger(n) && n > 0 ? [n] : [];
      })
    : [];
  const filed = str(f?.["filed"]);
  const url = str(f?.["document_url"]) ?? str(r.source_url);
  return {
    cik,
    company,
    accession,
    fy: period.slice(0, 4),
    filed: filed && /^\d{4}-\d{2}-\d{2}$/.test(filed) ? filed : null,
    url: url && url.startsWith("https://www.sec.gov/") ? url : null,
    text,
    mdls,
  };
}

export type DisclosurePayload = DisclosureRadar & { readAt: string };

const read = memoAsync(READ_TTL_MS, async (): Promise<DisclosurePayload> => {
  const rows = await readAllRows<Raw>(
    "corpus_records?select=id,source_url,f:item->filing,t3:item->item3->>text,n:item->notes,m:item->mentions&dataset=eq.company_sec_legal_proceedings&order=ordinal.asc",
    { max: 5_000, concurrency: 2 },
  );
  const filings = rows.flatMap((r) => {
    const p = parseFilingText(r);
    return p ? [p] : [];
  });
  return { ...disclosureRadar(filings), readAt: new Date().toISOString() };
});

export const getDisclosureRadar = createServerFn({ method: "GET" }).handler(
  async (): Promise<DisclosurePayload> =>
    read().catch((e: unknown) => {
      console.error("disclosure radar", e);
      throw new Error("The 10-K disclosure radar could not be read just now.");
    }),
);
