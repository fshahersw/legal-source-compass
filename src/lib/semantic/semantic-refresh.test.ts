/**
 * Unit tests of the scheduled semantic refresh (supabase/functions/semantic-refresh): change detection per record, the
 * budget guard and its failure modes, the embedding client and the HTTP handler. The database and the embedding service
 * are fakes; the SQL side is exercised end to end by scripts/semantic/semantic-refresh-sql.test.mjs.
 */
import { describe, expect, it } from "vitest";
import golden from "./fixtures/chunk-golden.json";
import sampleRows from "./fixtures/semantic-rows.json";
import {
  holdSeconds,
  planRecord,
  reserveFor,
  runRefresh,
  type PendingItem,
  type Rpc,
  type RunSettings,
  type StoredPassage,
} from "../../../supabase/functions/semantic-refresh/refresh";
import {
  EmbeddingError,
  embeddingClient,
  halfvecLiteral,
  type Embedder,
} from "../../../supabase/functions/semantic-refresh/embed";
import { serveRefresh } from "../../../supabase/functions/semantic-refresh/serve";
import type { SourceRow } from "../../../supabase/functions/semantic-refresh/sources";

type GRow = {
  dataset: string;
  id: string;
  rule: string;
  pruned: SourceRow;
  pruned_has_text: boolean;
  doc: { title: string; href: string; source_url: string | null } | null;
  chunks: {
    chunk_no: number;
    chunk_total: number;
    start: number;
    end: number;
    text_sha256: string;
    embed_key: string;
    snippet: string;
  }[];
};
const ROWS = (golden as unknown as { rows: GRow[] }).rows;
const INPUT = (sampleRows as unknown as { rows: SourceRow[] }).rows;

const SETTINGS: RunSettings = {
  datasets: [
    "us_code_sections",
    "ecfr_sections_full",
    "crs_reports",
    "congress_bills",
    "oversight_reports",
    "doj_oig_reports",
    "ftc_publications_index",
    "caselaw_scotus",
  ],
  daily_token_cap: 250000,
  total_token_cap: 400000000,
  max_records_per_run: 600,
  max_seconds_per_run: 110,
  max_cpu_ms_per_run: 60000,
  page_records: 200,
  removal_grace_seconds: 72000,
  drift_guard: 200,
  reembed_unseeded: false,
  max_request_inputs: 64,
  max_request_reserve: 60000,
};

function row(rule: string, dataset?: string): GRow {
  return ROWS.find((r) => r.rule === rule && (!dataset || r.dataset === dataset))!;
}
function sourceOf(g: GRow): SourceRow {
  const input = INPUT.find((x) => x["dataset"] === g.dataset && x["id"] === g.id)!;
  return g.pruned_has_text ? { ...g.pruned, text: input["text"] ?? null } : { ...g.pruned };
}
function storedOf(g: GRow): StoredPassage[] {
  return g.chunks.map((c) => ({
    chunk_no: c.chunk_no,
    chunk_total: c.chunk_total,
    char_start: c.start,
    char_end: c.end,
    text_sha256: c.text_sha256,
    title: g.doc!.title,
    href: g.doc!.href,
    source_url: g.doc!.source_url,
    snippet: c.snippet,
    embed_sha256: c.embed_key,
  }));
}
function item(g: GRow, extra: Partial<PendingItem> = {}): PendingItem {
  return {
    dataset: g.dataset,
    record_id: g.id,
    seq: 1,
    same: false,
    fingerprint: "f".repeat(64),
    source: sourceOf(g),
    source_ready: true,
    stored: g.doc ? storedOf(g) : [],
    ledger: null,
    ...extra,
  };
}
const NOW = Date.parse("2026-10-25T06:40:00Z");

