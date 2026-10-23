/**
 * Server side of the semantic index: embeds a query (key from the server environment only) and calls the read-only database
 * functions semantic_search_v1, semantic_related_v1 and semantic_status_v1 (database/contracts/semantic-v1.sql).
 *
 * Every state is a distinct outcome so pages can say what is true: not configured (no key on this deployment), not loaded (the
 * database functions or data are not there yet), unavailable (the embedding service or the database failed, or the deployment
 * is busy), invalid input, or ok. Nothing here throws for a missing configuration, and nothing names the embedding provider
 * in an outcome. A semantic hit is a retrieval aid: never a citation, never an identity link.
 */
import { rpcPostOptional } from "@/lib/external/rest.server";
import {
  MAX_QUERY_CHARS,
  SEMANTIC_INDEX_VERSION,
  clampInt,
  isSemanticDataset,
  normalizeQuery,
  parsePayload,
  parseStatus,
  toVectorLiteral,
  type RelatedOutcome,
  type SearchOutcome,
  type StatusOutcome,
} from "./semantic";

/** The one place the embedding model is named; queries must use the model the index was built with. */
export const EMBEDDING_MODEL = "voyage-law-2";
const DEFAULT_EMBEDDING_URL = "https://api.voyageai.com/v1/embeddings";
const EMBED_TIMEOUT_MS = 10_000;
/** Record ids as the index stores them; CFR appendix and supplement ids carry spaces, commas, brackets and "§". */
const RECORD_ID = /^[A-Za-z0-9:._@/~ ,()[\]§-]{1,200}$/;

export type Deps = {
  fetch: typeof fetch;
  rpc: typeof rpcPostOptional;
  now: () => number;
  env: (name: string) => string | null;
};

const realDeps: Deps = {
  fetch: (...a) => fetch(...a),
  // resolved at call time, so a module that only imports this file (the assistant's tool registry) never touches the REST client
  rpc: (...a) => rpcPostOptional(...a),
  now: () => Date.now(),
  env: (name) => {
    const v = process.env[name];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  },
};

export function semanticConfigured(deps: Pick<Deps, "env"> = realDeps): boolean {
  return deps.env("VOYAGE_API_KEY") !== null;
}

// ---------------------------------------------------------------------------------------------- limits and caches
type Bucket = { limit: number; windowMs: number; hits: number[] };
/** Per-instance spend guard for embedding calls (cached queries do not count). */
const BUCKETS: Bucket[] = [
  { limit: 30, windowMs: 60_000, hits: [] },
  { limit: 400, windowMs: 3_600_000, hits: [] },
];

export function takeEmbeddingToken(now: number, buckets: Bucket[] = BUCKETS): boolean {
  for (const b of buckets) {
    while (b.hits.length && b.hits[0]! <= now - b.windowMs) b.hits.shift();
    if (b.hits.length >= b.limit) return false;
  }
  for (const b of buckets) b.hits.push(now);
  return true;
}

const QUERY_CACHE_MS = 30 * 60_000;
const queryCache = new Map<string, { at: number; literal: string }>();
let statusCache: { at: number; value: StatusOutcome } | null = null;

export function resetSemanticState(): void {
  queryCache.clear();
  statusCache = null;
  for (const b of BUCKETS) b.hits.length = 0;
}

// ---------------------------------------------------------------------------------------------------- embedding
/**
 * Where query embeddings are requested. SEMANTIC_EMBEDDING_URL may point at a local stand-in for browser checks; only a
 * plain-http loopback address is honoured, so a mistaken value can never send the key to another host.
 */
export function embeddingUrl(deps: Pick<Deps, "env"> = realDeps): string {
  const override = deps.env("SEMANTIC_EMBEDDING_URL");
  if (!override) return DEFAULT_EMBEDDING_URL;
  try {
    const u = new URL(override);
    if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost"))
      return u.href;
  } catch {
    /* not a URL */
  }
  return DEFAULT_EMBEDDING_URL;
}

type EmbedResult =
  { ok: true; literal: string } | { ok: false; reason: "not_configured" | "embedding" | "busy" };

