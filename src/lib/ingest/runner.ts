/**
 * One run of one source: open the run (ingest_open_run_v1), read the source within its request budget, compare with the
 * stored rows, write only new and changed rows in ordered batches (ingest_upsert_v1), close the run with its cursor
 * (ingest_finish_run_v1), then ask the insights layer to refresh (ingest_refresh_insights_v1).
 *
 * Dry run: no RPC writes at all — the same reading and comparison, reported as would-insert / would-update / unchanged.
 */
import type { CorpusClient } from "./corpus.ts";
import { politeHttp } from "./http.ts";
import { batchesFor, boundBatches, classify, diffPaths } from "./rows.ts";
import type {
  Collected,
  CorpusRow,
  Json,
  JsonObject,
  RunSummary,
  SourceAdapter,
  SourceHttp,
  StoredRow,
} from "./types.ts";

export type RunDeps = {
  corpus: CorpusClient;
  env: (name: string) => string | undefined;
  dryRun: boolean;
  trigger?: "schedule" | "manual";
  now?: Date;
  fetch?: typeof fetch;
  http?: SourceHttp;
  batchSize?: number;
  /** Dry run only: cursor to start from (the stored cursor is not readable without the RPCs). */
  cursor?: Json;
  log?: (line: JsonObject) => void;
};

export type DryRunDetail = {
  inserts: { id: string; title: string }[];
  updates: { id: string; title: string; changed: string[] }[];
};

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : "unknown error";
}

function countReasons(held: Collected["held"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of held) out[h.reason] = (out[h.reason] ?? 0) + 1;
  return out;
}

async function storedFor(
  deps: RunDeps,
  adapter: SourceAdapter,
  collected: Collected,
): Promise<StoredRow[]> {
  const by = collected.matchBy ?? "id";
  const keys = collected.rows.map((r) => (by === "id" ? r.id : r.source_url));
  return keys.length ? deps.corpus.rowsBy(adapter.dataset, by, keys) : [];
}