describe("planRecord: what changed", () => {
  it("a record identical to what the batch build stored is unchanged", async () => {
    for (const g of ROWS.filter((r) => r.doc))
      expect((await planRecord(item(g), SETTINGS, NOW)).kind, g.id).toBe("unchanged");
  });

  it("a new record is indexed with every passage's key", async () => {
    const g = row("multi_chunk");
    const p = await planRecord(item(g, { stored: [] }), SETTINGS, NOW);
    expect(p.kind).toBe("index");
    if (p.kind !== "index") return;
    expect(p.added).toBe(true);
    expect(p.rows.map((r) => r.embed_sha256)).toEqual(g.chunks.map((c) => c.embed_key));
    expect(p.texts.size).toBe(new Set(g.chunks.map((c) => c.embed_key)).size);
  });

  it("a metadata-only change keeps every key (no tokens), a text change adds new keys", async () => {
    const g = row("first", "crs_reports");
    const meta = await planRecord(
      item(g, { source: { ...sourceOf(g), source_url: "https://www.congress.gov/x" } }),
      SETTINGS,
      NOW,
    );
    expect(meta.kind).toBe("index");
    if (meta.kind === "index")
      expect(meta.rows.map((r) => r.embed_sha256)).toEqual(g.chunks.map((c) => c.embed_key));
    const m = row("multi_chunk");
    const src = sourceOf(m);
    const changed = await planRecord(
      item(m, { source: { ...src, text: `${String(src["text"])}\n(z) Added.` } }),
      SETTINGS,
      NOW,
    );
    expect(changed.kind).toBe("index");
    if (changed.kind !== "index") return;
    const old = new Set(m.chunks.map((c) => c.embed_key));
    expect(changed.rows.filter((r) => !old.has(r.embed_sha256))).toHaveLength(1);
    expect(changed.drift).toBe(false);
  });

  it("a heading-only change is drift (same text, new keys)", async () => {
    const g = row("first", "ecfr_sections_full");
    const p = await planRecord(
      item(g, { source: { ...sourceOf(g), title: "1 CFR 1.1 Renamed." } }),
      SETTINGS,
      NOW,
    );
    expect(p.kind).toBe("index");
    if (p.kind === "index") expect(p.drift).toBe(true);
  });

  it("a record whose builder yields no document is no_doc", async () => {
    expect((await planRecord(item(row("reserved")), SETTINGS, NOW)).kind).toBe("no_doc");
    const g = row("first", "ecfr_sections_full");
    expect(
      (await planRecord(item(g, { source: { ...sourceOf(g), text: "  \n " } }), SETTINGS, NOW))
        .kind,
    ).toBe("no_doc");
  });

  it("a missing source waits for the grace period and a ready collection before removal", async () => {
    const g = row("first", "doj_oig_reports");
    const recent = new Date(NOW - 3600_000).toISOString();
    const old = new Date(NOW - 21 * 3600_000).toISOString();
    expect(
      (await planRecord(item(g, { source: null, missing_since: null }), SETTINGS, NOW)).kind,
    ).toBe("defer");
    expect(
      (await planRecord(item(g, { source: null, missing_since: recent }), SETTINGS, NOW)).kind,
    ).toBe("defer");
    expect(
      (await planRecord(item(g, { source: null, missing_since: old }), SETTINGS, NOW)).kind,
    ).toBe("remove");
    const notReady = await planRecord(
      item(g, { source: null, missing_since: old, source_ready: false }),
      SETTINGS,
      NOW,
    );
    expect(notReady).toMatchObject({ kind: "hold", reason: "source_collection_not_ready" });
  });

  it("Supreme Court records are only confirmed present or removed", async () => {
    const base: PendingItem = {
      dataset: "caselaw_scotus",
      record_id: "12345",
      seq: 1,
      same: false,
      fingerprint: "a".repeat(64),
      source_ready: true,
    };
    expect((await planRecord({ ...base, source: { present: true } }, SETTINGS, NOW)).kind).toBe(
      "unchanged",
    );
    expect(
      (
        await planRecord(
          { ...base, source: null, missing_since: new Date(NOW - 86400_000).toISOString() },
          SETTINGS,
          NOW,
        )
      ).kind,
    ).toBe("remove");
  });

  it("stored passages without a known key are held rather than re-embedded", async () => {
    const g = row("first", "oversight_reports");
    const stored = storedOf(g).map((s) => ({ ...s, embed_sha256: null }));
    const src = { ...sourceOf(g), source_url: "https://www.oversight.gov/changed" };
    expect(await planRecord(item(g, { stored, source: src }), SETTINGS, NOW)).toMatchObject({
      kind: "hold",
      reason: "keys_not_seeded",
    });
    expect(
      (
        await planRecord(
          item(g, { stored, source: src }),
          { ...SETTINGS, reembed_unseeded: true },
          NOW,
        )
      ).kind,
    ).toBe("index");
  });

  it("the reservation bound is UTF-8 bytes plus a margin", () => {
    expect(reserveFor("abc")).toBe(11);
    expect(reserveFor("§ 1")).toBe(4 + 8);
  });
});

