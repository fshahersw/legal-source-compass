/**
 * The semantic index, client-safe part: dataset registry, wording, and strict parsers for what the database functions return.
 *
 * The index finds passages of statutes, regulations, opinions, reports and bills by meaning, and suggests related records. A
 * semantic match is a retrieval aid only: never a citation, never proof that a provision says what a hit suggests, and never a
 * link between people, companies or courts (those link on exact keys). Nothing here names the embedding provider.
 */
export const SEMANTIC_INDEX_VERSION = "si-1";
export const EMBEDDING_DIMENSIONS = 1024;
export const SEMANTIC_NOTE_SHORT = "Semantic match, not a citation";
export const SEMANTIC_NOTE = `${SEMANTIC_NOTE_SHORT}. Open the source to check the wording.`;
export const MAX_QUERY_CHARS = 400;

export const SEMANTIC_DATASETS = [
  { id: "us_code_sections", label: "U.S. Code", noun: "section" },
  { id: "ecfr_sections_full", label: "Federal regulations", noun: "section" },
  { id: "caselaw_scotus", label: "Supreme Court opinions", noun: "opinion" },
  { id: "congress_bills", label: "Federal bills", noun: "bill" },
  { id: "crs_reports", label: "CRS reports", noun: "report" },
  { id: "oversight_reports", label: "Inspector General reports", noun: "report" },
  { id: "doj_oig_reports", label: "DOJ Inspector General reports", noun: "report" },
  { id: "ftc_publications_index", label: "FTC reports", noun: "report" },
] as const;

export type SemanticDatasetId = (typeof SEMANTIC_DATASETS)[number]["id"];
export const SEMANTIC_DATASET_IDS = SEMANTIC_DATASETS.map((d) => d.id) as [
  SemanticDatasetId,
  ...SemanticDatasetId[],
];

export function isSemanticDataset(id: unknown): id is SemanticDatasetId {
  return typeof id === "string" && SEMANTIC_DATASETS.some((d) => d.id === id);
}

export function datasetLabel(id: string): string {
  return SEMANTIC_DATASETS.find((d) => d.id === id)?.label ?? id;
}

/** The query the way it is embedded and cached: control characters removed, whitespace collapsed, bounded. */
export function normalizeQuery(q: unknown): string {
  if (typeof q !== "string") return "";
  return q
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_CHARS);
}

export function clampInt(v: unknown, lo: number, hi: number, d: number): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.min(hi, Math.max(lo, Math.trunc(v)))
    : d;
}

/** pgvector text form of an embedding ("[0.1,0.2,...]"); refuses anything but exactly 1024 finite numbers. */
export function toVectorLiteral(v: unknown): string {
  if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS)
    throw new Error("The embedding does not have the expected length.");
  const parts: string[] = [];
  for (const x of v) {
    if (typeof x !== "number" || !Number.isFinite(x))
      throw new Error("The embedding contains a value that is not a number.");
    parts.push(String(Number(x.toPrecision(6))));
  }
  return `[${parts.join(",")}]`;
}

/** In-app pages the index links to (the shapes the builders write); anything else is dropped. */
const INTERNAL_HREF =
  /^\/(?:law\/uscode\/[^/\s?#]+\/[^/\s?#]+|law\/cfr\/[^/\s?#]+\/[^/\s?#]+|cases\/\d{1,12}|law\/legislation\/federal\/\d{1,3}\/[a-z]{1,8}\/\d{1,6}|records\/[a-z][a-z0-9_]{1,80}\/[^/\s?#]{1,200})$/;

export function safeInternalHref(v: unknown): string | null {
  return typeof v === "string" && v.length <= 400 && INTERNAL_HREF.test(v) ? v : null;
}

export function safeSourceUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 600 || !/^https?:\/\/[^\s]+$/i.test(v)) return null;
  return v;
}

export type SemanticHit = {
  /** 1 is the closest in meaning. The score itself is not shown: a rank is not a percentage and not a probability. */
  rank: number;
  dataset: string;
  datasetLabel: string;
  recordId: string;
  title: string;
  /** In-app page of the record. */
  href: string;
  sourceUrl: string | null;
  snippet: string;
  passage: { number: number; of: number };
};

