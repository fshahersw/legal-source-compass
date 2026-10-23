import { describe, expect, it } from "vitest";
import { serveIngest } from "./edge.ts";
import type { Collected, SourceAdapter } from "./types.ts";

const adapter = (source: string, secrets: string[] = []): SourceAdapter => ({
  source,
  dataset: `${source}_ds`,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-test",
  limits: { maxRequests: 1, minIntervalMs: 0 },
  secrets,
  collect: async (): Promise<Collected> => ({
    rows: [],
    fetched: 0,
    held: [],
    cursorAfter: { at: "x" },
    complete: true,
    notes: {},
  }),
  comparable: (c) => c as never,
});

/** The trigger secret as the database holds it (64 hex characters, like the generated one). */
const TOKEN = "a".repeat(64);

/** fetch double for the corpus RPCs; ingest_check_trigger_v1 accepts TOKEN only, or fails when `checkDown`. */
function rpcFetch(calls: string[], opts: { checkDown?: boolean } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const name = String(input).split("/rpc/")[1] ?? "";
    calls.push(name);
    const headers = init?.headers as Record<string, string>;
    expect(headers["apikey"]).toBe("service-key");
    if (name === "ingest_check_trigger_v1") {
      if (opts.checkDown) return new Response("{}", { status: 404 });
      const { p_token } = JSON.parse(String(init?.body)) as { p_token: string };
      return new Response(JSON.stringify(p_token === TOKEN), { status: 200 });
    }
    const body =
      name === "ingest_open_run_v1"
        ? { run_id: "00000000-0000-4000-8000-00000000000a", cursor: null }
        : name === "ingest_finish_run_v1"
          ? { status: "ok", inserted: 0, updated: 0, unchanged: 0, held: 0 }
          : { status: "skipped" };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

const env =
  (extra: Record<string, string> = {}) =>
  (k: string) =>
    ({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      ...extra,
    })[k];
const post = (body: unknown, auth = `Bearer ${TOKEN}`) =>
  new Request("https://x/functions/v1/ingest-test", {
    method: "POST",
    headers: { Authorization: auth },
    body: JSON.stringify(body),
  });

describe("serveIngest", () => {
  it("refuses other methods, a wrong or missing secret, unknown sources and missing source secrets", async () => {
    const calls: string[] = [];
    const h = serveIngest({
      sources: [adapter("a"), adapter("b", ["DATA_GOV_API_KEY"])],
      env: env(),
      fetch: rpcFetch(calls),
    });
    expect((await h(new Request("https://x/", { method: "GET" }))).status).toBe(405);
    // a short token is refused without asking the database; a long wrong one is refused by the database check
    expect((await h(post({ source: "a" }, "Bearer nope"))).status).toBe(401);
    expect((await h(post({ source: "a" }, ""))).status).toBe(401);
    expect(calls).toEqual([]);
    expect((await h(post({ source: "a" }, `Bearer ${"b".repeat(64)}`))).status).toBe(401);
    expect(calls).toEqual(["ingest_check_trigger_v1"]);
    expect((await h(post({}))).status).toBe(400); // two sources: the source must be named
    expect((await h(post({ source: "zzz" }))).status).toBe(400);
    const missing = await h(post({ source: "b" }));
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({
      error: "missing function secrets",
      names: ["DATA_GOV_API_KEY"],
    });
    const unset = serveIngest({ sources: [adapter("a")], env: () => undefined });
    expect((await unset(post({ source: "a" }))).status).toBe(503);
    // the check itself unavailable (SQL not applied): refused as unavailable, never let through
    const down = serveIngest({
      sources: [adapter("a")],
      env: env(),
      fetch: rpcFetch([], { checkDown: true }),
    });
    expect((await down(post({ source: "a" }))).status).toBe(503);
  });

  it("schedule: answers 202 at once and runs in the background", async () => {
    const calls: string[] = [];
    const pending: Promise<unknown>[] = [];
    const h = serveIngest({
      sources: [adapter("a")],
      env: env(),
      fetch: rpcFetch(calls),
      waitUntil: (p) => pending.push(p),
    });
    const res = await h(post({ trigger: "schedule" }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, source: "a", trigger: "schedule" });
    await Promise.all(pending);
    expect(calls).toEqual([
      "ingest_check_trigger_v1",
      "ingest_open_run_v1",
      "ingest_finish_run_v1",
      "ingest_refresh_insights_v1",
    ]);
  });

  it("manual with wait: returns the run summary without any key", async () => {
    const calls: string[] = [];
    const h = serveIngest({
      sources: [adapter("a")],
      env: env(),
      fetch: rpcFetch(calls),
      waitUntil: () => undefined,
    });
    const res = await h(post({ source: "a", trigger: "manual", wait: true }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("service-key");
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toMatchObject({
      source: "a",
      status: "ok",
      runId: "00000000-0000-4000-8000-00000000000a",
    });
  });
});
