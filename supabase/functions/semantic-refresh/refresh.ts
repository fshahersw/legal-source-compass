/**
 * One run of the scheduled semantic refresh (database side: database/contracts/semantic-refresh-v1.sql).
 *
 *   open run -> detect (title markers, removed Supreme Court cases, rolling sweep, prune of no-op changes)
 *   -> pages of the oldest queued records -> per record: rebuild the document from the pruned source row exactly as
 *      scripts/semantic/sources.py + chunking.py would (sources.ts, chunking.ts), compare with the stored passages
 *   -> embed only passages whose embed key no stored passage or cache entry has, oldest records first, each request
 *      reserved against the daily and global token caps before it is sent and settled to the billed tokens after
 *   -> apply whole records (a record is applied only when every one of its passages has a vector) -> finish run.
 *
 * A record that needs tokens the budget no longer allows stays queued; vectors embedded for it are cached, so the next
 * run spends only what is still missing. Zero-token work (unchanged records, metadata-only changes, removals) continues
 * after the budget stops. Dry run: read-only RPCs only (pending, known keys, status): what a run would do, nothing written.
 *
 * Never logged or returned: the key, record text, embed strings. Logged: counts, stop reasons, record ids of holds.
 */
import {
  chunkDoc,
  chunkEmbedText,
  embedKey,
  estimateTokens,
  sha256Hex,
  snippetOf,
  utf8Length,
} from "../../../src/lib/semantic/chunking.ts";
import { EMBEDDING_INPUT_TYPE, EMBEDDING_MODEL, EmbeddingError, type Embedder } from "./embed.ts";
import { buildDoc, encodeHref, isSourceDataset, type SourceRow } from "./sources.ts";

export type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;

export type StoredPassage = {
  chunk_no: number;
  chunk_total: number;
  char_start: number;
  char_end: number;
  text_sha256: string;
  title: string;
  href: string;
  source_url: string | null;
  snippet: string;
  embed_sha256: string | null;
};

export type PendingItem = {
  dataset: string;
  record_id: string;
  seq: number;
  same: boolean;
  fingerprint: string | null;
  reason?: string;
  first_seen_at?: string;
  missing_since?: string | null;
  attempts?: number;
  source?: SourceRow | null;
  source_ready?: boolean | null;
  ledger?: {
    state: "indexed" | "no_doc";
    doc_sha256: string | null;
    chunks: number;
    fingerprint?: string;
  } | null;
  stored?: StoredPassage[];
  stored_count?: number;
};
export type PendingPage = { items: PendingItem[]; next: unknown; more: boolean };

export type NewPassage = Omit<StoredPassage, "embed_sha256"> & { embed_sha256: string };

export type Plan =
  | { kind: "unchanged"; item: PendingItem; state: "indexed" | "no_doc"; doc_sha256: string | null }
  | {
      kind: "index";
      item: PendingItem;
      rows: NewPassage[];
      texts: Map<string, string>;
      doc_sha256: string;
      drift: boolean;
      added: boolean;
    }
  | { kind: "no_doc"; item: PendingItem }
  | { kind: "remove"; item: PendingItem }
  | { kind: "defer"; item: PendingItem }
  | { kind: "hold"; item: PendingItem; reason: string }
  | { kind: "error"; item: PendingItem; reason: string };

export type RunSettings = {
  datasets: string[];
  daily_token_cap: number;
  total_token_cap: number;
  max_records_per_run: number;
  max_seconds_per_run: number;
  max_cpu_ms_per_run: number;
  page_records: number;
  removal_grace_seconds: number;
  drift_guard: number;
  reembed_unseeded: boolean;
  max_request_inputs: number;
  max_request_reserve: number;
};

export type Usage = {
  today: number;
  total: number;
  daily_cap: number;
  total_cap: number;
  daily_remaining: number;
  total_remaining: number;
  seeded: boolean;
};

/** Upper bound of the tokens one input can be billed: one per UTF-8 byte plus a margin for special tokens. */
export function reserveFor(text: string): number {
  return utf8Length(text) + 8;
}

