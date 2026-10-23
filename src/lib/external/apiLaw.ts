/**
 * Wave 1025 api-law datasets in the app: which datasets the generic browser may read, which filters each accepts, and
 * the pure PostgREST path builders and row parsers the server functions use (apiLaw.functions.ts). Exact keys use the
 * GIN-indexed record filters; words use the full-text index; nothing here scans record text.
 */
import { cs, ftsQuery } from "./legislation";

const enc = encodeURIComponent;

export type ApiLawFilter = {
  /** filters.<name> in the record */
  name: string;
  label: string;
  /** accepted values (validated before a request is built) */
  pattern: RegExp;
};

export type ApiLawDataset = {
  id: string;
  label: string;
  /** noun for counts ("documents") */
  noun: string;
  filters: ApiLawFilter[];
  /** an exact record id typed in the search box is looked up directly */
  idPattern: RegExp;
  /** where a record opens (default: the generic record page) */
  recordHref?: (id: string) => string;
  /** the official publisher, shown under the results */
  sourceNote: string;
};

const YEAR = /^(19|20)\d{2}$/;
const SLUG = /^[a-z0-9_+-]{1,40}$/;
const AGENCY = /^[A-Z]{2,10}$/;
const REGS_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,120}$/;

export const API_LAW_DATASETS: Record<string, ApiLawDataset> = {
  regulations_gov_documents: {
    id: "regulations_gov_documents",
    label: "Regulations.gov documents",
    noun: "documents",
    idPattern: /^[A-Z][A-Za-z0-9_-]*-\d{4}-[A-Za-z0-9_-]*\d{4}$/,
    filters: [
      { name: "agency", label: "Agency", pattern: AGENCY },
      { name: "type", label: "Document type", pattern: SLUG },
      { name: "year", label: "Year posted", pattern: YEAR },
      { name: "comments", label: "Comments posted", pattern: SLUG },
      { name: "fr_linked", label: "Federal Register record", pattern: SLUG },
      { name: "docket", label: "Docket", pattern: REGS_ID },
    ],
    sourceNote:
      "Regulations.gov API v4 (eRulemaking Program, General Services Administration). Comment counts are the public submissions an agency has posted on Regulations.gov, which can be fewer than it received.",
  },
  regulations_gov_dockets: {
    id: "regulations_gov_dockets",
    label: "Regulations.gov dockets",
    noun: "dockets",
    idPattern: /^[A-Z][A-Za-z0-9_-]*-\d{4}-[A-Za-z0-9_-]+$/,
    recordHref: (id) => `/law/rulemaking/dockets/${encodeURIComponent(id)}`,
    filters: [
      { name: "agency", label: "Agency", pattern: AGENCY },
      { name: "docket_type", label: "Docket type", pattern: SLUG },
      { name: "id_year", label: "Year in docket ID", pattern: YEAR },
      { name: "comments", label: "Comments posted", pattern: SLUG },
    ],
    sourceNote:
      "Regulations.gov API v4 dockets. Comment counts are the public submissions posted in the docket on Regulations.gov.",
  },
};

export const API_LAW_DATASET_IDS = Object.keys(API_LAW_DATASETS) as [string, ...string[]];

export const HIT_SELECT = "select=id,title,source_url,ordinal,item";

export type SearchSpec = {
  dataset: string;
  q?: string | undefined;
  filters?: Record<string, string | undefined> | undefined;
};

/** The PostgREST path of a search; throws on a dataset or filter value outside the registry. */
export function searchPath(spec: SearchSpec): { path: string; mode: "id" | "words" | "browse" } {
  const ds = API_LAW_DATASETS[spec.dataset];
  if (!ds) throw new Error("Unknown dataset");
  const contain: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(spec.filters ?? {})) {
    if (value === undefined || value === "") continue;
    const f = ds.filters.find((x) => x.name === name);
    if (!f || !f.pattern.test(value)) throw new Error(`Filter ${name} does not accept that value`);
    contain[name] = [value];
  }
  const parts = [HIT_SELECT, `dataset=eq.${ds.id}`];
  const q = (spec.q ?? "").trim().slice(0, 200);
  let mode: "id" | "words" | "browse" = "browse";
  if (q && ds.idPattern.test(q)) {
    parts.push(`id=eq.${enc(q)}`);
    mode = "id";
  } else if (q) {
    const fts = ftsQuery(q);
    if (fts) {
      parts.push(`search_vector=fts(simple).${enc(fts)}`);
      mode = "words";
    }
  }
  if (Object.keys(contain).length) parts.push(`filters=cs.${cs(contain)}`);
  parts.push("order=ordinal.asc");
  return { path: `corpus_records?${parts.join("&")}`, mode };
}

export type ApiLawHit = {
  id: string;
  title: string;
  subtitle: string;
  sourceUrl: string | null;
  cells: Record<string, string>;
  badges: string[];
};

const str = (v: unknown, max = 2000): string | null =>
  typeof v === "string" && v.length <= max ? v : null;

export function parseHit(row: unknown): ApiLawHit | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const item = (r["item"] && typeof r["item"] === "object" ? r["item"] : {}) as Record<string, unknown>;
  const id = str(r["id"], 200);
  const title = str(r["title"], 4000);
  if (!id || !title) return null;
  const cells: Record<string, string> = {};
  const rawCells = item["cells"];
  if (rawCells && typeof rawCells === "object")
    for (const [k, v] of Object.entries(rawCells as Record<string, unknown>))
      if (typeof v === "string" || typeof v === "number") cells[k] = String(v);
  return {
    id,
    title,
    subtitle: str(item["subtitle"], 600) ?? "",
    sourceUrl: str(r["source_url"], 600),
    cells,
    badges: Array.isArray(item["badges"])
      ? (item["badges"] as unknown[]).filter((b): b is string => typeof b === "string").slice(0, 4)
      : [],
  };
}

export type FacetOption = { value: string; label: string; count: number | null };
export type FacetDef = { name: string; label: string; options: FacetOption[] };

/** The select filters of a catalog listing (only the registry's filter names). */
export function parseFacets(dataset: string, listing: unknown): FacetDef[] {
  const ds = API_LAW_DATASETS[dataset];
  if (!ds || !listing || typeof listing !== "object") return [];
  const filters = (listing as { filters?: unknown }).filters;
  if (!Array.isArray(filters)) return [];
  const out: FacetDef[] = [];
  for (const f of filters as Record<string, unknown>[]) {
    const def = ds.filters.find((x) => x.name === f["name"]);
    if (!def || !Array.isArray(f["options"])) continue;
    out.push({
      name: def.name,
      label: typeof f["label"] === "string" ? (f["label"] as string) : def.label,
      options: (f["options"] as Record<string, unknown>[])
        .filter((o) => typeof o["value"] === "string" && def.pattern.test(o["value"] as string))
        .map((o) => ({
          value: o["value"] as string,
          label: typeof o["label"] === "string" ? (o["label"] as string) : (o["value"] as string),
          count: typeof o["count"] === "number" ? (o["count"] as number) : null,
        })),
    });
  }
  return out;
}

export const recordHref = (dataset: string, id: string) =>
  API_LAW_DATASETS[dataset]?.recordHref?.(id) ?? `/records/${dataset}/${encodeURIComponent(id)}`;
