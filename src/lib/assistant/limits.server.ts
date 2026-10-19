/** Best-effort per-client request limits for the paid assistant endpoints (per server instance). */
const windows = new Map<string, number[]>();

export function clientKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}

/** True for browser requests made by another site (embedding or hotlinking); direct visits and this site's own requests pass. */
export function crossSiteRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return !!site && site !== "same-origin" && site !== "none";
}

/** True when the client is under `max` requests in the last `windowMs`; records the request when allowed. */
export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 5000) for (const k of [...windows.keys()].slice(0, 1000)) windows.delete(k);
  return true;
}
