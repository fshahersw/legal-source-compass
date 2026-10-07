/** Read-only PostgREST access to the user's external corpus database. Server-only. */
export type RestResult<T> = { rows: T; total: number | null };

function creds() {
  const url = process.env["EXTERNAL_SUPABASE_URL"];
  const key = process.env["EXTERNAL_SUPABASE_KEY"];
  if (!url || !key) throw new Error("External corpus database is not configured.");
  return { url: url.replace(/\/$/, ""), key };
}

export async function restGet<T>(path: string, opts: { count?: boolean; range?: [number, number] } = {}): Promise<RestResult<T>> {
  const { url, key } = creds();
  const headers: Record<string, string> = { apikey: key, Accept: "application/json" };
  if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
  if (opts.count) headers["Prefer"] = "count=exact";
  if (opts.range) headers["Range"] = `${opts.range[0]}-${opts.range[1]}`;
  const res = await fetch(`${url}/rest/v1/${path}`, { method: "GET", headers });
  if (!res.ok) {
    const body = await res.text();
    console.error(`External corpus read failed [${res.status}]: ${body.slice(0, 500)}`);
    throw new Error(`External corpus read failed (${res.status}).`);
  }
  const cr = res.headers.get("content-range");
  const total = cr && cr.includes("/") && !cr.endsWith("*") ? Number(cr.split("/")[1]) : null;
  return { rows: (await res.json()) as T, total };
}

/** Escape a user search term for a PostgREST ilike filter. */
export function ilikeTerm(q: string) {
  return encodeURIComponent(`*${q.replace(/[*,()%]/g, " ").trim()}*`);
}

/** Call a read-only corpus RPC function (they are SQL SELECT functions; nothing is written). */
export async function rpcPost<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { url, key } = creds();
  const headers: Record<string, string> = { apikey: key, Accept: "application/json", "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    console.error(`External corpus rpc ${fn} failed [${res.status}]: ${(await res.text()).slice(0, 500)}`);
    throw new Error(`External corpus read failed (${res.status}).`);
  }
  return (await res.json()) as T;
}

/**
 * Like rpcPost, but a missing function (the projection SQL has not been applied yet) returns null
 * instead of failing the whole page. Any other failure still throws.
 */
export async function rpcPostOptional<T>(
  fn: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  const { url, key } = creds();
  const headers: Record<string, string> = {
    apikey: key,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (res.status === 404) {
    const text = await res.text();
    if (text.includes("PGRST202") || text.includes("Could not find the function")) return null;
    console.error(`External corpus rpc ${fn} failed [${res.status}]: ${text.slice(0, 500)}`);
    throw new Error(`External corpus read failed (${res.status}).`);
  }
  if (!res.ok) {
    console.error(
      `External corpus rpc ${fn} failed [${res.status}]: ${(await res.text()).slice(0, 500)}`,
    );
    throw new Error(`External corpus read failed (${res.status}).`);
  }
  return (await res.json()) as T;
}

/** Look up a stored corpus file by its route and stream it from the private bucket. */
export async function fetchArtifact(route: string): Promise<Response> {
  const { url, key } = creds();
  const headers: Record<string, string> = { apikey: key };
  if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
  const meta = await fetch(`${url}/rest/v1/corpus_artifacts?select=object_key,mime,filename,bytes&ready=eq.true&route=eq.${encodeURIComponent(route)}&limit=1`, { headers });
  if (!meta.ok) return new Response("File lookup failed", { status: 502 });
  const [a] = (await meta.json()) as { object_key: string; mime: string | null; filename: string | null }[];
  if (!a) return new Response("File not available in the corpus", { status: 404 });
  const obj = await fetch(`${url}/storage/v1/object/corpus-originals/${a.object_key.split("/").map(encodeURIComponent).join("/")}`, { headers });
  if (!obj.ok || !obj.body) return new Response("File not available in storage", { status: 404 });
  const safeName = (a.filename ?? "file").replace(/[^\w.-]+/g, "_");
  return new Response(obj.body, {
    headers: {
      "Content-Type": a.mime ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
