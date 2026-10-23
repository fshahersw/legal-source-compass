/**
 * Nightly citation extraction for newly indexed court-filing pages (citations/2).
 *
 * supabase/functions/ingest-citations serves `serveCitations`; the scheduler (database/contracts/citations-v2-schedule.sql)
 * posts after documents-nightly has indexed the day's filings. Each invocation:
 *   1. opens a run in the ledger (citations_open_run_v2; one nightly run at a time),
 *   2. takes whole byte sets that still have a page not extracted at this extractor version, newest first
 *      (citations_pending_pages_v2), extracts them with the canonical engine (extractPages: short forms link across
 *      pages) and loads them (citations_load_v2, which re-checks every citation against the stored page text),
 *   3. resolves the new authority keys (citations_resolve_v2) and rebuilds the edges of the loaded documents
 *      (citations_link_v2),
 *   4. closes the run: ok when nothing is left, partial when a budget stopped it (the next invocation continues).
 * Extraction is CPU work inside the edge runtime, so it is bounded by `extractBudgetMs` (wall time of the synchronous
 * extraction, which equals its CPU time); the database work is bounded by `wallBudgetMs`.
 *
 * Runs unchanged in the Supabase edge runtime (Deno) and in Node (vitest): relative imports with `.ts` extensions, web
 * APIs only. The service-role key is injected by the platform and never logged or returned.
 */
import { corpusClient } from "../ingest/corpus.ts";
import { extractPages } from "./engine.ts";
import { PATTERNS } from "./patterns.data.ts";
import type { Citation } from "./types.ts";

export const EXTRACTOR_VERSION: string = PATTERNS.version;

export type RpcClient = { rpc<T>(name: string, args: Record<string, unknown>): Promise<T> };

/** One citation as citations_load_v2 takes it (engine output; antecedent as page number + sequence on that page). */
export type LoadCitation = {
  seq: number;
  kind: Citation["kind"];
  form: Citation["form"];
  short: Citation["short"];
  short_status: Citation["short_status"];
  start: number;
  end: number;
  matched: string;
  key: string | null;
  normalized: string;
  pin: string | null;
  group: number | null;
  name: string | null;
  antecedent: { page: number; seq: number } | null;
  fields: Record<string, string>;
};
export type LoadPage = { src: "pdf"; src_id: string; page: number; citations: LoadCitation[] };

/** Engine output of one byte set (pages in order) as load rows: one row per page, a page without citations included. */
export function toLoadPages(
  sha256: string,
  pages: { page: number; text: string }[],
  extracted: Citation[][],
): LoadPage[] {
  if (extracted.length !== pages.length)
    throw new Error("extracted pages do not match the input pages");
  return pages.map((p, i) => ({
    src: "pdf",
    src_id: sha256,
    page: p.page,
    citations: extracted[i]!.map((c, seq) => ({
      seq,
      kind: c.kind,
      form: c.form,
      short: c.short,
      short_status: c.short_status,
      start: c.start,
      end: c.end,
      matched: c.matched,
      key: c.key,
      normalized: c.normalized,
      pin: c.pin,
      group: c.group,
      name: c.name ? c.name.text : null,
      antecedent:
        c.antecedent === null
          ? null
          : typeof c.antecedent === "number"
            ? { page: p.page, seq: c.antecedent }
            : { page: pages[c.antecedent.page]!.page, seq: c.antecedent.index },
      fields: c.fields,
    })),
  }));
}