// ------------------------------------------------------------------------------------------------- fake database
type Applied = {
  dataset: string;
  record_id: string;
  action: string;
  reason?: string;
  rows?: unknown[];
};
function fakeDb(
  items: PendingItem[],
  opts: { daily?: number; total?: number; seeded?: boolean; known?: string[] } = {},
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const applied: Applied[] = [];
  const reservations = new Map<number, number>();
  let today = 0;
  let total = 392_652_938;
  let nextId = 1;
  const daily = opts.daily ?? 250_000;
  const cap = opts.total ?? 400_000_000;
  const known = new Set(opts.known ?? []);
  const usage = () => ({
    today,
    total,
    daily_cap: daily,
    total_cap: cap,
    daily_remaining: Math.max(0, daily - today),
    total_remaining: Math.max(0, cap - total),
    seeded: opts.seeded ?? true,
  });
  const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    calls.push({ name, args });
    switch (name) {
      case "semantic_refresh_open_run_v1":
        return {
          run_id: "00000000-0000-0000-0000-000000000001",
          settings: SETTINGS,
          usage: usage(),
          removal_limits: {},
        } as T;
      case "semantic_refresh_detect_v1":
        return { queue: items.length } as T;
      case "semantic_refresh_pending_v1": {
        const after = args["p_after"] as { i: number } | null;
        const start = after ? after.i : 0;
        const page = items.slice(start, start + Number(args["p_limit"]));
        return {
          items: page,
          next: { i: start + page.length },
          more: start + page.length < items.length,
        } as T;
      }
      case "semantic_refresh_known_keys_v1":
        return (args["p_keys"] as string[]).filter((k) => known.has(k)) as T;
      case "semantic_refresh_reserve_v1": {
        const r = Number(args["p_reserve"]);
        const u = usage();
        if (!u.seeded)
          return { ...u, ok: false, reason: "usage_not_seeded", reservation_id: null } as T;
        if (r > u.total_remaining)
          return { ...u, ok: false, reason: "total_cap", reservation_id: null } as T;
        if (r > u.daily_remaining)
          return { ...u, ok: false, reason: "daily_cap", reservation_id: null } as T;
        const id = nextId++;
        reservations.set(id, r);
        today += r;
        total += r;
        return { ...usage(), ok: true, reservation_id: id } as T;
      }
      case "semantic_refresh_settle_v1": {
        const r = reservations.get(Number(args["p_reservation"]))!;
        const t = args["p_tokens"] === null ? r : Number(args["p_tokens"]);
        today += t - r;
        total += t - r;
        return { ...usage(), tokens: t, overrun: t > r } as T;
      }
      case "semantic_refresh_cache_vectors_v1":
        for (const x of args["p_rows"] as { k: string }[]) known.add(x.k);
        return (args["p_rows"] as unknown[]).length as T;
      case "semantic_refresh_apply_v1": {
        const counts: Record<string, Record<string, number>> = {};
        for (const r of args["p_records"] as Applied[]) {
          applied.push(r);
          (counts[r.dataset] ??= {})[r.action] = ((counts[r.dataset] ??= {})[r.action] ?? 0) + 1;
        }
        return { counts } as T;
      }
      case "semantic_refresh_finish_run_v1":
        return { usage: usage() } as T;
      default:
        throw new Error(`unexpected rpc ${name}`);
    }
  };
  return { rpc, calls, applied, usage };
}

