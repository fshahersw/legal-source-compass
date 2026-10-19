/**
 * Financial statements, segments and investor documents of an SEC registrant (datasets company_sec_statements,
 * company_sec_segments, company_sec_ir_documents; scripts/enrichment/sec/build_company_statements.py and
 * build_company_ir.py). Values are the registrant's own XBRL facts and filing exhibits on sec.gov. Stored JSON is
 * validated defensively in companyStatements.ts: malformed rows are dropped, unknown values stay "Not recorded".
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import {
  IR_ID,
  parseIrDocument,
  parseSegmentsProfile,
  parseStatementsProfile,
  type IrDocument,
  type SegmentsProfile,
  type StatementsProfile,
} from "@/components/companies/companyStatements";

const TTL_MS = 10 * 60 * 1000;
const CIK = /^\d{10}$/;
type Cached<T> = Map<string, { at: number; value: T }>;
const statementsCache: Cached<StatementsProfile | null> = new Map();
const segmentsCache: Cached<SegmentsProfile | null> = new Map();
const documentsCache: Cached<IrDocument[]> = new Map();

async function cached<T>(cache: Cached<T>, key: string, read: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await read();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  return value;
}

const cikInput = (d: unknown) => z.object({ cik: z.string().regex(CIK) }).parse(d);

export const getCompanyStatements = createServerFn({ method: "GET" })
  .inputValidator(cikInput)
  .handler(async ({ data }): Promise<StatementsProfile | null> =>
    cached(statementsCache, data.cik, async () => {
      const r = await restGet<{ profile: unknown }[]>(
        `corpus_records?select=profile:item->profile&dataset=eq.company_sec_statements&id=eq.${data.cik}&limit=1`,
      );
      return parseStatementsProfile(r.rows[0]?.profile);
    }),
  );

export const getCompanySegments = createServerFn({ method: "GET" })
  .inputValidator(cikInput)
  .handler(async ({ data }): Promise<SegmentsProfile | null> =>
    cached(segmentsCache, data.cik, async () => {
      const r = await restGet<{ profile: unknown }[]>(
        `corpus_records?select=profile:item->profile&dataset=eq.company_sec_segments&id=eq.${data.cik}&limit=1`,
      );
      return parseSegmentsProfile(r.rows[0]?.profile);
    }),
  );

/** The registrant's indexed 8-K exhibits (Items 2.02 and 7.01), newest first, without their text. */
export const getCompanyDocuments = createServerFn({ method: "GET" })
  .inputValidator(cikInput)
  .handler(async ({ data }): Promise<IrDocument[]> =>
    cached(documentsCache, data.cik, async () => {
      const r = await restGet<{ id: string; profile: unknown }[]>(
        `corpus_records?select=id,profile:item->profile&dataset=eq.company_sec_ir_documents&id=like.${data.cik}:*&order=id.desc&limit=300`,
      );
      return r.rows
        .map((row) => parseIrDocument(row.id, row.profile))
        .filter((d): d is IrDocument => d !== null && d.cik === data.cik)
        .sort((a, b) => b.date.localeCompare(a.date) || a.exhibit.localeCompare(b.exhibit));
    }),
  );

export type DocumentText = { id: string; text: string };

/** One exhibit's extracted text (as stored, up to 60,000 characters). */
export const getDocumentText = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(IR_ID) }).parse(d))
  .handler(async ({ data }): Promise<DocumentText | null> => {
    const r = await restGet<{ id: string; text: unknown }[]>(
      `corpus_records?select=id,text:item->document_text&dataset=eq.company_sec_ir_documents&id=eq.${encodeURIComponent(data.id)}&limit=1`,
    );
    const row = r.rows[0];
    return row && typeof row.text === "string" ? { id: row.id, text: row.text } : null;
  });