/** Splits load rows into batches citations_load_v2 accepts (at most 400 pages and 15,000 citations each). */
export function loadBatches(rows: LoadPage[], maxPages = 400, maxCitations = 15000): LoadPage[][] {
  const out: LoadPage[][] = [];
  let cur: LoadPage[] = [];
  let n = 0;
  for (const r of rows) {
    if (cur.length && (cur.length >= maxPages || n + r.citations.length > maxCitations)) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(r);
    n += r.citations.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export type NightlyOptions = {
  client: RpcClient;
  trigger: "schedule" | "manual";
  version?: string;
  /** synchronous extraction time per invocation (the edge runtime allows about 2 s of CPU per request) */
  extractBudgetMs?: number;
  /** total time per invocation */
  wallBudgetMs?: number;
  setsPerFetch?: number;
  pagesPerFetch?: number;
  resolveLimit?: number;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
};

export type NightlySummary = {
  run_id: string | null;
  status: "ok" | "partial" | "failed";
  extractor_version: string;
  byte_sets: number;
  pages: number;
  accepted: number;
  rejected: Record<string, number>;
  remaining: number | null;
  resolved: number;
  pending_authorities: number | null;
  documents_linked: number;
  edges: number;
  extract_ms: number;
  stopped_by: "done" | "extract_budget" | "wall_budget" | "repeat" | "error";
  error?: string;
};

type Pending = {
  documents: { sha256: string; pages: { page: number; text: string }[] }[];
  remaining: number;
};
type LoadResult = { pages: number; accepted: number; rejected: Record<string, number> };
type ResolveResult = { resolved_batch: number; pending: number };
type LinkResult = { documents: number; edges: number };

const clean = (e: unknown) =>
  (e instanceof Error ? `${e.name}: ${e.message}` : "unknown error")
    .replace(/(eyJ|sb_secret_|Bearer )[A-Za-z0-9._-]+/g, "[redacted]")
    .slice(0, 400);

export async function runNightly(opts: NightlyOptions): Promise<NightlySummary> {
  const version = opts.version ?? EXTRACTOR_VERSION;
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => {});
  const extractBudget = opts.extractBudgetMs ?? 1200;
  const wallBudget = opts.wallBudgetMs ?? 110_000;
  const started = now();
  const s: NightlySummary = {
    run_id: null,
    status: "failed",
    extractor_version: version,
    byte_sets: 0,
    pages: 0,
    accepted: 0,
    rejected: {},
    remaining: null,
    resolved: 0,
    pending_authorities: null,
    documents_linked: 0,
    edges: 0,
    extract_ms: 0,
    stopped_by: "done",
  };
  const opened = await opts.client.rpc<{ run_id: string }>("citations_open_run_v2", {
    p_kind: "nightly",
    p_trigger: opts.trigger,
    p_version: version,
  });
  s.run_id = opened.run_id;
  log({ step: "open", run_id: s.run_id, version });
  const seen = new Set<string>();
  const loaded: string[] = [];
  try {
    for (;;) {
      if (s.extract_ms >= extractBudget) {
        s.stopped_by = "extract_budget";
        break;
      }
      if (now() - started >= wallBudget * 0.6) {
        s.stopped_by = "wall_budget";
        break;
      }
      const pending = await opts.client.rpc<Pending>("citations_pending_pages_v2", {
        p_version: version,
        p_limit: opts.setsPerFetch ?? 8,
        p_max_pages: opts.pagesPerFetch ?? 200,
      });
      s.remaining = pending.remaining;
      const fresh = pending.documents.filter((d) => !seen.has(d.sha256));
      if (!pending.documents.length) {
        s.stopped_by = "done";
        break;
      }
      if (!fresh.length) {
        s.stopped_by = "repeat";
        break;
      } // a set the loader would not complete: report, do not spin
      const rows: LoadPage[] = [];
      let done = 0;
      for (const d of fresh) {
        seen.add(d.sha256);
        const t0 = now();
        const extracted = extractPages(d.pages.map((p) => p.text));
        s.extract_ms += now() - t0;
        rows.push(...toLoadPages(d.sha256, d.pages, extracted));
        s.byte_sets += 1;
        done += 1;
        if (s.extract_ms >= extractBudget) break;
      }
      for (const batch of loadBatches(rows)) {
        const r = await opts.client.rpc<LoadResult>("citations_load_v2", {
          p_run: s.run_id,
          p_version: version,
          p_pages: batch,
        });
        s.pages += r.pages;
        s.accepted += r.accepted;
        for (const [k, v] of Object.entries(r.rejected ?? {}))
          s.rejected[k] = (s.rejected[k] ?? 0) + v;
      }
      loaded.push(...new Set(rows.map((r) => r.src_id)));
      s.remaining = Math.max(0, pending.remaining - done);
      log({
        step: "load",
        byte_sets: s.byte_sets,
        pages: s.pages,
        accepted: s.accepted,
        extract_ms: Math.round(s.extract_ms),
      });
    }
    for (let i = 0; i < 20; i++) {
      const r = await opts.client.rpc<ResolveResult>("citations_resolve_v2", {
        p_limit: opts.resolveLimit ?? 2000,
        p_run: s.run_id,
      });
      s.resolved += r.resolved_batch;
      s.pending_authorities = r.pending;
      if (r.pending === 0 || r.resolved_batch === 0 || now() - started >= wallBudget * 0.85) break;
    }
    for (let i = 0; i < loaded.length; i += 500) {
      const r = await opts.client.rpc<LinkResult>("citations_link_v2", {
        p_shas: loaded.slice(i, i + 500),
        p_after: "",
        p_limit: 500,
        p_run: s.run_id,
      });
      s.documents_linked += r.documents;
      s.edges += r.edges;
    }
    s.status = s.stopped_by === "done" && s.pending_authorities === 0 ? "ok" : "partial";
    await opts.client.rpc("citations_finish_run_v2", {
      p_run: s.run_id,
      p_status: s.status,
      p_error: null,
      p_notes: {
        remaining: s.remaining,
        stopped_by: s.stopped_by,
        extract_ms: Math.round(s.extract_ms),
        byte_sets: s.byte_sets,
      },
    });
    log({ step: "finish", ...s });
    return s;
  } catch (e) {
    s.status = "failed";
    s.stopped_by = "error";
    s.error = clean(e);
    log({ step: "error", run_id: s.run_id, error: s.error });
    try {
      await opts.client.rpc("citations_finish_run_v2", {
        p_run: s.run_id,
        p_status: "failed",
        p_notes: { stopped_by: "error" },
        p_error: s.error,
      });
    } catch {
      /* the run stays 'running' until citations_open_run_v2 closes it as abandoned */
    }
    return s;
  }
}

export type ServeOptions = {
  env: (name: string) => string | undefined;
  /** EdgeRuntime.waitUntil in the edge runtime; absent in tests (the run is awaited). */
  waitUntil?: (p: Promise<unknown>) => void;
  fetch?: typeof fetch;
  nightly?: Partial<Omit<NightlyOptions, "client" | "trigger">>;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 *   POST /functions/v1/ingest-citations   Authorization: Bearer <trigger secret>
 *   body: { "trigger"?: "schedule" | "manual", "wait"?: boolean }
 * The trigger secret is the ingest one (Vault 'ingest_cron_secret'); the database checks a presented token
 * (public.ingest_check_trigger_v1), so the secret is never copied into a function setting.
 */
export function serveCitations(opts: ServeOptions): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const url = opts.env("SUPABASE_URL");
    const key = opts.env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key)
      return json(503, { error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not available" });
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (token.length < 32) return json(401, { error: "unauthorized" });
    const client = corpusClient({ url, key, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    let allowed: unknown;
    try {
      allowed = await client.rpc<boolean>("ingest_check_trigger_v1", { p_token: token });
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
    const run = runNightly({
      ...opts.nightly,
      client,
      trigger,
      log: (line) => console.log(JSON.stringify(line)),
    }).catch((e: unknown) => {
      // the run could not be opened (another nightly run is running, or the contract is not applied)
      const error = clean(e);
      console.error(JSON.stringify({ step: "run-error", error }));
      return { status: "failed" as const, error };
    });
    if (body["wait"] === true || !opts.waitUntil) {
      const summary = await run;
      return json(summary.status === "failed" ? 500 : 200, summary);
    }
    opts.waitUntil(run);
    return json(202, { accepted: true, trigger, extractor_version: EXTRACTOR_VERSION });
  };
}