function samePassages(rows: NewPassage[], stored: StoredPassage[]): boolean {
  if (rows.length !== stored.length) return false;
  return rows.every((r, i) => {
    const s = stored[i]!;
    return (
      s.chunk_no === r.chunk_no &&
      s.chunk_total === r.chunk_total &&
      s.char_start === r.char_start &&
      s.char_end === r.char_end &&
      s.text_sha256 === r.text_sha256 &&
      s.embed_sha256 === r.embed_sha256 &&
      s.title === r.title &&
      s.href === r.href &&
      (s.source_url ?? null) === (r.source_url ?? null) &&
      s.snippet === r.snippet
    );
  });
}

function removalPlan(item: PendingItem, settings: RunSettings, nowMs: number): Plan {
  if (item.source_ready !== true)
    return { kind: "hold", item, reason: "source_collection_not_ready" };
  const missing = item.missing_since ? Date.parse(item.missing_since) : NaN;
  if (Number.isNaN(missing) || nowMs - missing < settings.removal_grace_seconds * 1000)
    return { kind: "defer", item };
  return { kind: "remove", item };
}

/** What to do with one queued record (pure apart from hashing). */
export async function planRecord(
  item: PendingItem,
  settings: RunSettings,
  nowMs: number,
): Promise<Plan> {
  if (item.same)
    return {
      kind: "unchanged",
      item,
      state: item.ledger?.state ?? "indexed",
      doc_sha256: item.ledger?.doc_sha256 ?? null,
    };
  if (item.dataset === "caselaw_scotus") {
    // the case-law reading store is a dated snapshot: an opinion is only ever confirmed present or removed
    if (item.source) return { kind: "unchanged", item, state: "indexed", doc_sha256: null };
    return removalPlan(item, settings, nowMs);
  }
  if (!isSourceDataset(item.dataset))
    return { kind: "hold", item, reason: "dataset_not_rebuildable" };
  if (!item.source) return removalPlan(item, settings, nowMs);
  let doc;
  try {
    doc = buildDoc(item.dataset, item.source);
  } catch (error) {
    return {
      kind: "error",
      item,
      reason: `document build failed (${error instanceof Error ? error.message.slice(0, 80) : "error"})`,
    };
  }
  if (!doc) return { kind: "no_doc", item };
  const chunks = chunkDoc(doc);
  if (!chunks.length) return { kind: "no_doc", item };
  const texts = new Map<string, string>();
  const rows: NewPassage[] = [];
  for (const c of chunks) {
    const et = chunkEmbedText(c);
    const key = await embedKey(et, EMBEDDING_MODEL, EMBEDDING_INPUT_TYPE);
    texts.set(key, et);
    rows.push({
      chunk_no: c.chunk_no,
      chunk_total: c.chunk_total,
      char_start: c.start,
      char_end: c.end,
      text_sha256: await sha256Hex(c.body),
      embed_sha256: key,
      title: c.title,
      href: encodeHref(c.href),
      source_url: c.source_url,
      snippet: snippetOf(c.body),
    });
  }
  // the table's own checks (semantic-v1.sql): a row that would be refused is an error for this record, never for the batch
  const bad = rows.find(
    (r) => !/^\/[^/]/.test(r.href) || (r.source_url !== null && !/^https?:\/\//.test(r.source_url)),
  );
  if (bad || item.record_id.length > 300)
    return {
      kind: "error",
      item,
      reason: "passage fields refused by the index (link, source URL or id)",
    };
  const docSha = await sha256Hex(
    JSON.stringify([
      doc.dataset,
      doc.record_id,
      doc.title,
      doc.heading,
      doc.text,
      doc.href,
      doc.source_url,
      doc.max_chunks,
    ]),
  );
  const stored = item.stored ?? [];
  if (samePassages(rows, stored))
    return { kind: "unchanged", item, state: "indexed", doc_sha256: docSha };
  if (
    !settings.reembed_unseeded &&
    stored.some((s) => s.embed_sha256 === null && rows.some((r) => r.text_sha256 === s.text_sha256))
  )
    return { kind: "hold", item, reason: "keys_not_seeded" };
  const drift =
    stored.length === rows.length &&
    stored.every((s) => s.embed_sha256 !== null) &&
    rows.every((r, i) => {
      const s = stored[i]!;
      return (
        s.chunk_total === r.chunk_total &&
        s.char_start === r.char_start &&
        s.char_end === r.char_end &&
        s.text_sha256 === r.text_sha256
      );
    }) &&
    rows.some((r, i) => r.embed_sha256 !== stored[i]!.embed_sha256);
  return {
    kind: "index",
    item,
    rows,
    texts,
    doc_sha256: docSha,
    drift,
    added: stored.length === 0,
  };
}

// ------------------------------------------------------------------------------------------------------------ the run
export type RunDeps = {
  rpc: Rpc;
  /** null when the embedding key is not configured: zero-token work still runs. */
  embedder: Embedder | null;
  trigger: "schedule" | "manual" | "local";
  dryRun?: boolean;
  now?: () => number;
  /** Clock for the CPU budget (synchronous work: chunking, hashing, payloads). */
  cpuNow?: () => number;
  log?: (line: Record<string, unknown>) => void;
  /** Overrides of the run bounds (the local runner raises them; the edge function uses the stored settings). */
  limits?: Partial<
    Pick<
      RunSettings,
      "max_records_per_run" | "max_seconds_per_run" | "max_cpu_ms_per_run" | "page_records"
    >
  >;
  /** Dry run only: the bounds to use (no run is opened, so the stored settings are read from the status RPC). */
  datasets?: string[];
};

export type Counts = Record<string, Record<string, number>>;

export type RunSummary = {
  runId: string | null;
  trigger: string;
  dryRun: boolean;
  status: "ok" | "partial" | "failed" | "skipped";
  skipped?: string;
  stopReason: string;
  embeddingStop: string | null;
  detect: Record<string, unknown> | null;
  pages: number;
  records: number;
  plans: Counts;
  applied: Counts;
  unknownKeys: number;
  embeddedInputs: number;
  tokens: number;
  requests: number;
  reservedUpperBound: number;
  estimatedTokens: number;
  holds: { dataset: string; record_id: string; reason: string }[];
  usage: Usage | null;
  error: string | null;
};

function bump(c: Counts, dataset: string, key: string, n = 1) {
  const d = (c[dataset] ??= {});
  d[key] = (d[key] ?? 0) + n;
}

function mergeCounts(into: Counts, from: Counts | undefined) {
  for (const [d, kv] of Object.entries(from ?? {}))
    for (const [k, n] of Object.entries(kv)) bump(into, d, k, n);
}

type ApplyRecord = Record<string, unknown>;

function decision(
  p: Plan,
  known: Set<string>,
  holdReason: string | null,
  tooLarge: Set<string> = new Set(),
): ApplyRecord | null {
  const base = { dataset: p.item.dataset, record_id: p.item.record_id, seq: p.item.seq };
  switch (p.kind) {
    case "unchanged":
      return {
        ...base,
        action: "unchanged",
        fingerprint: p.item.fingerprint,
        state: p.state,
        doc_sha256: p.doc_sha256,
      };
    case "index": {
      const missing = p.rows.some((r) => !known.has(r.embed_sha256));
      if (missing && p.rows.some((r) => tooLarge.has(r.embed_sha256)))
        return { ...base, action: "hold", reason: "input_too_large" };
      if (missing) return { ...base, action: "hold", reason: holdReason ?? "vectors_pending" };
      return {
        ...base,
        action: "index",
        fingerprint: p.item.fingerprint,
        doc_sha256: p.doc_sha256,
        rows: p.rows,
      };
    }
    case "no_doc":
      return { ...base, action: "no_doc", fingerprint: p.item.fingerprint };
    case "remove":
      return { ...base, action: "remove" };
    case "defer":
      return { ...base, action: "defer" };
    case "hold":
      return { ...base, action: "hold", reason: p.reason };
    case "error":
      return { ...base, action: "error", reason: p.reason };
  }
}

/** Apply payloads in calls of at most 150 records, 3,000 passages and about 4 MB. */
function applyBatches(records: ApplyRecord[]): ApplyRecord[][] {
  const out: ApplyRecord[][] = [];
  let cur: ApplyRecord[] = [];
  let rows = 0;
  let bytes = 0;
  for (const r of records) {
    const n = Array.isArray(r["rows"]) ? (r["rows"] as unknown[]).length : 0;
    const b = JSON.stringify(r).length;
    if (cur.length && (cur.length >= 150 || rows + n > 3000 || bytes + b > 4_000_000)) {
      out.push(cur);
      cur = [];
      rows = 0;
      bytes = 0;
    }
    cur.push(r);
    rows += n;
    bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function runRefresh(deps: RunDeps): Promise<RunSummary> {
  const now = deps.now ?? (() => Date.now());
  const cpuNow = deps.cpuNow ?? (() => (globalThis.performance ? performance.now() : Date.now()));
  const log = deps.log ?? (() => undefined);
  const dry = deps.dryRun === true;
  const t0 = now();
  const summary: RunSummary = {
    runId: null,
    trigger: deps.trigger,
    dryRun: dry,
    status: "ok",
    stopReason: "complete",
    embeddingStop: null,
    detect: null,
    pages: 0,
    records: 0,
    plans: {},
    applied: {},
    unknownKeys: 0,
    embeddedInputs: 0,
    tokens: 0,
    requests: 0,
    reservedUpperBound: 0,
    estimatedTokens: 0,
    holds: [],
    usage: null,
    error: null,
  };

  let settings: RunSettings;
  let usage: Usage;
  if (dry) {
    const status = await deps.rpc<{
      settings: RunSettings & { removal_grace: string };
      usage: Usage;
    }>("semantic_refresh_status_v1", {});
    settings = {
      ...status.settings,
      removal_grace_seconds: parseInterval(status.settings.removal_grace),
    };
    usage = status.usage;
  } else {
    const opened = await deps.rpc<{
      run_id?: string;
      skipped?: string;
      settings: RunSettings;
      usage: Usage;
    }>("semantic_refresh_open_run_v1", { p_trigger: deps.trigger });
    if (opened.skipped) {
      summary.status = "skipped";
      summary.skipped = opened.skipped;
      summary.stopReason = opened.skipped;
      return summary;
    }
    summary.runId = String(opened.run_id);
    settings = opened.settings;
    usage = opened.usage;
  }
  settings = { ...settings, ...(deps.limits ?? {}) };
  summary.usage = usage;
  const runId = summary.runId;
  let cpuMs = 0;

  try {
    if (!dry) {
      summary.detect = await deps.rpc<Record<string, unknown>>("semantic_refresh_detect_v1", {
        p_run: runId,
      });
      log({ step: "detected", ...summary.detect });
    }
    let cursor: unknown = null;
    let driftRecords = 0;
    const embeddedKnown = new Set<string>();
    const tooLarge = new Set<string>();
    // One record the database refuses must not block every run: a refused call is split until the refused record is
    // alone, and that record is recorded as an error (it moves behind the others after three attempts).
    const applySafely = async (batch: ApplyRecord[]): Promise<void> => {
      try {
        const res = await deps.rpc<{ counts: Counts }>("semantic_refresh_apply_v1", {
          p_run: runId,
          p_records: batch,
        });
        mergeCounts(summary.applied, res.counts);
      } catch (error) {
        const status = (error as { status?: number }).status ?? 0;
        if (error instanceof Error && /run is not open/.test(error.message)) throw error;
        if (
          status < 400 ||
          status >= 500 ||
          (batch.length === 1 && batch[0]!["action"] === "error")
        )
          throw error;
        if (batch.length === 1) {
          const r = batch[0]!;
          const message = error instanceof Error ? error.message.slice(0, 200) : "refused";
          log({ step: "apply-refused", dataset: r["dataset"], record_id: r["record_id"] });
          await applySafely([
            {
              dataset: r["dataset"],
              record_id: r["record_id"],
              seq: r["seq"],
              action: "error",
              reason: `apply refused: ${message}`,
            },
          ]);
          return;
        }
        const mid = Math.ceil(batch.length / 2);
        await applySafely(batch.slice(0, mid));
        await applySafely(batch.slice(mid));
      }
    };
    let dailyRemaining = usage.daily_remaining;
    let totalRemaining = usage.total_remaining;
    for (;;) {
      if (now() - t0 > settings.max_seconds_per_run * 1000) {
        summary.stopReason = "time_budget";
        break;
      }
      if (summary.records >= settings.max_records_per_run) {
        summary.stopReason = "record_budget";
        break;
      }
      if (cpuMs > settings.max_cpu_ms_per_run) {
        summary.stopReason = "cpu_budget";
        break;
      }
      const page = await deps.rpc<PendingPage>("semantic_refresh_pending_v1", {
        p_after: cursor,
        p_limit: Math.min(settings.page_records, settings.max_records_per_run - summary.records),
        p_max_bytes: 6_000_000,
        p_datasets: deps.datasets ?? null,
      });
      if (!page.items.length) break;
      summary.pages += 1;
      summary.records += page.items.length;

      // decide every record of the page
      const c0 = cpuNow();
      const plans: Plan[] = [];
      for (const item of page.items) plans.push(await planRecord(item, settings, now()));
      cpuMs += cpuNow() - c0;
      for (const p of plans)
        bump(summary.plans, p.item.dataset, p.kind === "index" && p.added ? "add" : p.kind);

      // which new passages need a request: neither the record's own stored passages nor any other stored passage/cache
      const indexPlans = plans.filter(
        (p): p is Extract<Plan, { kind: "index" }> => p.kind === "index",
      );
      const candidate = new Set<string>();
      for (const p of indexPlans) {
        const own = new Set(
          (p.item.stored ?? []).map((s) => s.embed_sha256).filter((k): k is string => !!k),
        );
        for (const r of p.rows)
          if (!own.has(r.embed_sha256) && !embeddedKnown.has(r.embed_sha256))
            candidate.add(r.embed_sha256);
      }
      const known = new Set<string>(embeddedKnown);
      for (const p of indexPlans)
        for (const s of p.item.stored ?? []) if (s.embed_sha256) known.add(s.embed_sha256);
      const list = [...candidate];
      for (let i = 0; i < list.length; i += 4000) {
        const got = await deps.rpc<string[]>("semantic_refresh_known_keys_v1", {
          p_keys: list.slice(i, i + 4000),
        });
        for (const k of got ?? []) known.add(k);
      }
      // own stored keys are reusable only for the record itself until it is applied; the database resolves them by key
      // anyway, so they count as known here

      // heading-drift guard: re-embedding passages whose text is unchanged (a heading changed) is capped per run
      const finalPlans: Plan[] = plans.map((p) => {
        if (p.kind !== "index" || !p.drift || p.rows.every((r) => known.has(r.embed_sha256)))
          return p;
        driftRecords += 1;
        if (driftRecords > settings.drift_guard)
          return { kind: "hold", item: p.item, reason: "heading_drift_guard" };
        return p;
      });

      // embed what is missing, oldest records first, within the token caps
      const need: { key: string; text: string; dataset: string }[] = [];
      const seen = new Set<string>();
      for (const p of finalPlans) {
        if (p.kind !== "index") continue;
        for (const r of p.rows) {
          if (known.has(r.embed_sha256) || seen.has(r.embed_sha256)) continue;
          seen.add(r.embed_sha256);
          need.push({
            key: r.embed_sha256,
            text: p.texts.get(r.embed_sha256)!,
            dataset: p.item.dataset,
          });
        }
      }
      summary.unknownKeys += need.length;
      for (const n of need) {
        summary.reservedUpperBound += reserveFor(n.text);
        summary.estimatedTokens += estimateTokens(n.text);
      }
      if (need.length && !dry && summary.embeddingStop === null && !deps.embedder)
        summary.embeddingStop = "embedding_key_missing";
      let at = 0;
      while (!dry && summary.embeddingStop === null && at < need.length) {
        if (now() - t0 > settings.max_seconds_per_run * 1000) {
          summary.embeddingStop = "time_budget";
          break;
        }
        const limit = Math.min(settings.max_request_reserve, dailyRemaining, totalRemaining);
        const batch: typeof need = [];
        let reserve = 0;
        while (at < need.length && batch.length < settings.max_request_inputs) {
          const r = reserveFor(need[at]!.text);
          if (r > settings.max_request_reserve) {
            tooLarge.add(need[at]!.key); // never sendable within the request bound: its record is held
            at += 1;
            continue;
          }
          if (reserve + r > limit) break;
          batch.push(need[at]!);
          reserve += r;
          at += 1;
        }
        if (!batch.length) {
          if (at >= need.length) break; // only inputs too large for one request were left
          summary.embeddingStop = totalRemaining < dailyRemaining ? "total_cap" : "daily_cap";
          break;
        }
        const res = await deps.rpc<
          Usage & { ok: boolean; reason?: string; reservation_id: number | null }
        >("semantic_refresh_reserve_v1", {
          p_run: runId,
          p_dataset: batch[0]!.dataset,
          p_reserve: reserve,
          p_inputs: batch.length,
        });
        dailyRemaining = res.daily_remaining;
        totalRemaining = res.total_remaining;
        if (!res.ok || res.reservation_id === null) {
          summary.embeddingStop = res.reason ?? "reservation_refused";
          break;
        }
        let out;
        try {
          out = await deps.embedder!.embed(batch.map((b) => b.text));
        } catch (error) {
          const billedUnknown = !(error instanceof EmbeddingError) || error.billed === "unknown";
          await deps.rpc("semantic_refresh_settle_v1", {
            p_reservation: res.reservation_id,
            p_tokens: billedUnknown ? null : 0,
          });
          summary.embeddingStop = "embedding_failed";
          log({
            step: "embedding-failed",
            status: error instanceof EmbeddingError ? error.status : 0,
            billed: billedUnknown ? "unknown" : "no",
          });
          break;
        }
        const settled = await deps.rpc<Usage & { overrun: boolean; tokens: number }>(
          "semantic_refresh_settle_v1",
          {
            p_reservation: res.reservation_id,
            p_tokens: out.tokens,
          },
        );
        dailyRemaining = settled.daily_remaining;
        totalRemaining = settled.total_remaining;
        summary.tokens += out.tokens;
        summary.requests += 1;
        summary.embeddedInputs += batch.length;
        const c1 = cpuNow();
        const rows = batch.map((b, i) => ({ k: b.key, v: out.vectors[i]! }));
        cpuMs += cpuNow() - c1;
        await deps.rpc("semantic_refresh_cache_vectors_v1", { p_run: runId, p_rows: rows });
        for (const b of batch) {
          known.add(b.key);
          embeddedKnown.add(b.key);
        }
        log({
          step: "embedded",
          inputs: batch.length,
          tokens: out.tokens,
          daily_remaining: dailyRemaining,
        });
        if (settled.overrun) summary.embeddingStop = "reservation_overrun";
      }

      // apply
      const records: ApplyRecord[] = [];
      for (const p of finalPlans) {
        if (p.kind === "hold" && summary.holds.length < 50)
          summary.holds.push({
            dataset: p.item.dataset,
            record_id: p.item.record_id,
            reason: p.reason,
          });
        const d = decision(p, known, summary.embeddingStop ?? (dry ? "dry_run" : null), tooLarge);
        if (d) records.push(d);
      }
      if (!dry) {
        for (const batch of applyBatches(records)) await applySafely(batch);
      }
      log({
        step: "page",
        page: summary.pages,
        records: page.items.length,
        unknown_keys: need.length,
        embedding_stop: summary.embeddingStop,
      });
      cursor = page.next;
      if (!page.more) break;
    }
    if (!dry) {
      const status =
        summary.stopReason === "complete" && summary.embeddingStop === null ? "ok" : "partial";
      const finished = await deps.rpc<{ usage: Usage }>("semantic_refresh_finish_run_v1", {
        p_run: runId,
        p_status: status,
        p_stop_reason: summary.embeddingStop ?? summary.stopReason,
        p_notes: {
          pages: summary.pages,
          records: summary.records,
          plans: summary.plans,
          unknown_keys: summary.unknownKeys,
          embedding_stop: summary.embeddingStop,
          stop: summary.stopReason,
          holds: summary.holds.slice(0, 20),
          cpu_ms: Math.round(cpuMs),
        },
        p_error: null,
      });
      summary.status = status;
      summary.usage = finished.usage;
    } else {
      summary.status = summary.stopReason === "complete" ? "ok" : "partial";
    }
  } catch (error) {
    summary.status = "failed";
    summary.error =
      error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "unknown error";
    if (!dry && runId) {
      try {
        await deps.rpc("semantic_refresh_finish_run_v1", {
          p_run: runId,
          p_status: "failed",
          p_stop_reason: "error",
          p_notes: { pages: summary.pages, records: summary.records, plans: summary.plans },
          p_error: summary.error,
        });
      } catch {
        /* the run is closed as abandoned by the next open */
      }
    }
  }
  log({
    step: "finished",
    status: summary.status,
    stop: summary.stopReason,
    embedding_stop: summary.embeddingStop,
    tokens: summary.tokens,
    records: summary.records,
  });
  return summary;
}

/** Postgres interval text ("20:00:00", "1 day 02:00:00") as seconds (dry run reads the stored setting). */
export function parseInterval(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return 0;
  let s = 0;
  const day = /(-?\d+) days?/.exec(v);
  if (day) s += Number(day[1]) * 86400;
  const hms = /(-?\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(v);
  if (hms) s += Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  return s;
}
