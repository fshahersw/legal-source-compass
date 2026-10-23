/**
 * Cold-start loader of the citation pattern table for the deployed ingest-citations function.
 *
 * The deploy tool takes a function's files as text, and the generated table (patterns.data.ts, about 330 KB) is too
 * large to pass that way. scripts/ingest/bundle_functions.mjs therefore writes a small patterns.data.ts into the bundle
 * that awaits `loadPatternTable` with the SHA-256 of src/lib/citations/patterns.json at bundle time, and
 * scripts/citations_v2/upload_patterns.mjs stores that file content-addressed in private storage
 * (corpus-exports/citations/patterns/<sha256>.json). The bytes are checked against the digest before they are parsed,
 * so the deployed function runs exactly the table the repository and the Python engine use, or does not start.
 *
 * Web APIs only (runs in the edge runtime and in Node for the tests). The service-role key is never logged or returned.
 */
import type { PatternTable } from "./types.ts";

export const PATTERNS_BUCKET = "corpus-exports";

export function patternsObjectPath(sha256: string): string {
  return `citations/patterns/${sha256}.json`;
}

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export async function loadPatternTable(opts: {
  env: (name: string) => string | undefined;
  sha256: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<PatternTable> {
  if (!/^[0-9a-f]{64}$/.test(opts.sha256)) throw new Error("pattern table: invalid digest");
  const url = opts.env("SUPABASE_URL");
  const key = opts.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key)
    throw new Error("pattern table: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not available");
  const headers: Record<string, string> = { apikey: key };
  if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
  const res = await (opts.fetch ?? fetch)(
    `${url.replace(/\/$/, "")}/storage/v1/object/${PATTERNS_BUCKET}/${patternsObjectPath(opts.sha256)}`,
    { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000) },
  );
  if (!res.ok) throw new Error(`pattern table: storage HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  const digest = toHex(await crypto.subtle.digest("SHA-256", bytes));
  if (digest !== opts.sha256) throw new Error("pattern table: digest mismatch");
  const table = JSON.parse(new TextDecoder().decode(bytes)) as PatternTable;
  if (typeof table.version !== "string" || !Array.isArray(table.rules) || table.rules.length === 0)
    throw new Error("pattern table: unexpected shape");
  return table;
}
