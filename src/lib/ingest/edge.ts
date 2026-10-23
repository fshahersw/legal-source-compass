/**
 * The HTTP handler every ingest edge function serves (each supabase/functions/ingest-<name>/index.ts is a three-line wrapper).
 *
 *   POST /functions/v1/<name>   Authorization: Bearer <INGEST_CRON_SECRET>
 *   body: { "source"?: string, "trigger"?: "schedule" | "manual", "wait"?: boolean }
 *
 * The scheduler (pg_cron + pg_net, ingest-v1.sql section 9) posts { source, trigger: "schedule" } and gets 202 at once;
 * the run continues as a background task (EdgeRuntime.waitUntil). A manual call with "wait": true returns the run's
 * summary (first runs, checks). The corpus is written only through the ingest RPCs with the service role key the
 * platform injects (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY); keys never appear in responses or logs.
 */
import { corpusClient } from "./corpus.ts";
import { runSource } from "./runner.ts";
import type { JsonObject, SourceAdapter } from "./types.ts";

export type ServeOptions = {
  sources: SourceAdapter[];
  env: (name: string) => string | undefined;
  /** EdgeRuntime.waitUntil in the edge runtime; absent in tests (the run is awaited). */
  waitUntil?: (p: Promise<unknown>) => void;
  fetch?: typeof fetch;
  now?: () => Date;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** Constant-time string comparison (length is not secret). */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function serveIngest(opts: ServeOptions): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const secret = opts.env("INGEST_CRON_SECRET");
    if (!secret) return json(503, { error: "INGEST_CRON_SECRET is not set for this function" });
    const auth = req.headers.get("authorization") ?? "";
    if (!sameSecret(auth.replace(/^Bearer\s+/i, ""), secret))
      return json(401, { error: "unauthorized" });

    let body: JsonObject = {};
    try {
      const text = await req.text();
      body = text ? (JSON.parse(text) as JsonObject) : {};
    } catch {
      return json(400, { error: "body must be JSON" });
    }
    const name =
      typeof body["source"] === "string"
        ? body["source"]
        : opts.sources.length === 1
          ? opts.sources[0]!.source
          : "";
    const adapter = opts.sources.find((s) => s.source === name);
    if (!adapter)
      return json(400, { error: "unknown source", sources: opts.sources.map((s) => s.source) });
    const trigger = body["trigger"] === "manual" ? "manual" : "schedule";

    const url = opts.env("SUPABASE_URL");
    const key = opts.env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key)
      return json(503, { error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not available" });
    const missing = adapter.secrets.filter((s) => !opts.env(s));
    if (missing.length) return json(503, { error: "missing function secrets", names: missing });

    const corpus = corpusClient({ url, key, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    const run = runSource(adapter, {
      corpus,
      env: opts.env,
      dryRun: false,
      trigger,
      now: opts.now ? opts.now() : new Date(),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      log: (line) => console.log(JSON.stringify(line)),
    }).catch((error: unknown) => {
      // the run could not even be opened or closed; the ledger keeps whatever the database recorded
      const message = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
      console.error(
        JSON.stringify({ step: "run-error", source: adapter.source, error: message.slice(0, 500) }),
      );
      return { source: adapter.source, status: "failed" as const, error: message.slice(0, 500) };
    });

    if (body["wait"] === true || !opts.waitUntil) {
      const summary = await run;
      return json(summary.status === "failed" ? 500 : 200, summary);
    }
    opts.waitUntil(run);
    return json(202, { accepted: true, source: adapter.source, trigger });
  };
}
