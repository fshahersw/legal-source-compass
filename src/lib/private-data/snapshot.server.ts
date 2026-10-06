import manifest from "./manifest.server.json";
import { MAX_SNAPSHOT_BYTES, snapshotName, snapshotPage, snapshotPageBounds } from "./protocol";
import { requireCorpusAccess } from "@/lib/auth/access.server";

type Snapshot = { sha256: string; bytes: number; storage_key: string };
const entries = manifest.files as Record<string, Snapshot>;
const cache = new Map<string, Uint8Array>();
const pending = new Map<string, Promise<Uint8Array>>();
let cachedBytes = 0;
const MAX_CACHE_BYTES = 24 * 1024 * 1024;

async function loadVerified(entry: Snapshot): Promise<Uint8Array> {
  const hit = cache.get(entry.sha256);
  if (hit) { cache.delete(entry.sha256); cache.set(entry.sha256, hit); return hit; }
  const running = pending.get(entry.sha256);
  if (running) return running;
  const operation = (async () => {
    const url = process.env["EXTERNAL_SUPABASE_URL"]?.replace(/\/+$/, "");
    const key = process.env["EXTERNAL_SUPABASE_KEY"];
    if (url !== "https://xosqzzsnhxcyehcnirpa.supabase.co" || !key) throw new Error("Private snapshot storage is not configured");
    const headers: Record<string, string> = { apikey: key };
    if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
    const response = await fetch(`${url}/storage/v1/object/corpus-originals/${entry.storage_key}`, {
      headers, redirect: "manual", signal: AbortSignal.timeout(30000),
    });
    if (response.status >= 300 && response.status < 400) throw new Error("Private snapshot unexpected redirect");
    if (!response.ok || !response.body) throw new Error("Private snapshot unavailable");
    const reader = response.body.getReader();
    const bytes = new Uint8Array(entry.bytes);
    let used = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (used + part.value.length > entry.bytes) { await reader.cancel(); throw new Error("Private snapshot size mismatch"); }
      bytes.set(part.value, used); used += part.value.length;
    }
    if (used !== entry.bytes) throw new Error("Private snapshot truncated");
    const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (actual !== entry.sha256) throw new Error("Private snapshot checksum mismatch");
    while (cachedBytes + bytes.length > MAX_CACHE_BYTES && cache.size) {
      const oldest = cache.keys().next().value!;
      cachedBytes -= cache.get(oldest)!.length; cache.delete(oldest);
    }
    cache.set(entry.sha256, bytes); cachedBytes += bytes.length;
    return bytes;
  })();
  pending.set(entry.sha256, operation);
  try { return await operation; } finally { pending.delete(entry.sha256); }
}

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie", "X-Content-Type-Options": "nosniff" };
const problem = (message: string, status: number) => new Response(message, { status, headers: privateHeaders });

/** Access is checked even for cached bytes and for callers beyond the API route. */
export async function serveSnapshotPage(request: Request): Promise<Response> {
  await requireCorpusAccess(request);
  const url = new URL(request.url);
  let file: string, page: number;
  try { file = snapshotName(url.searchParams.get("file") ?? ""); page = snapshotPage(url.searchParams.get("page")); }
  catch { return problem("Invalid snapshot request", 400); }
  const entry = Object.hasOwn(entries, file) ? entries[file] : undefined;
  if (!entry || entry.bytes > MAX_SNAPSHOT_BYTES) return problem("Snapshot not found", 404);
  const version = url.searchParams.get("version");
  if ((page > 0 && !version) || (version && version !== entry.sha256)) return problem("Snapshot version changed", 409);
  let bounds: ReturnType<typeof snapshotPageBounds>;
  try { bounds = snapshotPageBounds(entry.bytes, page); } catch { return problem("Page out of range", 416); }
  const bytes = await loadVerified(entry);
  return new Response(bytes.slice(bounds.start, bounds.end), { headers: {
    "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store", Vary: "Authorization, Cookie",
    "X-Content-Type-Options": "nosniff", "X-Atlas-Snapshot-Sha256": entry.sha256,
    "X-Atlas-Snapshot-Bytes": String(entry.bytes), "X-Atlas-Page": String(page), "X-Atlas-Page-Count": String(bounds.pages),
  } });
}

/** Manifest paths only. Callers still have to pass corpus access before reading bytes. */
export function listSnapshotNames(): string[] {
  return Object.keys(entries);
}

/** Hash-verified bytes for one manifest entry. */
export async function readPrivateSnapshot(file: string): Promise<Uint8Array> {
  const name = snapshotName(file);
  const entry = Object.hasOwn(entries, name) ? entries[name] : undefined;
  if (!entry || entry.bytes > MAX_SNAPSHOT_BYTES) throw new Error("Snapshot not found");
  return loadVerified(entry);
}
