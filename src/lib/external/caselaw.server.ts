/**
 * Server-only I/O for case law: one HTTP Range read per page from the private reading store (Supabase Storage bucket
 * corpus-originals honours Range on service-key reads: 206 with the exact bytes, measured 2026-10-22), gzip-member
 * decoding, and CourtListener's live search API with the server token (COURTLISTENER_API_KEY), a per-instance rate
 * limit well under the shared membership quota (25/min, 300/h, 1,400/day for every user of the token) and a cache.
 * Storage keys come only from Postgres rows (caselaw_case_v1) and are checked against fixed patterns before use.
 */
import { CITATOR_KEY, MAX_RANGE_BYTES, READ_KEY } from "./caselaw";

const BUCKET = "corpus-originals";

function storageCreds() {
  const url = process.env["EXTERNAL_SUPABASE_URL"];
  const key = process.env["EXTERNAL_SUPABASE_KEY"];
  if (!url || !key) throw new Error("External corpus storage is not configured.");
  return { url: url.replace(/\/$/, ""), key };
}

/** Bytes [start, end) of a reading-store or citator object, in one ranged request. */
export async function readRange(key: string, start: number, end: number): Promise<Uint8Array> {
  if (!(READ_KEY.test(key) || CITATOR_KEY.test(key))) throw new Error("Unexpected storage key.");
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end - start > MAX_RANGE_BYTES
  )
    throw new Error("Invalid byte range.");
  const { url, key: apiKey } = storageCreds();
  const headers: Record<string, string> = { apikey: apiKey, Range: `bytes=${start}-${end - 1}` };
  if (!apiKey.startsWith("sb_")) headers["Authorization"] = `Bearer ${apiKey}`;
  const path = key.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, { headers });
  if (res.status !== 206) {
    await res.body?.cancel();
    throw new Error(`Stored text read failed (${res.status}).`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength !== end - start)
    throw new Error("Stored text read returned an unexpected length.");
  return buf;
}

/** Decompress one gzip member to UTF-8 text. */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

// ---------------------------------------------------------------------------------------------- CourtListener live search
type Bucket = { limit: number; windowMs: number; hits: number[] };
/** Per-instance share of the token's quota (the token is shared with other features and builders). */
const BUCKETS: Bucket[] = [
  { limit: 6, windowMs: 60_000, hits: [] },
  { limit: 60, windowMs: 3_600_000, hits: [] },
  { limit: 300, windowMs: 86_400_000, hits: [] },
];
let backoffUntil = 0;

export function takeToken(now = Date.now(), buckets: Bucket[] = BUCKETS): boolean {
  if (now < backoffUntil) return false;
  for (const b of buckets) {
    while (b.hits.length && b.hits[0]! <= now - b.windowMs) b.hits.shift();
    if (b.hits.length >= b.limit) return false;
  }
  for (const b of buckets) b.hits.push(now);
  return true;
}

type Cached = { at: number; body: unknown };
const MEMO = new Map<string, Cached>();
const CACHE_MS = 6 * 3_600_000;
const CACHE_HOST = "https://caselaw-cache.invalid/cl-search?";

async function edgeCache(): Promise<Cache | null> {
  try {
    const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
    return c?.default ?? null;
  } catch {
    return null;
  }
}

export type LiveFetch =
  | { ok: true; body: unknown; source: "live" | "cache"; fetchedAt: string }
  | { ok: false; reason: "not_configured" | "rate_limited" | "upstream_error"; status?: number };

/** GET /api/rest/v4/search/ with the server token; cached for six hours (per instance and at the edge). */
export async function courtListenerSearch(
  params: URLSearchParams,
  timeoutMs = 20_000,
): Promise<LiveFetch> {
  params.sort();
  const qs = params.toString();
  const now = Date.now();
  const hit = MEMO.get(qs);
  if (hit && now - hit.at < CACHE_MS)
    return { ok: true, body: hit.body, source: "cache", fetchedAt: new Date(hit.at).toISOString() };
  const edge = await edgeCache();
  if (edge) {
    const res = await edge.match(CACHE_HOST + qs).catch(() => undefined);
    if (res) {
      const at = Number(res.headers.get("x-fetched-at")) || now;
      const body = (await res.json().catch(() => null)) as unknown;
      if (body && now - at < CACHE_MS) {
        MEMO.set(qs, { at, body });
        return { ok: true, body, source: "cache", fetchedAt: new Date(at).toISOString() };
      }
    }
  }
  const token = process.env["COURTLISTENER_API_KEY"];
  if (!token) return { ok: false, reason: "not_configured" };
  if (!takeToken(now)) return { ok: false, reason: "rate_limited" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`https://www.courtlistener.com/api/rest/v4/search/?${qs}`, {
      headers: { Authorization: `Token ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
  } catch {
    return { ok: false, reason: "upstream_error" };
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    backoffUntil = Date.now() + 120_000;
    await res.body?.cancel();
    return { ok: false, reason: "rate_limited", status: 429 };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { ok: false, reason: "upstream_error", status: res.status };
  }
  const body = (await res.json()) as unknown;
  MEMO.set(qs, { at: now, body });
  if (MEMO.size > 300) MEMO.delete(MEMO.keys().next().value as string);
  if (edge) {
    await edge
      .put(
        CACHE_HOST + qs,
        new Response(JSON.stringify(body), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "max-age=21600",
            "x-fetched-at": String(now),
          },
        }),
      )
      .catch(() => undefined);
  }
  return { ok: true, body, source: "live", fetchedAt: new Date(now).toISOString() };
}
