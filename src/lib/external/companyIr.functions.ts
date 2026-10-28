/**
 * Investor-relations data of an SEC registrant from the self-updating sources company_sec_cover_facts and
 * company_ir_kpis (src/lib/ingest/sources/companyIr.ts; contract database/contracts/company-ir-v1.sql). Read-only,
 * validated in src/components/companies/companyIr.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import {
  parseCoverFacts,
  parseIrDocument,
  type CoverFacts,
  type IrDocumentFigures,
} from "@/components/companies/companyIr";

const TTL_MS = 10 * 60 * 1000;
type Cached<T> = Map<string, { at: number; value: T }>;
const coverCache: Cached<CoverFacts | null> = new Map();
const irCache: Cached<IrDocumentFigures[]> = new Map();

async function cached<T>(cache: Cached<T>, key: string, read: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await read();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  return value;
}

const cikInput = (d: unknown) => z.object({ cik: z.string().regex(/^\d{10}$/) }).parse(d);

export const getCompanyCoverFacts = createServerFn({ method: "GET" })
  .inputValidator(cikInput)
  .handler(async ({ data }): Promise<CoverFacts | null> =>
    cached(coverCache, data.cik, async () => {
      const r = await restGet<{ id: string; item: unknown; source_url: string }[]>(
        `corpus_records?select=id,item,source_url&dataset=eq.company_sec_cover_facts&id=eq.cover:${data.cik}&limit=1`,
      );
      const row = r.rows[0];
      return row ? parseCoverFacts(row.id, row.item, row.source_url) : null;
    }),
  );

/** The registrant's IR documents with their figures (document text left out), newest retrieval first. */
export const getCompanyIrFigures = createServerFn({ method: "GET" })
  .inputValidator(cikInput)
  .handler(async ({ data }): Promise<IrDocumentFigures[]> =>
    cached(irCache, data.cik, async () => {
      const r = await restGet<{ id: string; document: unknown; extraction: unknown }[]>(
        `corpus_records?select=id,document:item->document,extraction:item->extraction&dataset=eq.company_ir_kpis&id=like.ir:${data.cik}:*&order=id.asc&limit=200`,
      );
      return r.rows
        .map((row) =>
          parseIrDocument(row.id, { document: row.document, extraction: row.extraction }),
        )
        .filter((d): d is IrDocumentFigures => d !== null)
        .sort((a, b) => b.retrieved.localeCompare(a.retrieved) || a.id.localeCompare(b.id));
    }),
  );