function fakeEmbedder(fail?: EmbeddingError | Error): Embedder & { inputs: string[][] } {
  const inputs: string[][] = [];
  return {
    inputs,
    async embed(texts: string[]) {
      inputs.push(texts);
      if (fail) throw fail;
      return {
        vectors: texts.map(() => halfvecLiteral(new Float32Array(1024).fill(0.01))),
        tokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0),
      };
    },
  };
}

describe("runRefresh: budget guard and failures", () => {
  const changed = () => {
    const m = row("multi_chunk");
    const src = sourceOf(m);
    return item(m, {
      source: { ...src, text: `${String(src["text"])}\n(z) Added by an amendment.` },
    });
  };
  const unchanged = () => item(row("first", "crs_reports"));

  it("embeds only unknown keys and applies whole records", async () => {
    const db = fakeDb([changed(), unchanged()]);
    const emb = fakeEmbedder();
    const s = await runRefresh({ rpc: db.rpc, embedder: emb, trigger: "manual" });
    expect(s.status).toBe("ok");
    expect(emb.inputs.flat()).toHaveLength(1);
    expect(db.applied.map((a) => a.action).sort()).toEqual(["index", "unchanged"]);
    expect(s.tokens).toBeLessThanOrEqual(s.reservedUpperBound);
  });

  it("stops at the daily cap: no request, the record is held, zero-token work still applied", async () => {
    const db = fakeDb([changed(), unchanged()], { daily: 50 });
    const emb = fakeEmbedder();
    const s = await runRefresh({ rpc: db.rpc, embedder: emb, trigger: "manual" });
    expect(s.embeddingStop).toBe("daily_cap");
    expect(s.status).toBe("partial");
    expect(emb.inputs).toHaveLength(0);
    expect(db.applied.find((a) => a.action === "index")).toBeUndefined();
    expect(db.applied.find((a) => a.record_id === row("multi_chunk").id)).toMatchObject({
      action: "hold",
      reason: "daily_cap",
    });
    expect(db.applied.find((a) => a.action === "unchanged")).toBeDefined();
    expect(db.usage().today).toBe(0);
    // not read again before the next UTC day
    const held = db.applied.find((a) => a.action === "hold") as unknown as {
      not_before_seconds: number;
    };
    expect(held.not_before_seconds).toBeGreaterThan(0);
    expect(held.not_before_seconds).toBeLessThanOrEqual(86_400);
  });

  it("holds wait until the next UTC day for the budget, a day for settings, an hour for a missing key", () => {
    const at = Date.parse("2026-10-25T06:40:00Z");
    expect(holdSeconds("daily_cap", at)).toBe(17 * 3600 + 20 * 60);
    expect(holdSeconds("total_cap", at)).toBe(86_400);
    expect(holdSeconds("keys_not_seeded", at)).toBe(86_400);
    expect(holdSeconds("embedding_key_missing", at)).toBe(3_600);
    expect(holdSeconds("time_budget", at)).toBe(0);
    expect(holdSeconds("vectors_pending", at)).toBe(0);
  });

  it("stops at the global cap and before the usage ledger is seeded", async () => {
    const total = await runRefresh({
      rpc: fakeDb([changed()], { total: 392_652_940 }).rpc,
      embedder: fakeEmbedder(),
      trigger: "manual",
    });
    expect(total.embeddingStop).toBe("total_cap");
    const unseeded = await runRefresh({
      rpc: fakeDb([changed()], { seeded: false }).rpc,
      embedder: fakeEmbedder(),
      trigger: "manual",
    });
    expect(unseeded.embeddingStop).toBe("usage_not_seeded");
  });

  it("a failed request settles at zero when the service answered, in full when it did not", async () => {
    const answered = fakeDb([changed()]);
    await runRefresh({
      rpc: answered.rpc,
      embedder: fakeEmbedder(new EmbeddingError("HTTP 400", 400, "no")),
      trigger: "manual",
    });
    expect(
      answered.calls.find((c) => c.name === "semantic_refresh_settle_v1")!.args["p_tokens"],
    ).toBe(0);
    const silent = fakeDb([changed()]);
    const s = await runRefresh({
      rpc: silent.rpc,
      embedder: fakeEmbedder(new EmbeddingError("network", 0, "unknown")),
      trigger: "manual",
    });
    expect(
      silent.calls.find((c) => c.name === "semantic_refresh_settle_v1")!.args["p_tokens"],
    ).toBeNull();
    expect(s.embeddingStop).toBe("embedding_failed");
    expect(silent.usage().today).toBeGreaterThan(0);
  });

  it("without the embedding key, zero-token work runs and embedding stops", async () => {
    const db = fakeDb([changed(), unchanged()]);
    const s = await runRefresh({ rpc: db.rpc, embedder: null, trigger: "manual" });
    expect(s.embeddingStop).toBe("embedding_key_missing");
    expect(db.applied.find((a) => a.action === "unchanged")).toBeDefined();
  });

  it("the drift guard holds heading-only re-embedding beyond its limit", async () => {
    const g = row("first", "ecfr_sections_full");
    const drift = item(g, { source: { ...sourceOf(g), title: "1 CFR 1.1 Renamed." } });
    const db = fakeDb([drift]);
    const open = db.rpc;
    const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>) =>
      name === "semantic_refresh_open_run_v1"
        ? ({
            ...(await open<Record<string, unknown>>(name, args)),
            settings: { ...SETTINGS, drift_guard: 0 },
          } as T)
        : open<T>(name, args);
    const emb = fakeEmbedder();
    const s = await runRefresh({ rpc, embedder: emb, trigger: "manual" });
    expect(emb.inputs).toHaveLength(0);
    expect(s.holds[0]).toMatchObject({ reason: "heading_drift_guard" });
  });

  it("one record the database refuses is split out and recorded as an error; the rest are applied", async () => {
    const bad = item(row("first", "doj_oig_reports"));
    const good = [unchanged(), item(row("first", "ftc_publications_index")), changed()];
    const db = fakeDb([...good, bad]);
    const inner = db.rpc;
    const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>) => {
      if (name === "semantic_refresh_apply_v1") {
        const recs = args["p_records"] as { record_id: string; action: string }[];
        if (recs.some((r) => r.record_id === bad.record_id && r.action !== "error"))
          throw Object.assign(new Error("semantic_refresh_apply_v1: HTTP 400 invalid record"), {
            status: 400,
          });
      }
      return inner<T>(name, args);
    };
    const s = await runRefresh({ rpc, embedder: fakeEmbedder(), trigger: "manual" });
    expect(s.status).toBe("ok");
    expect(db.applied.filter((a) => a.record_id === bad.record_id).map((a) => a.action)).toEqual([
      "error",
    ]);
    expect(db.applied.filter((a) => a.record_id !== bad.record_id)).toHaveLength(3);
  });

  it("a database failure that is not about one record fails the run", async () => {
    const db = fakeDb([unchanged()]);
    const inner = db.rpc;
    const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>) => {
      if (name === "semantic_refresh_apply_v1")
        throw Object.assign(new Error("semantic_refresh_apply_v1: HTTP 503"), { status: 503 });
      return inner<T>(name, args);
    };
    const s = await runRefresh({ rpc, embedder: fakeEmbedder(), trigger: "manual" });
    expect(s.status).toBe("failed");
    expect(db.calls.at(-1)!.name).toBe("semantic_refresh_finish_run_v1");
  });

  it("a passage the index would refuse (link or source URL) is an error for its record only", async () => {
    const g = row("first", "crs_reports");
    const p = await planRecord(
      item(g, { source: { ...sourceOf(g), source_url: "ftp://example.gov/x" } }),
      SETTINGS,
      NOW,
    );
    expect(p).toMatchObject({ kind: "error" });
  });

  it("logs counts only: never the key, never record text", async () => {
    const lines: string[] = [];
    const db = fakeDb([changed()]);
    await runRefresh({
      rpc: db.rpc,
      embedder: fakeEmbedder(),
      trigger: "manual",
      log: (l) => lines.push(JSON.stringify(l)),
    });
    const all = lines.join("\n");
    expect(all).not.toMatch(/Added by an amendment|voyage/i);
    const finish = db.calls.find((c) => c.name === "semantic_refresh_finish_run_v1")!;
    expect(JSON.stringify(finish.args)).not.toMatch(/Added by an amendment|voyage/i);
  });
});

