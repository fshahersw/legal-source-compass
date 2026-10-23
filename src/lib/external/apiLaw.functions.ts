/**
 * Server functions for the wave 1025 api-law datasets (read-only corpus reads through restGet / rpcPostOptional):
 * a generic search and facet reader limited to the datasets in apiLaw.ts, the Regulations.gov overview RPC and the docket
 * page (the docket and every document that names it). Keys never leave the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  API_LAW_DATASETS,
  API_LAW_DATASET_IDS,
  HIT_SELECT,
  parseFacets,
  parseHit,
  searchPath,
  type ApiLawHit,
  type FacetDef,
} from "./apiLaw";
import { restGet, rpcPostOptional } from "./rest.server";

export const API_LAW_PAGE_SIZE = 25;
const MAX_PAGE = 200;

const searchInput = z.object({
  dataset: z.enum(API_LAW_DATASET_IDS),
  q: z.string().max(200).default(""),
  filters: z.record(z.string().regex(/^[a-z_]{1,30}$/), z.string().max(200)).default({}),
  page: z.number().int().min(1).max(MAX_PAGE).default(1),
});
export type ApiLawSearchInput = z.input<typeof searchInput>;
export type ApiLawSearchResult = {
  dataset: string;
  mode: string;
  rows: ApiLawHit[];
  total: number | null;
  page: number;
  pageSize: number;
  dropped: number;
};

export async function runApiLawSearch(input: ApiLawSearchInput): Promise<ApiLawSearchResult> {
  const d = searchInput.parse(input);
  const { path, mode } = searchPath({ dataset: d.dataset, q: d.q, filters: d.filters });
  const start = (d.page - 1) * API_LAW_PAGE_SIZE;
  const r = await restGet<unknown[]>(path, {
    count: true,
    range: [start, start + API_LAW_PAGE_SIZE - 1],
  });
  const rows = r.rows.map(parseHit).filter((x): x is ApiLawHit => !!x);
  return {
    dataset: d.dataset,
    mode,
    rows,
    total: r.total,
    page: d.page,
    pageSize: API_LAW_PAGE_SIZE,
    dropped: r.rows.length - rows.length,
  };
}

export const searchApiLaw = createServerFn({ method: "GET" })
  .inputValidator((d: ApiLawSearchInput) => searchInput.parse(d))
  .handler(async ({ data }): Promise<ApiLawSearchResult> => runApiLawSearch(data));

export type ApiLawFacets = {
  ready: boolean | null;
  records: number | null;
  facets: FacetDef[];
  source: string | null;
  builtAt: string | null;
  scope: string | null;
  updatedAt: string | null;
} | null;

const datasetInput = z.object({ dataset: z.enum(API_LAW_DATASET_IDS) });

/** Catalog facts and filter options of a dataset; null when it is not published. */
export const getApiLawFacets = createServerFn({ method: "GET" })
  .inputValidator((d: { dataset: string }) => datasetInput.parse(d))
  .handler(async ({ data }): Promise<ApiLawFacets> => {
    const r = await restGet<Record<string, unknown>[]>(
      `corpus_datasets?select=ready,imported_records,updated_at,listing:metadata->listing,summary:metadata->summary&id=eq.${data.dataset}&limit=1`,
    );
    const row = r.rows[0];
    if (!row) return null;
    const summary = (
      row["summary"] && typeof row["summary"] === "object" ? row["summary"] : {}
    ) as Record<string, unknown>;
    const s = (v: unknown, max = 600) => (typeof v === "string" && v.length <= max ? v : null);
    return {
      ready: typeof row["ready"] === "boolean" ? (row["ready"] as boolean) : null,
      records:
        typeof row["imported_records"] === "number" ? (row["imported_records"] as number) : null,
      facets: parseFacets(data.dataset, row["listing"]),
      source: s(summary["source"]),
      builtAt: s(summary["built_at"], 40),
      scope: s(summary["scope"], 1000),
      updatedAt: s(row["updated_at"], 40),
    };
  });

/* ---------------------------------------------------------------- Regulations.gov */

export type RegsAgencyRow = {
  agency: string;
  rules: number;
  proposed_rules: number;
  notices: number;
  dockets: number | null;
  rulemaking_dockets: number | null;
  open_documents: number;
  proposed_rules_counted: number;
  comments_on_proposed_rules: number | null;
};
export type RegsOpenDoc = {
  id: string;
  title: string;
  agency: string;
  type: string;
  comment_end: string;
  docket: string | null;
  posted: number | null;
};
export type RegsTopDocket = {
  id: string;
  title: string;
  agency: string;
  posted: number;
  docket_type: string | null;
};
export type RegsYearRow = { year: string; type: string; n: number };
export type RegsOverview = {
  as_of: string;
  agencies: RegsAgencyRow[];
  open_for_comment: RegsOpenDoc[];
  most_commented_dockets: RegsTopDocket[];
  by_year: RegsYearRow[];
} | null;

