/**
 * HTTP handler of the semantic-refresh edge function and its PostgREST RPC client.
 *
 *   POST /functions/v1/semantic-refresh   Authorization: Bearer <trigger secret>
 *   body: { "trigger"?: "schedule" | "manual", "wait"?: boolean }
 *
 * The scheduler (pg_cron + pg_net, semantic-refresh-v1.sql section 9) posts { trigger: "schedule" } and gets 202 at once;
 * the run continues as a background task. A manual call with "wait": true returns the run's summary. The trigger secret is
 * generated in the database and kept in Vault (semantic_refresh_cron_secret); this handler asks the database whether a
 * presented token matches (semantic_refresh_check_trigger_v1), so the secret is never copied anywhere. The service role
 * key (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) is injected by the platform; the embedding key is the function secret
 * VOYAGE_API_KEY. Neither key appears in a response or a log line. Without the embedding key the run still applies
 * everything that needs no tokens and stops embedding with "embedding_key_missing".
 */
import { embeddingClient } from "./embed.ts";
import { runRefresh, type Rpc, type RunSummary } from "./refresh.ts";

const READ_ONLY = new Set([
  "semantic_refresh_pending_v1",
  "semantic_refresh_known_keys_v1",
  "semantic_refresh_status_v1",
  "semantic_refresh_check_trigger_v1",
]);

export class RpcError extends Error {
  readonly status: number;
  constructor(name: string, status: number, detail: string) {
    super(`${name}: HTTP ${status}${detail ? ` ${detail}` : ""}`);
    this.name = "RpcError";
    this.status = status;
  }
}

/** POST /rest/v1/rpc/<name>. Only read-only RPCs are retried (a write is never repeated blindly). */
export function rpcClient(opts: { url: string; key: string; fetch?: typeof fetch; timeoutMs?: number }): Rpc {
  const base = opts.url.replace(/\/$/, "") + "/rest/v1/rpc/";
  const doFetch = opts.fetch ?? fetch;
  const headers: Record<string, string> = {
    apikey: opts.key,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (!opts.key.startsWith("sb_")) headers["Authorization"] = `Bearer ${opts.key}`;
  return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const retry = READ_ONLY.has(name);
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(base + name, {
          method: "POST",
          headers,
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
        });
      } catch {
        if (retry && attempt < 3) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        throw new RpcError(name, 0, "network error");
      }
      const text = await res.text();
      if (res.ok) return (text ? JSON.parse(text) : null) as T;
      if (retry && attempt < 3 && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      let detail = "";
      try {
        const e = JSON.parse(text) as { message?: string };
        if (typeof e.message === "string") detail = e.message.slice(0, 300); // our own exception texts; no row content
      } catch {
        /* not JSON */
      }
      throw new RpcError(name, res.status, detail);
    }
  };
}

export type ServeOptions = {
  env: (name: string) => string | undefined;
  waitUntil?: (p: Promise<unknown>) => void;
  fetch?: typeof fetch;
  now?: () => number;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export function serveRefresh(opts: ServeOptions): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const url = opts.env("SUPABASE_URL");
    const key = opts.env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json(503, { error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not available" });
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (token.length < 32) return json(401, { error: "unauthorized" });
    const rpc = rpcClient({ url, key, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    let allowed: unknown;
    try {
      allowed = await rpc<boolean>("semantic_refresh_check_trigger_v1", { p_token: token });
    } catch {
      return json(503, { error: "the trigger check is not available" });
    }
    if (allowed !== true) return json(401, { error: "unauthorized" });
    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return json(400, { error: "body must be JSON" });
    }
    const trigger = body["trigger"] === "manual" ? "manual" : "schedule";
    const embedKey = opts.env("VOYAGE_API_KEY");
    const run: Promise<RunSummary> = runRefresh({
      rpc,
      embedder: embedKey ? embeddingClient({ key: embedKey, ...(opts.fetch ? { fetch: opts.fetch } : {}) }) : null,
      trigger,
      ...(opts.now ? { now: opts.now } : {}),
      log: (line) => console.log(JSON.stringify({ fn: "semantic-refresh", ...line })),
    }).catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "unknown error";
      console.error(JSON.stringify({ fn: "semantic-refresh", step: "run-error", error: message }));
      return { status: "failed", error: message } as unknown as RunSummary;
    });
    if (body["wait"] === true || !opts.waitUntil) {
      const summary = await run;
      return json(summary.status === "failed" ? 500 : 200, summary);
    }
    opts.waitUntil(run);
    return json(202, { accepted: true, trigger });
  };
}
