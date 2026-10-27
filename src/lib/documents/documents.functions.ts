/**
 * documents/1 server functions (read only):
 *  - searchDocuments: full-text search of the stored page text with page-numbered snippets, or a dated browse, filtered by
 *    court, MDL, type and filing date (documents_search_v1; availability is re-checked for every row returned);
 *  - getDocument: one document's metadata, text status, exact links and amounts (documents_document_v1);
 *  - documentsForEntity: the filings of a court, judge, MDL, statute / regulation or decision, with a per-year trend
 *    (documents_for_entity_v1);
 *  - documentsStatus: what the layer holds (documents_status_v1).
 * When the contract SQL has not been applied yet every function answers `available: false` instead of failing.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { TrendBlockData } from "@/lib/analytics/trend";
import { restGet, rpcPostOptional } from "@/lib/external/rest.server";
import {
  DOC_TYPES,
  MAX_PAGE,
  PAGE_SIZE,
  documentsTrend,
  parseDocDetail,
  parseEntityDocs,
  parseSearchResult,
  type DocDetail,
  type DocSearchResult,
  type EntityDocs,
} from "./documents";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .default(null);

export const searchInput = z.object({
  q: z.string().max(300).default(""),
  court: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/)
    .nullable()
    .default(null),
  /** An MDL number, or "none" for filings with no MDL listing. */
  mdl: z
    .string()
    .regex(/^([1-9][0-9]{0,5}|none)$/)
    .nullable()
    .default(null),
  type: z.enum(DOC_TYPES).nullable().default(null),
  from: day,
  to: day,
  sort: z.enum(["relevance", "newest", "oldest"]).nullable().default(null),
  page: z.number().int().min(1).max(MAX_PAGE).default(1),
  limit: z.number().int().min(1).max(50).default(PAGE_SIZE),
});
export type DocumentSearchInput = z.input<typeof searchInput>;

export type Names = Record<string, string>;
export type DocumentSearchPage =
  | { available: false }
  | ({ available: true; page: number; courtNames: Names; mdlNames: Names } & DocSearchResult);

const memo = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.v as T;
  const v = await fn();
  memo.set(key, { at: Date.now(), v });
  if (memo.size > 400) memo.delete(memo.keys().next().value as string);
  return v;
}

/** Published names of court and MDL ids (court directory and the MDL dataset); an id without a record keeps no name. */
async function namesOf(dataset: "court_spine" | "mdls", ids: string[]): Promise<Names> {
  const valid = [...new Set(ids)].filter((id) =>
    dataset === "mdls" ? /^[1-9][0-9]{0,5}$/.test(id) : /^[a-z0-9_-]{1,40}$/.test(id),
  );
  if (!valid.length) return {};
  const out: Names = {};
  const missing: string[] = [];
  for (const id of valid) {
    const hit = memo.get(`name:${dataset}:${id}`);
    if (hit && Date.now() - hit.at < 6 * 3600_000) {
      if (typeof hit.v === "string") out[id] = hit.v;
    } else missing.push(id);
  }
  if (missing.length) {
    try {
      const r = await restGet<{ id: string; title: string | null }[]>(
        `corpus_records?select=id,title&dataset=eq.${dataset}&id=in.(${missing.map((m) => encodeURIComponent(m)).join(",")})&limit=${missing.length}`,
      );
      const got = new Map(r.rows.map((x) => [x.id, x.title]));
      for (const id of missing) {
        const t = got.get(id);
        const name =
          typeof t === "string" && t.trim()
            ? dataset === "court_spine"
              ? t.replace(/^District Court,\s*/i, "").trim()
              : t.trim()
            : null;
        memo.set(`name:${dataset}:${id}`, { at: Date.now(), v: name });
        if (name) out[id] = name;
      }
    } catch (e) {
      console.error("documents names", e);
    }
  }
  return out;
}

export async function runDocumentSearch(
  d: z.infer<typeof searchInput>,
): Promise<DocumentSearchPage> {
  const q = d.q.trim();
  const sort = d.sort === "relevance" && !q ? null : d.sort;
  const raw = await rpcPostOptional<unknown>("documents_search_v1", {
    p_q: q || null,
    p_court: d.court,
    p_mdl: d.mdl,
    p_from: d.from,
    p_to: d.to,
    p_type: d.type,
    p_sort: sort,
    p_limit: d.limit,
    p_offset: (d.page - 1) * d.limit,
  });
  if (raw === null) return { available: false };
  const res = parseSearchResult(raw);
  if (!res) throw new Error("The document search returned an unreadable answer.");
  const [courtNames, mdlNames] = await Promise.all([
    namesOf("court_spine", [
      ...res.facets.court.map((f) => f.key),
      ...res.rows.flatMap((r) => (r.courtId ? [r.courtId] : [])),
      ...(d.court ? [d.court] : []),
    ]),
    namesOf("mdls", [
      ...res.facets.mdl.map((f) => f.key),
      ...res.rows.flatMap((r) => (r.mdl ? [r.mdl] : [])),
      ...(d.mdl && d.mdl !== "none" ? [d.mdl] : []),
    ]),
  ]);
  return { available: true, page: d.page, courtNames, mdlNames, ...res };
}