/** "passage 2 of 8" for a record with several passages; null when the record is a single passage. */
export function passageLabel(h: Pick<SemanticHit, "passage">): string | null {
  return h.passage.of > 1 ? `passage ${h.passage.number} of ${h.passage.of}` : null;
}

const str = (v: unknown, n: number): string => (typeof v === "string" ? v.slice(0, n) : "");
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const posInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

export function parseHit(raw: unknown): SemanticHit | null {
  if (!isObj(raw)) return null;
  const dataset = str(raw["dataset"], 80);
  const recordId = str(raw["record_id"], 300);
  const title = str(raw["title"], 300).trim();
  const href = safeInternalHref(raw["href"]);
  const no = posInt(raw["chunk_no"]);
  const total = posInt(raw["chunk_total"]);
  const rank = posInt(raw["rank"]);
  if (!dataset || !recordId || !title || !href || no === null || total === null || !rank)
    return null;
  return {
    rank,
    dataset,
    datasetLabel: datasetLabel(dataset),
    recordId,
    title,
    href,
    sourceUrl: safeSourceUrl(raw["source_url"]),
    snippet: str(raw["snippet"], 400).trim(),
    passage: { number: no + 1, of: Math.max(total, no + 1) },
  };
}

export type SemanticPayload = {
  indexVersion: string | null;
  indexed: boolean;
  hits: SemanticHit[];
};

/** semantic_search_v1 and semantic_related_v1 results. Malformed rows are dropped; a malformed envelope is null. */
export function parsePayload(raw: unknown): SemanticPayload | null {
  if (!isObj(raw) || !Array.isArray(raw["results"])) return null;
  const version = typeof raw["index_version"] === "string" ? raw["index_version"] : null;
  const hits: SemanticHit[] = [];
  const seen = new Set<string>();
  for (const r of raw["results"]) {
    const h = parseHit(r);
    if (!h) continue;
    const key = `${h.dataset}/${h.recordId}`;
    if (seen.has(key)) continue; // one entry per record
    seen.add(key);
    hits.push(h);
  }
  hits.sort((a, b) => a.rank - b.rank);
  return {
    indexVersion: version,
    indexed: raw["indexed"] === false ? false : true,
    hits: hits.map((h, i) => ({ ...h, rank: i + 1 })),
  };
}

export type SemanticCoverage = {
  dataset: string;
  label: string;
  records: number;
  loadedChunks: number;
  cappedRecords: number;
  composed: boolean;
};

export function parseStatus(
  raw: unknown,
): { indexVersion: string | null; datasets: SemanticCoverage[] } | null {
  if (!isObj(raw) || !Array.isArray(raw["datasets"])) return null;
  const datasets: SemanticCoverage[] = [];
  for (const d of raw["datasets"]) {
    if (!isObj(d) || !isSemanticDataset(d["dataset"])) continue;
    datasets.push({
      dataset: d["dataset"],
      label: datasetLabel(d["dataset"]),
      records: posInt(d["records"]) ?? 0,
      loadedChunks: posInt(d["loaded_chunks"]) ?? 0,
      cappedRecords: posInt(d["capped_records"]) ?? 0,
      composed: d["composed"] === true,
    });
  }
  return {
    indexVersion: typeof raw["index_version"] === "string" ? raw["index_version"] : null,
    datasets,
  };
}

/** What a caller gets back; every non-ok state is distinct so pages can say what is true instead of showing a blank. */
export type SearchOutcome =
  | { status: "ok"; query: string; hits: SemanticHit[] }
  | { status: "not_configured" }
  | { status: "not_loaded" }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; reason: "embedding" | "database" | "busy" | "version" };

export type RelatedOutcome =
  | { status: "ok"; hits: SemanticHit[] }
  | { status: "not_indexed" }
  | { status: "not_loaded" }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; reason: "database" | "version" };

export type StatusOutcome =
  | { status: "ok"; datasets: SemanticCoverage[] }
  | { status: "not_loaded" }
  | { status: "unavailable"; reason: "database" | "version" };