/** api_law_regs_overview_v1 (database/contracts/api-law-v1.sql); null until that contract is applied. */
export const getRegsOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<RegsOverview> => {
    const r = await rpcPostOptional<RegsOverview>("api_law_regs_overview_v1", {});
    return r && typeof r === "object" && Array.isArray((r as { agencies?: unknown }).agencies)
      ? r
      : null;
  },
);

const docketInput = z.object({ docketId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{2,120}$/) });

export type RegsDocketPage = {
  docket:
    (ApiLawHit & { facts: [string, string][]; links: { url: string; label: string }[] }) | null;
  documents: ApiLawHit[];
  documentsTotal: number | null;
} | null;

/** A docket and the documents that name it (newest first, at most 200). */
export const getRegsDocket = createServerFn({ method: "GET" })
  .inputValidator((d: { docketId: string }) => docketInput.parse(d))
  .handler(async ({ data }): Promise<RegsDocketPage> => {
    const id = encodeURIComponent(data.docketId);
    const [dk, docs] = await Promise.all([
      restGet<Record<string, unknown>[]>(
        `corpus_records?select=id,title,source_url,item,detail&dataset=eq.regulations_gov_dockets&id=eq.${id}&limit=1`,
      ),
      restGet<unknown[]>(
        `corpus_records?${HIT_SELECT}&dataset=eq.regulations_gov_documents&filters=cs.${encodeURIComponent(JSON.stringify({ docket: [data.docketId] }))}&order=ordinal.asc`,
        { count: true, range: [0, 199] },
      ),
    ]);
    const raw = dk.rows[0];
    const hit = raw ? parseHit(raw) : null;
    const detail = (
      raw?.["detail"] && typeof raw["detail"] === "object" ? raw["detail"] : {}
    ) as Record<string, unknown>;
    const facts = Array.isArray(detail["facts"])
      ? (detail["facts"] as unknown[])
          .filter(
            (f): f is [string, string] =>
              Array.isArray(f) && typeof f[0] === "string" && typeof f[1] === "string",
          )
          .map(([a, b]) => [a, b] as [string, string])
      : [];
    const links = Array.isArray(detail["links"])
      ? (detail["links"] as Record<string, unknown>[])
          .filter((l) => typeof l["url"] === "string" && typeof l["label"] === "string")
          .map((l) => ({ url: l["url"] as string, label: l["label"] as string }))
      : [];
    const documents = docs.rows.map(parseHit).filter((x): x is ApiLawHit => !!x);
    if (!hit && !documents.length) return null;
    return { docket: hit ? { ...hit, facts, links } : null, documents, documentsTotal: docs.total };
  });

export const API_LAW_SOURCES = Object.fromEntries(
  Object.values(API_LAW_DATASETS).map((d) => [d.id, d.sourceNote]),
) as Record<string, string>;

/* ---------------------------------------------------------------- bill text versions (GovInfo) */

export type BillVersionLink = {
  code: string;
  label: string;
  date: string | null;
  packageId: string;
  details: string;
  pdf: string;
  html: string;
  xml: string;
};
export type BillVersions = { id: string; versions: BillVersionLink[] } | null;

const billIdInput = z.object({
  billId: z.string().regex(/^\d{2,3}-(hr|s|hjres|sjres|hconres|sconres|hres|sres)-\d{1,5}$/),
});

/** The GovInfo text versions of one bill (govinfo_bill_versions; same id as congress_bills). */
export const getBillVersions = createServerFn({ method: "GET" })
  .inputValidator((d: { billId: string }) => billIdInput.parse(d))
  .handler(async ({ data }): Promise<BillVersions> => {
    const r = await restGet<{ id: string; versions: unknown }[]>(
      `corpus_records?select=id,versions:item->versions&dataset=eq.govinfo_bill_versions&id=eq.${encodeURIComponent(data.billId)}&limit=1`,
    );
    const row = r.rows[0];
    if (!row || !Array.isArray(row.versions)) return null;
    const ok = (u: unknown) => typeof u === "string" && /^https:\/\/www\.govinfo\.gov\//.test(u);
    const versions = (row.versions as Record<string, unknown>[])
      .filter((v) => typeof v["packageId"] === "string" && ok(v["details"]) && ok(v["pdf"]))
      .map((v) => ({
        code: String(v["code"] ?? ""),
        label: String(v["label"] ?? v["code"] ?? ""),
        date: typeof v["date"] === "string" ? (v["date"] as string) : null,
        packageId: String(v["packageId"]),
        details: String(v["details"]),
        pdf: String(v["pdf"]),
        html: String(v["html"]),
        xml: String(v["xml"]),
      }));
    return { id: row.id, versions };
  });

/* ---------------------------------------------------------------- 10-K legal proceedings (EDGAR) */

export type LegalSection = {
  heading: string;
  chars: number;
  truncated: boolean;
  start: number;
  end: number;
  label: string;
};
export type LegalFiling = {
  id: string;
  form: string;
  filed: string;
  period: string | null;
  accession: string;
  documentUrl: string;
  indexUrl: string;
  sections: LegalSection[];
  mentions: {
    as_written: string;
    mdl_number: number;
    section: string;
    form: string;
    held_mdl: boolean;
  }[];
};

