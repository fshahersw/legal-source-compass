/** API-key auth + shared helpers for the public corpus API. Server-only. */
import { createHmac, timingSafeEqual } from "crypto";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "x-api-key, content-type",
  "Access-Control-Max-Age": "86400",
};

export function optionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: CORS_HEADERS });
}

/** Constant-time API key check. Returns null when authorized, else a 401 Response. */
export function requireApiKey(request: Request): Response | null {
  const expected = process.env["CORPUS_API_KEY"];
  if (!expected) return json({ error: "API is not configured on this deployment." }, 503);
  const provided = request.headers.get("x-api-key") ?? "";
  // Hash both sides so timingSafeEqual never leaks length differences.
  const a = createHmac("sha256", "corpus-api").update(provided).digest();
  const b = createHmac("sha256", "corpus-api").update(expected).digest();
  if (!timingSafeEqual(a, b)) return json({ error: "Missing or invalid x-api-key header." }, 401);
  return null;
}

/** Parse bounded integer query params with clamps. */
export function intParam(url: URL, name: string, def: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw == null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
