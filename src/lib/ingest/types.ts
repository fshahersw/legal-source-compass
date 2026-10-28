/**
 * Shared types of the self-updating ingestion (ingest/1). Database side: database/contracts/ingest-v1.sql.
 * Everything under src/lib/ingest/** except *.functions.ts runs unchanged in the Supabase edge runtime (Deno) and in Node
 * (vitest, scripts/ingest/dry_run.mjs): relative imports with `.ts` extensions, web APIs only (fetch, crypto.subtle).
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** One public.corpus_records row exactly as corpus_writer.record builds it (ordinal assigned by the database). */
export type CorpusRow = {
  dataset: string;
  id: string;
  category: string;
  state: string;
  county_geoids?: string[];
  title: string;
  source_url: string;
  ordinal?: number;
  item: JsonObject;
  detail: JsonObject;
  text: string;
  filters: JsonObject;
};

/** A stored row as read back from the corpus (only the compared columns are required). */
export type StoredRow = Omit<CorpusRow, "ordinal"> & { ordinal: number };

/** The compared columns of a row plus its id (rows.contentOf): what change detection sees. */
export type RowContent = {
  id: string;
  category: string;
  state: string;
  county_geoids: string[];
  title: string;
  source_url: string;
  item: JsonObject;
  detail: JsonObject;
  text: string;
  filters: JsonObject;
};

/** One HTTP request a run made: recorded in ingest.runs.requests. The URL never carries a key. */
export type RequestRecord = {
  url: string;
  status: number;
  bytes: number;
  sha256: string;
  retrieved_at: string;
};

export type IngestMode = "insert_only" | "upsert";
export type OrdinalPolicy = "prepend" | "append";

/** A record the source listed that the run does not apply, with the rule that holds it back. */
export type HeldRecord = { key: string; reason: string };

/** What an adapter returns from one run's reading of the source. */
export type Collected = {
  /** Candidate rows in the builder's order: newest first for 'prepend' datasets, oldest first for 'append'. */
  rows: CorpusRow[];
  /** Source records read (before any held/unchanged classification). */
  fetched: number;
  held: HeldRecord[];
  /** Cursor stored for the next run (only after an ok/partial run). */
  cursorAfter: Json;
  /** False when the run stopped at its page/request bound or a rate limit: the run is 'partial'. */
  complete: boolean;
  /** Short facts for the ledger (windows read, counts per day, rules applied). Never source text or keys. */
  notes: JsonObject;
  /**
   * Existing rows to compare by source_url instead of id (federal_register_history ids derive from ordinals).
   * When set, `matchBy` lists the source_url of each candidate row.
   */
  matchBy?: "id" | "source_url";
  /** Source records the adapter already found held and identical (counted as unchanged; not sent). */
  preUnchanged?: number;
  /**
   * Dry-run check that already-held records equal what this port builds for the same source record (with the
   * provenance the stored row was written with). Not called by scheduled runs.
   */
  verifyHeld?: () => Promise<ParityReport>;
  /** The already-held records rebuilt by this port with the provenance their stored rows carry (parity checks). */
  rebuildHeld?: () => Promise<{ key: string; built: CorpusRow; stored: StoredRow }[]>;
  /** Every source record read, by its match key and date (dry-run presence checks of insert-only sources). */
  readKeys?: { key: string; date: string | null }[];
};

export type ParityReport = {
  compared: number;
  identical: number;
  mismatches: { key: string; paths: string[] }[];
};

/** Read-only corpus access an adapter may use while collecting (lookups the original builder used). */
export interface CorpusReader {
  /** Stored rows of a dataset whose `column` is one of `values` (chunked internally). */
  rowsBy(
    dataset: string,
    column: "id" | "source_url",
    values: string[],
    select?: string,
  ): Promise<StoredRow[]>;
  /** First rows of a dataset ordered by ordinal. */
  edge(
    dataset: string,
    order: "asc" | "desc",
    select: string,
    limit?: number,
  ): Promise<JsonObject[]>;
  /** GET corpus_records with a PostgREST query string (dataset filter included by the caller). */
  query(pathAndQuery: string): Promise<JsonObject[]>;
  /** A read-only RPC (public.ingest_distinct_text_v1 and similar). */
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T>;
}

/** Fetching with the source's politeness rules (see http.ts). */
export interface SourceHttp {
  getText(
    url: string,
    init?: { headers?: Record<string, string>; recordUrl?: string },
  ): Promise<{ status: number; text: string; record: RequestRecord }>;
  /**
   * Any method with a JSON body (APIs that take POST: Firecrawl, model batches). Optional so test doubles that only
   * read can omit it; adapters that need it check for it.
   */
  send?(
    url: string,
    init?: {
      method?: "GET" | "POST";
      headers?: Record<string, string>;
      body?: string;
      recordUrl?: string;
    },
  ): Promise<{ status: number; text: string; record: RequestRecord }>;
  readonly requests: RequestRecord[];
  readonly remaining: number;
}

export type CollectContext = {
  http: SourceHttp;
  corpus: CorpusReader;
  cursor: Json;
  now: Date;
  env: (name: string) => string | undefined;
};

/** One self-updating source (one row of ingest.sources). */
export interface SourceAdapter {
  /** ingest.sources.id */
  source: string;
  dataset: string;
  mode: IngestMode;
  ordinalPolicy: OrdinalPolicy;
  /** Edge function that runs this source (ingest.sources.function_name). */
  functionName: string;
  /** Requests per run and minimum spacing per host (ms). */
  limits: { maxRequests: number; minIntervalMs: number };
  /** Environment secrets the source needs (names only). */
  secrets: string[];
  collect(ctx: CollectContext): Promise<Collected>;
  /**
   * The parts of a row compared for change detection. Capture-time provenance that a full rebuild would also restate
   * (retrieval date, capture timestamps) is masked, so an unchanged source record never rewrites a row.
   */
  comparable(content: RowContent): Json;
  /**
   * Catalog text the source restates after adding rows (public.ingest_catalog_note_v1), e.g. the listing qualification
   * with the new coverage end. Only for sources whose catalog config allows notes.
   */
  catalogNote?(collected: Collected, runId: string, now: Date): JsonObject | null;
}

export type Classified = {
  inserts: CorpusRow[];
  updates: CorpusRow[];
  unchanged: number;
  /** Existing rows an insert-only source keeps as collected. */
  alreadyHeld: number;
};

export type RunSummary = {
  source: string;
  dataset: string;
  dryRun: boolean;
  runId: string | null;
  status: "ok" | "partial" | "failed" | "skipped";
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  held: number;
  heldReasons: Record<string, number>;
  error: string | null;
  cursorBefore: Json;
  cursorAfter: Json;
  requests: number;
  notes: JsonObject;
  insightsRefresh: Json;
  skipped?: string;
};
