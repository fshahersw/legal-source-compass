/**
 * HTTP handler of the safety/1 scheduled edge functions (supabase/functions/ingest-openfda-events and
 * ingest-cfpb-complaints are three-line wrappers). Same contract as src/lib/ingest/edge.ts:
 *   POST  Authorization: Bearer <trigger secret>   body { "source"?: string, "trigger"?: "schedule" | "manual", "wait"?: boolean }
 * The token is checked by the database (public.ingest_check_trigger_v1); the corpus is written with the service role key
 * the platform injects (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) and only through the safety/ingest RPCs. A scheduled call
 * gets 202 at once and the run continues in the background; "wait": true returns the run summary.
 */
import { corpusClient } from "../ingest/corpus.ts";
import type { JsonObject } from "../ingest/types.ts";
import { runCfpbComplaints, runOpenfdaEvents, type RunSummary, type SafetySource } from "./ingestSafety.ts";

export type SafetyServeOptions = {
  sources: SafetySource[];
  env: (name: string) => string | undefined;
  waitUntil?: (p: Promise<unknown>) => void;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Secrets each source needs before it can run (names only; values stay in the function settings). */
export const REQUIRED_SECRETS: Record<SafetySource, string[]> = {
  safety_faers_series: ["DATA_GOV_API_KEY"],
  safety_maude_series: ["DATA_GOV_API_KEY"],
  safety_cfpb_complaints: [],
};

export function serveSafety(opts: SafetyServeOptions): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const url = opts.env("SUPABASE_URL");
    const key = opts.env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json(503, { error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not available" });
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (token.length < 32) return json(401, { error: "unauthorized" });
    const corpus = corpusClient({ url, key, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    let allowed: unknown;
    try {
      allowed = await corpus.rpc<boolean>("ingest_check_trigger_v1", { p_token: token });
    } catch {
      return json(503, { error: "the trigger check is not available" });
    }
    if (allowed !== true) return json(401, { error: "unauthorized" });
    let body: JsonObject = {};
    try {
      const text = await req.text();
      body = text ? (JSON.parse(text) as JsonObject) : {};
    } catch {
      return json(400, { error: "body must be JSON" });
    }
    const name = typeof body["source"] === "string" ? body["source"] : opts.sources.length === 1 ? opts.sources[0]! : "";
    const source = opts.sources.find((s) => s === name);
    if (!source) return json(400, { error: "unknown source", sources: opts.sources });
    const missing = REQUIRED_SECRETS[source].filter((s) => !opts.env(s));
    if (missing.length) return json(503, { error: "missing function secrets", names: missing });
    const trigger = body["trigger"] === "manual" ? "manual" : "schedule";
    const runOpts = {
      corpus,
      env: opts.env,
      trigger,
      now: opts.now ? opts.now() : new Date(),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
      log: (line: JsonObject) => console.log(JSON.stringify(line)),
    } as const;
    const run: Promise<RunSummary> = (
      source === "safety_cfpb_complaints" ? runCfpbComplaints(runOpts) : runOpenfdaEvents(source, runOpts)
    ).catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
      console.error(JSON.stringify({ step: "run-error", source, error: message.slice(0, 500) }));
      return { source, status: "failed" as const, error: message.slice(0, 500) };
    });
    if (body["wait"] === true || !opts.waitUntil) {
      const summary = await run;
      return json(summary.status === "failed" ? 500 : 200, summary);
    }
    opts.waitUntil(run);
    return json(202, { accepted: true, source, trigger });
  };
}
