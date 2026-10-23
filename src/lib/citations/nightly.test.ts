import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPages } from "./engine";
import {
  EXTRACTOR_VERSION,
  loadBatches,
  runNightly,
  serveCitations,
  toLoadPages,
  type LoadPage,
  type RpcClient,
} from "./nightly";
import type { Citation } from "./types";

const golden = JSON.parse(
  readFileSync(new URL("./fixtures/golden.json", import.meta.url), "utf8"),
) as {
  texts: { id: string; text: string }[];
  documents: { id: string; pages: string[]; expected: Citation[][] }[];
};
const sha = (n: number) => n.toString(16).padStart(64, "0");

/** In-memory stand-in for the citations/2 RPCs (database/contracts/citations-v2.sql), recording every call. */
function fakeDb(
  sets: { sha256: string; pages: { page: number; text: string }[] }[],
  opts: { stuck?: boolean; failLoad?: boolean } = {},
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const done = new Set<string>();
  let running = false;
  const client: RpcClient = {
    async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ name, args });
      switch (name) {
        case "citations_open_run_v2":
          if (running) throw new Error("A nightly citations run is already running");
          running = true;
          return { run_id: "run-1" } as T;
        case "citations_pending_pages_v2": {
          const todo = sets.filter((s) => !done.has(s.sha256));
          return {
            documents: todo.slice(0, args["p_limit"] as number),
            remaining: todo.length,
          } as T;
        }
        case "citations_load_v2": {
          if (opts.failLoad)
            throw new Error("corpus request failed: HTTP 500 Bearer eyJsecret.token");
          const pages = args["p_pages"] as LoadPage[];
          if (!opts.stuck) for (const p of pages) done.add(p.src_id);
          return {
            pages: pages.length,
            accepted: pages.reduce((n, p) => n + p.citations.length, 0),
            rejected: {},
          } as T;
        }
        case "citations_resolve_v2":
          return { resolved_batch: 3, pending: 0 } as T;
        case "citations_link_v2":
          return { documents: (args["p_shas"] as string[]).length, edges: 7 } as T;
        case "citations_finish_run_v2":
          running = false;
          return { status: args["p_status"] } as T;
        default:
          throw new Error(`unexpected rpc ${name}`);
      }
    },
  };
  return { client, calls };
}

const doc = golden.documents.find((d) => d.id === "pages")!;
const setOf = (n: number, texts: string[]) => ({
  sha256: sha(n),
  pages: texts.map((text, i) => ({ page: i + 1, text })),
});

describe("load rows", () => {
  it("map short-form antecedents to page numbers and keep pages without citations", () => {
    const pages = [
      { page: 3, text: doc.pages[0]! },
      { page: 4, text: doc.pages[1]! },
      { page: 5, text: "No citations." },
    ];
    const rows = toLoadPages(sha(1), pages, extractPages(pages.map((p) => p.text)));
    expect(rows.map((r) => [r.page, r.citations.length])).toEqual([
      [3, 2],
      [4, 3],
      [5, 0],
    ]);
    const short = rows[1]!.citations.find((c) => c.matched === "550 U.S. at 556")!;
    expect(short.antecedent).toEqual({ page: 3, seq: 0 });
    expect(short.key).toBe("case:550:U.S.:544");
    expect(rows[0]!.citations[0]!.name).toBe("Bell Atl. Corp. v. Twombly");
    expect(rows[1]!.citations.map((c) => c.seq)).toEqual([0, 1, 2]);
  });

  it("split into loader-sized batches", () => {
    const row = (n: number): LoadPage => ({
      src: "pdf",
      src_id: sha(1),
      page: 1,
      citations: Array(n).fill(null),
    });
    expect(loadBatches([row(1), row(1), row(1)], 2).map((b) => b.length)).toEqual([2, 1]);
    expect(loadBatches([row(9000), row(9000)]).map((b) => b.length)).toEqual([1, 1]);
    expect(loadBatches([])).toEqual([]);
  });
});

