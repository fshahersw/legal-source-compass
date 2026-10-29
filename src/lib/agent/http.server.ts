/**
 * Shared request handling for the agent workspace routes: same-site check, rate limit, workspace owner, bounded JSON
 * bodies and plain error responses. Server-only.
 */
import { requireOwner } from "./owner.server";

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function guard(
  request: Request,
  bucket: string,
  max = 240,
): Promise<{ owner: string } | Response> {
  const { allow, clientKey, crossSiteRequest } = await import("@/lib/assistant/limits.server");
  if (crossSiteRequest(request))
    return json({ error: "Requests from other sites are not accepted." }, 403);
  if (!allow(`agent-${bucket}:${clientKey(request)}`, max, 10 * 60 * 1000))
    return json({ error: "Too many requests in a short time. Wait a few minutes." }, 429);
  const who = await requireOwner(request);
  if (who instanceof Response) return who;
  const { registerSiteUrl } = await import("./owner.server");
  void registerSiteUrl(request);
  return who;
}

export async function readJson(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | Response> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) return json({ error: "The request is too large." }, 413);
  try {
    const text = await request.text();
    if (text.length > maxBytes) return json({ error: "The request is too large." }, 413);
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v))
      return json({ error: "The request was not valid." }, 400);
    return v as Record<string, unknown>;
  } catch {
    return json({ error: "The request could not be read." }, 400);
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function failure(error: unknown, fallback: string): Response {
  const message = error instanceof Error ? error.message : "";
  // database limits and checks come back as readable messages; anything else stays generic
  if (/limit|full|no such|too large|not configured|not allowed|empty|first\./i.test(message))
    return json({ error: message }, 400);
  console.error("agent", error);
  return json({ error: fallback }, 500);
}