describe("embedding client", () => {
  const vec = () => {
    const f = new Float32Array(1024).fill(0.015625);
    return Buffer.from(f.buffer).toString("base64");
  };
  it("sends the build's configuration, retries 429 and returns float16 text", async () => {
    const seen: RequestInit[] = [];
    let n = 0;
    const fetchFake = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      n += 1;
      if (n === 1)
        return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      return new Response(
        JSON.stringify({ data: [{ index: 0, embedding: vec() }], usage: { total_tokens: 7 } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const c = embeddingClient({
      key: "k-test-secret",
      fetch: fetchFake,
      sleep: async () => undefined,
    });
    const out = await c.embed(["passage"]);
    expect(out.tokens).toBe(7);
    expect(out.vectors[0]!.startsWith("[0.015625,0.015625,")).toBe(true);
    const body = JSON.parse(String(seen[1]!.body));
    expect(body).toMatchObject({
      input: ["passage"],
      input_type: "document",
      encoding_format: "base64",
    });
    expect(typeof body.model).toBe("string");
  });
  it("never puts the key in an error", async () => {
    const fetchFake = (async () =>
      new Response("bad key k-test-secret", { status: 401 })) as unknown as typeof fetch;
    const c = embeddingClient({
      key: "k-test-secret",
      fetch: fetchFake,
      sleep: async () => undefined,
    });
    const err = await c.embed(["x"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmbeddingError);
    expect(String((err as Error).message)).not.toContain("k-test-secret");
    expect((err as EmbeddingError).billed).toBe("no");
  });
  it("a request without an answer may have been billed", async () => {
    const fetchFake = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    const c = embeddingClient({ key: "k", fetch: fetchFake, sleep: async () => undefined });
    const err = (await c.embed(["x"]).catch((e: unknown) => e)) as EmbeddingError;
    expect(err.billed).toBe("unknown");
  });
});

describe("HTTP handler", () => {
  const env =
    (extra: Record<string, string> = {}) =>
    (name: string) =>
      ({
        SUPABASE_URL: "https://db.example",
        SUPABASE_SERVICE_ROLE_KEY: "service-key-x",
        VOYAGE_API_KEY: "k-test-secret",
        ...extra,
      })[name];
  const dbFetch = (allowed: boolean) =>
    (async (url: string) => {
      if (url.endsWith("/rpc/semantic_refresh_check_trigger_v1"))
        return new Response(JSON.stringify(allowed), { status: 200 });
      if (url.endsWith("/rpc/semantic_refresh_open_run_v1"))
        return new Response(JSON.stringify({ skipped: "disabled" }), { status: 200 });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
  const post = (token?: string, body: unknown = { trigger: "schedule" }) =>
    new Request("https://fn.example/semantic-refresh", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    });

  it("refuses without the trigger secret", async () => {
    const h = serveRefresh({ env: env(), fetch: dbFetch(false) });
    expect((await h(post())).status).toBe(401);
    expect((await h(post("x".repeat(64)))).status).toBe(401);
    expect((await h(new Request("https://fn.example", { method: "GET" }))).status).toBe(405);
  });
  it("accepts the scheduler and runs in the background; responses carry no key", async () => {
    let bg: Promise<unknown> | null = null;
    const h = serveRefresh({ env: env(), fetch: dbFetch(true), waitUntil: (p) => (bg = p) });
    const res = await h(post("x".repeat(64)));
    expect(res.status).toBe(202);
    const summary = await bg;
    expect(summary).toMatchObject({ status: "skipped", skipped: "disabled" });
    const waited = await serveRefresh({ env: env(), fetch: dbFetch(true) })(
      post("x".repeat(64), { trigger: "manual", wait: true }),
    );
    const text = await waited.text();
    expect(text).not.toMatch(/k-test-secret|service-key-x/);
  });
});