export const searchDocuments = createServerFn({ method: "GET" })
  .inputValidator((d: DocumentSearchInput) => searchInput.parse(d))
  .handler(async ({ data }): Promise<DocumentSearchPage> => {
    try {
      return await runDocumentSearch(data);
    } catch (e) {
      console.error("documents search", e);
      throw new Error("The document search could not be run.");
    }
  });

export const getDocument = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) =>
    z.object({ id: z.string().regex(/^d_[0-9a-f]{24}$/) }).parse(d),
  )
  .handler(
    async ({
      data,
    }): Promise<{
      available: boolean;
      document: DocDetail | null;
      courtName: string | null;
      mdlName: string | null;
    }> => {
      const raw = await cached(`doc:${data.id}`, 60_000, () =>
        rpcPostOptional<unknown>("documents_document_v1", { p_id: data.id }),
      );
      if (raw === null) return { available: false, document: null, courtName: null, mdlName: null };
      const doc = parseDocDetail(raw);
      if (!doc) return { available: true, document: null, courtName: null, mdlName: null };
      const [courts, mdls] = await Promise.all([
        doc.courtId ? namesOf("court_spine", [doc.courtId]) : Promise.resolve({} as Names),
        doc.mdl ? namesOf("mdls", [doc.mdl]) : Promise.resolve({} as Names),
      ]);
      return {
        available: true,
        document: doc,
        courtName: doc.courtId ? (courts[doc.courtId] ?? null) : null,
        mdlName: doc.mdl ? (mdls[doc.mdl] ?? null) : null,
      };
    },
  );

export const entityInput = z
  .object({
    type: z.enum(["court", "judge", "mdl", "law_unit", "case"]),
    id: z.string().min(1).max(60),
    limit: z.number().int().min(0).max(50).default(8),
  })
  .refine(
    (v) =>
      v.type === "court"
        ? /^[a-z0-9_-]{1,40}$/.test(v.id)
        : v.type === "judge"
          ? /^[0-9a-f]{32}$/.test(v.id)
          : v.type === "mdl"
            ? /^[1-9][0-9]{0,5}$/.test(v.id)
            : v.type === "law_unit"
              ? /^(usc:[0-9]{1,2}a?:[0-9][0-9A-Za-z.-]{0,40}|cfr:[0-9]{1,2}:[0-9]{1,5})$/.test(v.id)
              : /^[1-9][0-9]{0,9}$/.test(v.id),
    { message: "Invalid id for this type" },
  );
export type EntityInput = z.input<typeof entityInput>;
export type EntityDocumentsPage =
  | { available: false }
  | {
      available: true;
      docs: EntityDocs;
      trend: TrendBlockData | null;
      courtNames: Names;
      mdlNames: Names;
    };

export const documentsForEntity = createServerFn({ method: "GET" })
  .inputValidator((d: EntityInput) => entityInput.parse(d))
  .handler(async ({ data }): Promise<EntityDocumentsPage> => {
    const raw = await cached(`entity:${data.type}:${data.id}:${data.limit}`, 5 * 60_000, () =>
      rpcPostOptional<unknown>("documents_for_entity_v1", {
        p_type: data.type,
        p_id: data.id,
        p_limit: data.limit,
      }),
    ).catch((e: unknown) => {
      console.error("documents for entity", e);
      throw new Error("The filings for this page could not be read.");
    });
    if (raw === null) return { available: false };
    const docs = parseEntityDocs(raw);
    if (!docs) throw new Error("The filings for this page could not be read.");
    const [courtNames, mdlNames] = await Promise.all([
      namesOf(
        "court_spine",
        docs.recent.flatMap((r) => (r.courtId ? [r.courtId] : [])),
      ),
      namesOf(
        "mdls",
        docs.recent.flatMap((r) => (r.mdl ? [r.mdl] : [])),
      ),
    ]);
    return {
      available: true,
      docs,
      trend: documentsTrend(docs, new Date().toISOString().slice(0, 10)),
      courtNames,
      mdlNames,
    };
  });

export type DocumentsStatus = {
  available: boolean;
  documents: number;
  pagesIndexed: number;
  mdls: number;
  /** Filings with no MDL listing (documents/2 'docket_case'). */
  withoutMdl: number;
  courts: number;
  byTextStatus: Record<string, number>;
};

export const documentsStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<DocumentsStatus> => {
    const raw = await cached("status", 10 * 60_000, () =>
      rpcPostOptional<unknown>("documents_status_v1", {}),
    );
    const o =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
    if (!o)
      return {
        available: false,
        documents: 0,
        pagesIndexed: 0,
        mdls: 0,
        withoutMdl: 0,
        courts: 0,
        byTextStatus: {},
      };
    const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
    const by: Record<string, number> = {};
    const bt = o["by_text_status"];
    if (bt && typeof bt === "object" && !Array.isArray(bt))
      for (const [k, v] of Object.entries(bt)) if (/^[a-z_]{2,30}$/.test(k)) by[k] = n(v);
    return {
      available: true,
      documents: n(o["documents"]),
      pagesIndexed: n(o["pages_indexed"]),
      mdls: n(o["mdls"]),
      withoutMdl: n(o["without_mdl"]),
      courts: n(o["courts"]),
      byTextStatus: by,
    };
  },
);
