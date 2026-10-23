/**
 * citations/2 server functions (read only; database/contracts/citations-v2.sql):
 *  - getCitationMap: the citation map of one MDL's filings for the citation-map view (citations_map_v2): the most-cited
 *    authority nodes and the filings citing the most of them, as nodes + links (shape: CitationMap in ./graph.ts);
 *  - getDocumentCitations: every authority one filing cites or mentions, with counts, pages, pins and resolution
 *    (citations_document_v2);
 *  - getCitedBy / getAuthorityProfile: the filings citing an authority, by MDL, court and year, its co-cited authorities
 *    (citations_cited_by_v2, citations_authority_v2);
 *  - getTopAuthorities / getCoCitations: most-cited authorities and co-citation pairs of an MDL or the whole layer;
 *  - getCitationStatus: what the layer holds (citations_status_v2).
 * When the contract SQL has not been applied yet every function answers `available: false` instead of failing.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { rpcPostOptional } from "@/lib/external/rest.server";
import {
  AUTHORITY_KINDS,
  parseAuthorityProfile,
  parseCitationMap,
  parseCitedBy,
  parseCoCitations,
  parseDocumentCitations,
  parseTopAuthorities,
  type AuthorityProfile,
  type CitationMap,
  type CitedBy,
  type CoCitations,
  type DocumentCitations,
  type TopAuthorities,
} from "./graph";

export type Answer<T> = { available: false } | { available: true; value: T | null };

const memo = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.v as T;
  const v = await fn();
  memo.set(key, { at: Date.now(), v });
  if (memo.size > 300) memo.delete(memo.keys().next().value as string);
  return v;
}

/** Whether the contract is applied (a null answer is then "nothing for this input", not "not available"). */
let appliedAt = 0;
async function contractApplied(): Promise<boolean> {
  if (Date.now() - appliedAt < 10 * 60_000) return true; // only "applied" is remembered: a fresh apply shows at once
  const ok = (await rpcPostOptional<unknown>("citations_status_v2", {})) !== null;
  if (ok) appliedAt = Date.now();
  return ok;
}

async function answer<T>(fn: string, args: Record<string, unknown>, parse: (v: unknown) => T | null, ttl = 5 * 60_000): Promise<Answer<T>> {
  const raw = await cached(`${fn}:${JSON.stringify(args)}`, ttl, () => rpcPostOptional<unknown>(fn, args));
  if (raw === null) return (await contractApplied()) ? { available: true, value: null } : { available: false };
  return { available: true, value: parse(raw) };
}

const mdl = z.string().regex(/^[1-9][0-9]{0,5}$/);
const key = z.string().min(5).max(200).regex(/^[a-z][a-z-]{0,12}:\S/);
const dataset = z.string().regex(/^[a-z0-9_]{1,80}$/);
const recordId = z.string().min(1).max(120);
const kind = z.enum(AUTHORITY_KINDS);
const target = z
  .object({ key: key.nullable().default(null), dataset: dataset.nullable().default(null), id: recordId.nullable().default(null) })
  .refine((v) => (v.key !== null) !== (v.dataset !== null && v.id !== null), "name a key, or a dataset and a record id");

export const mapInput = z.object({
  mdl,
  kinds: z.array(kind).max(13).nullable().default(null),
  authorities: z.number().int().min(5).max(150).default(40),
  documents: z.number().int().min(5).max(300).default(60),
});
export const getCitationMap = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof mapInput>) => mapInput.parse(d))
  .handler(
    async ({ data }): Promise<Answer<CitationMap>> =>
      answer("citations_map_v2", { p_mdl: data.mdl, p_kinds: data.kinds, p_authorities: data.authorities, p_documents: data.documents },
        parseCitationMap),
  );

export const getDocumentCitations = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().regex(/^d_[0-9a-f]{24}$/) }).parse(d))
  .handler(
    async ({ data }): Promise<Answer<DocumentCitations>> =>
      answer("citations_document_v2", { p_document_id: data.id, p_limit: 300 }, parseDocumentCitations, 60_000),
  );

export const citedByInput = target.and(z.object({ page: z.number().int().min(1).max(100).default(1), limit: z.number().int().min(1).max(50).default(25) }));
export const getCitedBy = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof citedByInput>) => citedByInput.parse(d))
  .handler(
    async ({ data }): Promise<Answer<CitedBy>> =>
      answer("citations_cited_by_v2", { p_key: data.key, p_dataset: data.dataset, p_id: data.id, p_limit: data.limit,
        p_offset: (data.page - 1) * data.limit }, parseCitedBy),
  );

export const getAuthorityProfile = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof target>) => target.parse(d))
  .handler(
    async ({ data }): Promise<Answer<AuthorityProfile>> =>
      answer("citations_authority_v2", { p_key: data.key, p_dataset: data.dataset, p_id: data.id }, parseAuthorityProfile),
  );

export const topInput = z.object({ mdl: mdl.nullable().default(null), kind: kind.nullable().default(null), limit: z.number().int().min(1).max(100).default(25) });
export const getTopAuthorities = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof topInput>) => topInput.parse(d))
  .handler(
    async ({ data }): Promise<Answer<TopAuthorities>> =>
      answer("citations_top_authorities_v2", { p_mdl: data.mdl, p_kind: data.kind, p_limit: data.limit }, parseTopAuthorities, 30 * 60_000),
  );

export const coInput = z
  .object({ key: key.nullable().default(null), mdl: mdl.nullable().default(null), limit: z.number().int().min(1).max(100).default(25),
    min: z.number().int().min(1).max(100).default(2) })
  .refine((v) => (v.key === null) !== (v.mdl === null), "name a key or an MDL");
export const getCoCitations = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof coInput>) => coInput.parse(d))
  .handler(
    async ({ data }): Promise<Answer<CoCitations>> =>
      answer("citations_cocitations_v2", { p_key: data.key, p_mdl: data.mdl, p_limit: data.limit, p_min: data.min, p_top: 60 },
        parseCoCitations, 30 * 60_000),
  );

export const getCitationStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<Answer<Record<string, unknown>>> =>
    answer("citations_status_v2", {}, (v) => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null), 10 * 60_000),
);
