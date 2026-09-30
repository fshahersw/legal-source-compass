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