describe("runNightly", () => {
  const texts = golden.texts.map((t) => t.text);

  it("extracts pending byte sets, loads, resolves, links the loaded documents and closes the run ok", async () => {
    const sets = [setOf(1, texts.slice(0, 3)), setOf(2, doc.pages), setOf(3, texts.slice(3, 4))];
    const { client, calls } = fakeDb(sets);
    const s = await runNightly({ client, trigger: "schedule" });
    expect(s).toMatchObject({
      status: "ok",
      stopped_by: "done",
      byte_sets: 3,
      pages: 6,
      remaining: 0,
      resolved: 3,
      documents_linked: 3,
      edges: 7,
    });
    expect(s.extractor_version).toBe(EXTRACTOR_VERSION);
    const load = calls.find((c) => c.name === "citations_load_v2")!;
    expect(load.args["p_run"]).toBe("run-1");
    expect(load.args["p_version"]).toBe(EXTRACTOR_VERSION);
    const link = calls.find((c) => c.name === "citations_link_v2")!;
    expect(link.args["p_shas"]).toEqual([sha(1), sha(2), sha(3)]);
    const finish = calls.at(-1)!;
    expect(finish.name).toBe("citations_finish_run_v2");
    expect(finish.args["p_status"]).toBe("ok");
  });

  it("stops at the extraction budget and leaves the rest to the next invocation (partial)", async () => {
    const sets = Array.from({ length: 6 }, (_, i) => setOf(i + 1, texts.slice(i, i + 2)));
    const { client, calls } = fakeDb(sets);
    let t = 0;
    const s = await runNightly({
      client,
      trigger: "schedule",
      extractBudgetMs: 25,
      now: () => (t += 10),
    });
    expect(s.status).toBe("partial");
    expect(s.stopped_by).toBe("extract_budget");
    expect(s.byte_sets).toBeGreaterThan(0);
    expect(s.byte_sets).toBeLessThan(6);
    expect(s.remaining).toBe(6 - s.byte_sets);
    expect(calls.at(-1)!.args["p_status"]).toBe("partial");
  });

  it("does not spin on a byte set the loader leaves pending", async () => {
    const { client } = fakeDb([setOf(1, texts.slice(0, 1))], { stuck: true });
    const s = await runNightly({ client, trigger: "manual" });
    expect([s.status, s.stopped_by, s.byte_sets]).toEqual(["partial", "repeat", 1]);
  });

  it("closes the run as failed with a redacted error", async () => {
    const { client, calls } = fakeDb([setOf(1, texts.slice(0, 1))], { failLoad: true });
    const s = await runNightly({ client, trigger: "schedule" });
    expect(s.status).toBe("failed");
    expect(s.error).toContain("[redacted]");
    expect(s.error).not.toContain("eyJsecret");
    const finish = calls.at(-1)!;
    expect([finish.name, finish.args["p_status"]]).toEqual(["citations_finish_run_v2", "failed"]);
  });
});

describe("serveCitations", () => {
  const env = (name: string) =>
    ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" })[
      name
    ];
  const token = "a".repeat(64);
  const fetchWith = (check: boolean, seen: string[] = []) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const name = String(input).split("/rpc/")[1]!;
      seen.push(name);
      const args = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const body =
        name === "ingest_check_trigger_v1"
          ? check && args["p_token"] === token
          : name === "citations_open_run_v2"
            ? { run_id: "run-9" }
            : name === "citations_pending_pages_v2"
              ? { documents: [], remaining: 0 }
              : name === "citations_resolve_v2"
                ? { resolved_batch: 0, pending: 0 }
                : { status: "ok" };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
  const post = (auth: string | null, body = "{}") =>
    new Request("https://x/functions/v1/ingest-citations", {
      method: "POST",
      body,
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
    });

  it("answers POST only and checks the trigger secret in the database", async () => {
    const h = serveCitations({ env, fetch: fetchWith(true) });
    expect((await h(new Request("https://x/", { method: "GET" }))).status).toBe(405);
    expect((await h(post(null))).status).toBe(401);
    expect((await h(post("short"))).status).toBe(401);
    expect((await serveCitations({ env, fetch: fetchWith(false) })(post(token))).status).toBe(401);
    expect(
      (await serveCitations({ env: () => undefined, fetch: fetchWith(true) })(post(token))).status,
    ).toBe(503);
    expect((await h(post(token, "not json"))).status).toBe(400);
  });

  it("runs in the background (202) or waits for the summary", async () => {
    const seen: string[] = [];
    let pending: Promise<unknown> | null = null;
    const bg = serveCitations({
      env,
      fetch: fetchWith(true, seen),
      waitUntil: (p) => (pending = p),
    });
    const r = await bg(post(token, JSON.stringify({ trigger: "schedule" })));
    expect(r.status).toBe(202);
    await pending;
    expect(seen).toEqual([
      "ingest_check_trigger_v1",
      "citations_open_run_v2",
      "citations_pending_pages_v2",
      "citations_resolve_v2",
      "citations_finish_run_v2",
    ]);
    const waited = await bg(post(token, JSON.stringify({ trigger: "manual", wait: true })));
    expect(waited.status).toBe(200);
    expect(await waited.json()).toMatchObject({ status: "ok", run_id: "run-9", byte_sets: 0 });
  });
});