const cikInput = z.object({ cik: z.string().regex(/^\d{10}$/) });

export function parseLegalFiling(r: Record<string, unknown>): LegalFiling | null {
  const f = (r["filing"] ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  if (typeof r["id"] !== "string" || !s(f["document_url"]) || !s(f["accession"])) return null;
  const section = (x: unknown, label: string): LegalSection | null => {
    const o = (x ?? null) as Record<string, unknown> | null;
    if (!o || typeof o["heading"] !== "string") return null;
    return {
      label,
      heading: o["heading"] as string,
      chars: Number(o["chars"] ?? 0),
      truncated: o["truncated"] === true,
      start: Number(o["start"] ?? 0),
      end: Number(o["end"] ?? 0),
    };
  };
  // item.sections lists the sections without their texts; item3 / notes are the fallback for a row built before it
  const listed = Array.isArray(r["sections"])
    ? (r["sections"] as Record<string, unknown>[]).map((x) =>
        typeof x["label"] === "string" && /^(Item 3|Note [0-9A-Za-z]{1,4})$/.test(x["label"])
          ? section(x, x["label"])
          : null,
      )
    : null;
  const sections = (
    listed ?? [
      section(r["item3"], "Item 3"),
      ...(Array.isArray(r["notes"]) ? (r["notes"] as unknown[]) : []).map((n) =>
        section(n, `Note ${String(((n ?? {}) as Record<string, unknown>)["number"] ?? "")}`),
      ),
    ]
  ).filter((x): x is LegalSection => Boolean(x));
  return {
    id: r["id"] as string,
    form: s(f["form"]) ?? "10-K",
    filed: s(f["filed"]) ?? "",
    period: s(f["period"]),
    accession: s(f["accession"])!,
    documentUrl: s(f["document_url"])!,
    indexUrl: s(f["index_url"]) ?? s(f["document_url"])!,
    sections,
    mentions: (Array.isArray(r["mentions"])
      ? (r["mentions"] as Record<string, unknown>[])
      : []
    ).map((m) => ({
      as_written: String(m["as_written"] ?? ""),
      mdl_number: Number(m["mdl_number"] ?? 0),
      section: String(m["section"] ?? ""),
      form: String(m["form"] ?? ""),
      held_mdl: m["held_mdl"] === true,
    })),
  };
}

/** A company's 10-K legal-proceedings records (newest first), without the section texts; null when not published. */
export const getCompanyLegalProceedings = createServerFn({ method: "GET" })
  .inputValidator((d: { cik: string }) => cikInput.parse(d))
  .handler(async ({ data }): Promise<LegalFiling[] | null> => {
    const [cat, r] = await Promise.all([
      restGet<{ id: string }[]>(
        `corpus_datasets?select=id&id=eq.company_sec_legal_proceedings&limit=1`,
      ),
      restGet<Record<string, unknown>[]>(
        `corpus_records?select=id,filing:item->filing,sections:item->sections,mentions:item->mentions&dataset=eq.company_sec_legal_proceedings&filters=cs.${encodeURIComponent(JSON.stringify({ cik: [data.cik] }))}&order=ordinal.asc&limit=10`,
      ),
    ]);
    if (!cat.rows.length) return null;
    return r.rows
      .map((row) => parseLegalFiling(row))
      .filter((x): x is LegalFiling => Boolean(x))
      .sort((a, b) => (a.filed !== b.filed ? (a.filed < b.filed ? 1 : -1) : a.id < b.id ? 1 : -1));
  });

const legalTextInput = z.object({
  id: z.string().regex(/^10k:\d{10}:\d{10}-\d{2}-\d{6}$/),
  section: z.string().regex(/^(Item 3|Note [0-9A-Za-z]{1,4})$/),
});

/** The verbatim text of one extracted section of a 10-K record. */
export const getLegalProceedingsText = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string; section: string }) => legalTextInput.parse(d))
  .handler(async ({ data }): Promise<{ text: string; truncated: boolean } | null> => {
    const part = data.section === "Item 3" ? "item3:item->item3" : "notes:item->notes";
    const r = await restGet<Record<string, unknown>[]>(
      `corpus_records?select=${part}&dataset=eq.company_sec_legal_proceedings&id=eq.${encodeURIComponent(data.id)}&limit=1`,
    );
    const row = r.rows[0];
    if (!row) return null;
    const pick =
      data.section === "Item 3"
        ? (row["item3"] as Record<string, unknown> | null)
        : ((Array.isArray(row["notes"]) ? (row["notes"] as Record<string, unknown>[]) : []).find(
            (n) => `Note ${String(n["number"])}` === data.section,
          ) ?? null);
    return pick && typeof pick["text"] === "string"
      ? { text: pick["text"] as string, truncated: pick["truncated"] === true }
      : null;
  });