async function embedQuery(query: string, deps: Deps): Promise<EmbedResult> {
  const key = deps.env("VOYAGE_API_KEY");
  if (!key) return { ok: false, reason: "not_configured" };
  const cached = queryCache.get(query);
  if (cached && deps.now() - cached.at < QUERY_CACHE_MS)
    return { ok: true, literal: cached.literal };
  if (!takeEmbeddingToken(deps.now())) return { ok: false, reason: "busy" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await deps.fetch(embeddingUrl(deps), {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: [query], model: EMBEDDING_MODEL, input_type: "query" }),
    });
    if (!res.ok) {
      console.error(`Semantic query embedding failed (HTTP ${res.status}).`);
      await res.body?.cancel();
      return { ok: false, reason: res.status === 429 ? "busy" : "embedding" };
    }
    const body = (await res.json()) as { data?: { embedding?: unknown }[] };
    const literal = toVectorLiteral(body.data?.[0]?.embedding);
    queryCache.set(query, { at: deps.now(), literal });
    while (queryCache.size > 200) queryCache.delete(queryCache.keys().next().value as string);
    return { ok: true, literal };
  } catch (error) {
    // never log the request: it carries the key
    console.error(
      `Semantic query embedding failed (${error instanceof Error ? error.name : "error"}).`,
    );
    return { ok: false, reason: "embedding" };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------------------------------------------ search
export async function searchSemantic(
  query: string,
  datasets: readonly string[] | null | undefined,
  limit: number | undefined,
  deps: Deps = realDeps,
): Promise<SearchOutcome> {
  const q = normalizeQuery(query);
  if (q.length < 2) return { status: "invalid", message: "Type at least 2 characters." };
  if (q.length >= MAX_QUERY_CHARS)
    return { status: "invalid", message: `Use at most ${MAX_QUERY_CHARS - 1} characters.` };
  const wanted = datasets?.length ? [...new Set(datasets)] : null;
  if (wanted && !wanted.every(isSemanticDataset))
    return { status: "invalid", message: "Unknown dataset." };
  if (!semanticConfigured(deps)) return { status: "not_configured" };
  const emb = await embedQuery(q, deps);
  if (!emb.ok)
    return emb.reason === "not_configured"
      ? { status: "not_configured" }
      : { status: "unavailable", reason: emb.reason };
  let raw: unknown;
  try {
    raw = await deps.rpc("semantic_search_v1", {
      p_embedding: emb.literal,
      p_datasets: wanted,
      p_limit: clampInt(limit, 1, 20, 10),
    });
  } catch {
    return { status: "unavailable", reason: "database" };
  }
  if (raw === null) return { status: "not_loaded" };
  const payload = parsePayload(raw);
  if (!payload) return { status: "unavailable", reason: "database" };
  if (payload.indexVersion === null) return { status: "not_loaded" };
  if (payload.indexVersion !== SEMANTIC_INDEX_VERSION)
    return { status: "unavailable", reason: "version" };
  return { status: "ok", query: q, hits: payload.hits };
}

// ----------------------------------------------------------------------------------------------------- related
export async function relatedSemantic(
  dataset: string,
  recordId: string,
  limit: number | undefined,
  datasets?: readonly string[] | null,
  deps: Deps = realDeps,
): Promise<RelatedOutcome> {
  if (!isSemanticDataset(dataset) || !RECORD_ID.test(recordId))
    return { status: "invalid", message: "Unknown record." };
  const wanted = datasets?.length ? [...new Set(datasets)] : null;
  if (wanted && !wanted.every(isSemanticDataset))
    return { status: "invalid", message: "Unknown dataset." };
  let raw: unknown;
  try {
    raw = await deps.rpc("semantic_related_v1", {
      p_dataset: dataset,
      p_record_id: recordId,
      p_limit: clampInt(limit, 1, 20, 8),
      p_datasets: wanted,
    });
  } catch {
    return { status: "unavailable", reason: "database" };
  }
  if (raw === null) return { status: "not_loaded" };
  const payload = parsePayload(raw);
  if (!payload) return { status: "unavailable", reason: "database" };
  if (payload.indexVersion === null) return { status: "not_loaded" };
  if (payload.indexVersion !== SEMANTIC_INDEX_VERSION)
    return { status: "unavailable", reason: "version" };
  if (!payload.indexed) return { status: "not_indexed" };
  return { status: "ok", hits: payload.hits };
}

// ------------------------------------------------------------------------------------------------------ status
export async function semanticCoverage(deps: Deps = realDeps): Promise<StatusOutcome> {
  if (statusCache && deps.now() - statusCache.at < 5 * 60_000) return statusCache.value;
  let value: StatusOutcome;
  try {
    const raw = await deps.rpc("semantic_status_v1", {});
    const parsed = raw === null ? null : parseStatus(raw);
    if (raw === null || (parsed && parsed.indexVersion === null)) value = { status: "not_loaded" };
    else if (!parsed) value = { status: "unavailable", reason: "database" };
    else if (parsed.indexVersion !== SEMANTIC_INDEX_VERSION)
      value = { status: "unavailable", reason: "version" };
    else value = { status: "ok", datasets: parsed.datasets.filter((d) => d.loadedChunks > 0) };
  } catch {
    return { status: "unavailable", reason: "database" }; // not cached: a failed read is retried
  }
  statusCache = { at: deps.now(), value };
  return value;
}