export async function runSource(
  adapter: SourceAdapter,
  deps: RunDeps,
): Promise<RunSummary & { detail?: DryRunDetail }> {
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? new Date();
  const summary: RunSummary & { detail?: DryRunDetail } = {
    source: adapter.source,
    dataset: adapter.dataset,
    dryRun: deps.dryRun,
    runId: null,
    status: "ok",
    fetched: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    held: 0,
    heldReasons: {},
    error: null,
    cursorBefore: deps.cursor ?? null,
    cursorAfter: null,
    requests: 0,
    notes: {},
    insightsRefresh: null,
  };

  let runId: string | null = null;
  if (!deps.dryRun) {
    const opened = await deps.corpus.call<JsonObject>("ingest_open_run_v1", {
      p_source: adapter.source,
      p_trigger: deps.trigger ?? "schedule",
    });
    if (typeof opened["skipped"] === "string") {
      summary.status = "skipped";
      summary.skipped = opened["skipped"];
      return summary;
    }
    runId = String(opened["run_id"]);
    summary.runId = runId;
    summary.cursorBefore = (opened["cursor"] as Json) ?? null;
  }

  const http =
    deps.http ??
    politeHttp({
      maxRequests: adapter.limits.maxRequests,
      minIntervalMs: adapter.limits.minIntervalMs,
      fetch: deps.fetch,
    });
  let written = 0;
  let comparedUnchanged = 0;
  try {
    const collected = await adapter.collect({
      http,
      corpus: deps.corpus,
      cursor: summary.cursorBefore,
      now,
      env: deps.env,
    });
    comparedUnchanged = collected.preUnchanged ?? 0;
    summary.fetched = collected.fetched;
    summary.held = collected.held.length;
    summary.heldReasons = countReasons(collected.held);
    summary.cursorAfter = collected.cursorAfter;
    summary.notes = { ...collected.notes };
    if (!collected.complete) summary.status = "partial";
    log({
      step: "collected",
      source: adapter.source,
      fetched: collected.fetched,
      candidates: collected.rows.length,
      held: collected.held.length,
      complete: collected.complete,
    });

    const stored = await storedFor(deps, adapter, collected);
    const result = classify(adapter, collected.rows, stored, collected.matchBy ?? "id");
    comparedUnchanged += result.unchanged + result.alreadyHeld;
    summary.unchanged = comparedUnchanged;
    if (result.alreadyHeld) summary.notes["already_held"] = result.alreadyHeld;
    const send = new Set<CorpusRow>([...result.inserts, ...result.updates]);
    const ordered = collected.rows.filter((r) => send.has(r));

    if (deps.dryRun) {
      summary.inserted = result.inserts.length;
      summary.updated = result.updates.length;
      const byKey = new Map(
        stored.map((s) => [(collected.matchBy ?? "id") === "id" ? s.id : s.source_url, s]),
      );
      summary.detail = {
        inserts: result.inserts.map((r) => ({ id: r.id, title: r.title.slice(0, 120) })),
        updates: result.updates.map((r) => {
          const cur = byKey.get((collected.matchBy ?? "id") === "id" ? r.id : r.source_url);
          return {
            id: r.id,
            title: r.title.slice(0, 120),
            changed: cur ? diffPaths(adapter.comparable(cur), adapter.comparable(r), 8) : [],
          };
        }),
      };
      summary.requests = http.requests.length;
      return summary;
    }

    for (const batch of boundBatches(
      batchesFor(ordered, adapter.ordinalPolicy, deps.batchSize ?? 200),
      adapter.ordinalPolicy,
    )) {
      const res = await deps.corpus.call<JsonObject>("ingest_upsert_v1", {
        p_run: runId,
        p_rows: batch,
      });
      written += batch.length;
      summary.inserted += Number(res["inserted"] ?? 0);
      summary.updated += Number(res["updated"] ?? 0);
      summary.unchanged += Number(res["unchanged"] ?? 0);
      summary.held += Number(res["held"] ?? 0);
      log({ step: "batch", source: adapter.source, rows: batch.length, result: res });
    }
    const note =
      summary.inserted > 0 && adapter.catalogNote
        ? adapter.catalogNote(collected, runId!, now)
        : null;
    if (note)
      summary.notes["catalog_note"] = await deps.corpus.call<Json>("ingest_catalog_note_v1", {
        p_run: runId,
        p_note: note,
      });
  } catch (error) {
    summary.error = errorText(error);
    // rows already written stay (they are complete rows); the cursor is not advanced, so the next run re-reads the window
    summary.status = written > 0 ? "partial" : "failed";
    summary.cursorAfter = summary.cursorBefore;
    log({ step: "error", source: adapter.source, error: summary.error, written });
    if (deps.dryRun) {
      summary.requests = http.requests.length;
      return summary;
    }
  }

  summary.requests = http.requests.length;
  const finished = await deps.corpus.call<JsonObject>("ingest_finish_run_v1", {
    p_run: runId,
    p_status: summary.status,
    p_fetched: summary.fetched,
    p_held:
      summary.status === "failed"
        ? 0
        : Object.values(summary.heldReasons).reduce((a, b) => a + b, 0),
    p_unchanged: summary.status === "failed" ? 0 : comparedUnchanged,
    p_cursor_after: summary.cursorAfter,
    p_error: summary.error,
    p_requests: http.requests,
    p_notes: { ...summary.notes, held_reasons: summary.heldReasons },
  });
  // the database's counts are the record of the run
  summary.inserted = Number(finished["inserted"] ?? summary.inserted);
  summary.updated = Number(finished["updated"] ?? summary.updated);
  summary.unchanged = Number(finished["unchanged"] ?? summary.unchanged);
  summary.held = Number(finished["held"] ?? summary.held);
  try {
    summary.insightsRefresh = await deps.corpus.call<Json>("ingest_refresh_insights_v1", {
      p_run: runId,
    });
  } catch (error) {
    summary.insightsRefresh = { status: "failed", error: errorText(error).slice(0, 300) };
  }
  log({
    step: "finished",
    source: adapter.source,
    status: summary.status,
    inserted: summary.inserted,
    updated: summary.updated,
  });
  return summary;
}
