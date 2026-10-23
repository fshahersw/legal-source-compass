/**
 * PostgREST access to the corpus for the ingestion runs. Reads use the public corpus tables; every write goes through the
 * ingest RPCs (database/contracts/ingest-v1.sql). The key is given by the caller (edge function: the injected service
 * role key; dry run: a read-only key from the environment) and never logged. Errors carry the HTTP status and the
 * PostgREST error code only, never the request body or headers.
 */
import type { CorpusReader, JsonObject, StoredRow } from "./types.ts";

export const STORED_COLUMNS =
  "id,category,state,county_geoids,title,source_url,ordinal,item,detail,text,filters";

export class CorpusError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  constructor(status: number, code: string, detail: string) {
    super(
      `corpus request failed: HTTP ${status}${code ? `, ${code}` : ""}${detail ? `: ${detail}` : ""}`,
    );
    this.name = "CorpusError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** PostgREST `in.(...)` list with every value quoted. */
export function inList(values: string[]): string {
  return `(${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
}

export type CorpusClient = CorpusReader & {
  /** POST rpc/<name>; returns the JSON result. */
  call<T>(name: string, args: Record<string, unknown>): Promise<T>;
};

export function corpusClient(opts: {
  url: string;
  key: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): CorpusClient {
  const base = opts.url.replace(/\/$/, "") + "/rest/v1/";
  const doFetch = opts.fetch ?? fetch;
  const headers: Record<string, string> = {
    apikey: opts.key,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (!opts.key.startsWith("sb_")) headers["Authorization"] = `Bearer ${opts.key}`;

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(base + path, {
          method,
          headers,
          body: body === undefined ? null : JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
        });
      } catch {
        if (attempt >= 3) throw new CorpusError(0, "network", "");
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      const text = await res.text();
      // retry only reads and only on transient statuses; a write is never repeated blindly
      if (method === "GET" && (res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      if (!res.ok) {
        let code = "";
        let detail = "";
        try {
          const e = JSON.parse(text) as { code?: string; message?: string };
          if (typeof e.code === "string" && /^[A-Z0-9_]{1,12}$/.test(e.code)) code = e.code;
          // database exceptions raised by the ingest RPCs are our own messages (no row content); keep them short
          if (typeof e.message === "string") detail = e.message.slice(0, 300);
        } catch {
          /* not JSON */
        }
        throw new CorpusError(res.status, code, detail);
      }
      return (text ? JSON.parse(text) : null) as T;
    }
  }

  return {
    async rowsBy(dataset, column, values, select = STORED_COLUMNS) {
      const out: StoredRow[] = [];
      const unique = [...new Set(values)];
      for (let i = 0; i < unique.length; i += 40) {
        const chunk = unique.slice(i, i + 40);
        const q = `corpus_records?select=${select}&dataset=eq.${encodeURIComponent(dataset)}&${column}=in.${encodeURIComponent(inList(chunk))}`;
        out.push(...(await request<StoredRow[]>("GET", q)));
      }
      return out;
    },
    async edge(dataset, order, select, limit = 1) {
      return request<JsonObject[]>(
        "GET",
        `corpus_records?select=${select}&dataset=eq.${encodeURIComponent(dataset)}&order=ordinal.${order}&limit=${limit}`,
      );
    },
    async query(pathAndQuery) {
      return request<JsonObject[]>("GET", pathAndQuery);
    },
    async rpc<T>(name: string, args: Record<string, unknown>) {
      return request<T>("POST", `rpc/${name}`, args);
    },
    async call<T>(name: string, args: Record<string, unknown>) {
      return request<T>("POST", `rpc/${name}`, args);
    },
  };
}
