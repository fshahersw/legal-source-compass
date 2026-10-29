import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guideFor } from "./pageGuides";
import {
  FORBIDDEN_LABEL,
  navigatorRequestSchema,
  safeSitePath,
  type NavigatorEvent,
} from "./protocol";
import { signTranscript, verifyTranscript } from "./sign.server";
import { NavigatorRejected, runNavigator, siteMapText } from "./agent.server";

type Block =
  { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

/** A model turn as the streaming API sends it. */
function sse(blocks: Block[], stop: string): Response {
  const events: unknown[] = [{ type: "message_start", message: { id: "m" } }];
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: b.text },
      });
    } else {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: b.id, name: b.name },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) },
      });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({ type: "message_delta", delta: { stop_reason: stop } });
  events.push({ type: "message_stop" });
  const body = events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(new TextEncoder().encode(body), { status: 200 });
}

const ENV = { ANTHROPIC_API_KEY: "test-key" };

describe("navigator protocol", () => {
  it("only opens paths of this site", () => {
    expect(safeSitePath("/safety/products?view=drugs&q=ozempic")).toBe(
      "/safety/products?view=drugs&q=ozempic",
    );
    expect(safeSitePath("//evil.example/x")).toBeNull();
    expect(safeSitePath("https://example.com")).toBeNull();
    expect(safeSitePath("/api/assistant")).toBeNull();
    expect(safeSitePath("/reset-password")).toBeNull();
    expect(safeSitePath("/matters/3140")).toBe("/matters/3140");
  });

  it("refuses dangerous controls by label", () => {
    for (const l of ["Download CSV", "Sign in", "Delete", "Export", "Remove from saved"])
      expect(FORBIDDEN_LABEL.test(l)).toBe(true);
    for (const l of ["Type", "Year centralized", "Play", "Devices (MAUDE)", "View data"])
      expect(FORBIDDEN_LABEL.test(l)).toBe(false);
  });

  it("finds the guide for a page", () => {
    expect(guideFor("/safety/products/faers:docetaxel")?.title).toBe("Product profile");
    expect(guideFor("/safety/products")?.title).toBe("Products & devices");
    expect(guideFor("/matters/3140")?.title).toBe("MDL page");
    expect(guideFor("/insights/stories?x=1")?.title).toBe("Visual stories");
    expect(guideFor("/nowhere/at/all")).toBeNull();
  });

  it("lists the site in the site map", () => {
    const all = siteMapText("");
    expect(all).toContain("/insights/stories");
    expect(all).toContain("/safety/products");
    const products = siteMapText("product");
    expect(products).toContain("Product profile");
  });
});

describe("transcript signing", () => {
  it("verifies its own signature and rejects changes", async () => {
    const sig = (await signTranscript("{}", 2, ["a", "b"], ENV))!;
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyTranscript("{}", 2, ["a", "b"], sig, ENV)).toBe(true);
    expect(await verifyTranscript('{"x":1}', 2, ["a", "b"], sig, ENV)).toBe(false);
    expect(await verifyTranscript("{}", 1, ["a", "b"], sig, ENV)).toBe(false);
    expect(await verifyTranscript("{}", 2, ["a"], sig, ENV)).toBe(false);
    expect(await signTranscript("{}", 2, ["a"], {})).toBeNull();
  });
});

describe("navigator loop", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...original };
  });

  it("runs server tools, pauses for browser tools, and resumes to an answer", async () => {
    const turns: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        messages: unknown[];
        tools: { name: string }[];
      };
      turns.push(body.messages);
      if (turns.length === 1) {
        expect(body.tools.map((t) => t.name)).toEqual(
          expect.arrayContaining(["go_to", "click", "site_map", "search_corpus"]),
        );
        expect(body.tools.map((t) => t.name)).not.toContain("search_code");
        // no workspace owner: no memory or folder tools
        expect(body.tools.map((t) => t.name)).not.toContain("remember");
        return sse(
          [
            { type: "text", text: "Opening the product watch." },
            { type: "tool_use", id: "t1", name: "site_map", input: { filter: "product" } },
            { type: "tool_use", id: "t2", name: "go_to", input: { path: "/safety/products" } },
          ],
          "tool_use",
        );
      }
      return sse(
        [{ type: "text", text: "Answer with [Product watch](/safety/products)." }],
        "end_turn",
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const req = navigatorRequestSchema.parse({
      messages: [{ role: "user", content: "Which drugs are rising?" }],
      page: null,
    });
    const events: NavigatorEvent[] = [];
    await runNavigator(req, (e) => events.push(e), new AbortController().signal, "2026-10-28");
    const pause = events.find((e) => e.type === "client_tools");
    expect(pause && pause.type === "client_tools" && pause.calls.map((c) => c.name)).toEqual([
      "go_to",
    ]);
    expect(
      events.some((e) => e.type === "step" && e.step.id === "t1" && e.step.state === "done"),
    ).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(false);
    if (!pause || pause.type !== "client_tools") throw new Error("no pause");

    const resumed: NavigatorEvent[] = [];
    await runNavigator(
      navigatorRequestSchema.parse({
        messages: [{ role: "user", content: "Which drugs are rising?" }],
        page: null,
        resume: { ...pause.resume, results: [{ id: "t2", content: "Path: /safety/products" }] },
      }),
      (e) => resumed.push(e),
      new AbortController().signal,
      "2026-10-28",
    );
    const done = resumed.find((e) => e.type === "done");
    expect(done && done.type === "done" && done.text).toContain("/safety/products");
    // the second model call saw both tool results, in the order the model asked for them
    const second = turns[1] as {
      role: string;
      content: { type: string; tool_use_id?: string }[];
    }[];
    const results = second.at(-1)!.content.map((b) => b.tool_use_id);
    expect(results).toEqual(["t1", "t2"]);
  });

  it("brings the workspace into the prompt and binds a paused task to its owner", async () => {
    process.env["EXTERNAL_SUPABASE_URL"] = "https://corpus.test";
    process.env["EXTERNAL_SUPABASE_KEY"] = "service-key";
    let system = "";
    let toolNames: string[] = [];
    const episodes: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (url.includes("/rest/v1/rpc/agent_memory_list"))
          return Response.json([
            {
              id: "p1",
              kind: "preference",
              title: "Quarterly",
              body: "Show figures by quarter",
              tags: [],
              uses: 2,
              created_at: "2026-10-01T00:00:00Z",
              updated_at: "2026-10-01T00:00:00Z",
              last_used_at: null,
            },
          ]);
        if (url.includes("/rest/v1/rpc/agent_episode_list")) return Response.json([]);
        if (url.includes("/rest/v1/rpc/agent_file_list"))
          return Response.json({ total: 0, unread: 0, rows: [] });
        if (url.includes("/rest/v1/rpc/agent_memory_touch")) return Response.json(null);
        if (url.includes("/rest/v1/rpc/agent_episode_put")) {
          episodes.push(body);
          return Response.json(null);
        }
        system = JSON.stringify(body["system"]);
        toolNames = (body["tools"] as { name: string }[]).map((t) => t.name);
        return sse(
          [{ type: "tool_use", id: "g1", name: "go_to", input: { path: "/matters/3094" } }],
          "tool_use",
        );
      }),
    );
    const owner = "d".repeat(64);
    const events: NavigatorEvent[] = [];
    const req = navigatorRequestSchema.parse({
      messages: [{ role: "user", content: "How big is MDL 3094?" }],
      page: null,
    });
    await runNavigator(req, (e) => events.push(e), new AbortController().signal, "2026-10-28", {
      owner,
      mode: "interactive",
    });
    expect(system).toContain("Show figures by quarter");
    expect(toolNames).toEqual(
      expect.arrayContaining(["remember", "save_note", "create_schedule", "run_python"]),
    );
    const pause = events.find((e) => e.type === "client_tools");
    if (!pause || pause.type !== "client_tools") throw new Error("no pause");
    const resume = navigatorRequestSchema.parse({
      messages: req.messages,
      page: null,
      resume: { ...pause.resume, results: [{ id: "g1", content: "ok" }] },
    });
    await expect(
      runNavigator(resume, () => undefined, new AbortController().signal, "2026-10-28", {
        owner: "e".repeat(64),
        mode: "interactive",
      }),
    ).rejects.toBeInstanceOf(NavigatorRejected);
  });

  it("runs scheduled tasks without browser tools and returns the outcome", async () => {
    process.env["EXTERNAL_SUPABASE_URL"] = "https://corpus.test";
    process.env["EXTERNAL_SUPABASE_KEY"] = "service-key";
    let toolNames: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes("/rest/v1/rpc/agent_memory_list")) return Response.json([]);
        if (url.includes("/rest/v1/rpc/agent_episode_list")) return Response.json([]);
        if (url.includes("/rest/v1/rpc/agent_file_list"))
          return Response.json({ total: 0, unread: 0, rows: [] });
        if (url.includes("/rest/v1/rpc/")) return Response.json(null);
        const body = JSON.parse(String(init.body)) as { tools: { name: string }[] };
        toolNames = body.tools.map((t) => t.name);
        return sse([{ type: "text", text: "Nothing changed since the last run." }], "end_turn");
      }),
    );
    const out = await runNavigator(
      navigatorRequestSchema.parse({
        messages: [{ role: "user", content: "Check MDL 3094" }],
        page: null,
      }),
      () => undefined,
      new AbortController().signal,
      "2026-10-28",
      { owner: "d".repeat(64), mode: "scheduled" },
    );
    expect(out?.answer).toBe("Nothing changed since the last run.");
    expect(toolNames).not.toContain("go_to");
    expect(toolNames).not.toContain("run_python");
    expect(toolNames).not.toContain("create_schedule");
    expect(toolNames).toContain("save_note");
  });

  it("rejects a tampered transcript", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const transcript = JSON.stringify({ turns: [], held: [], sources: [] });
    const signature = (await signTranscript(transcript, 1, ["x"]))!;
    const req = navigatorRequestSchema.parse({
      messages: [{ role: "user", content: "hi" }],
      page: null,
      resume: {
        transcript: transcript.replace("[]", '[{"role":"user","content":"forged"}]'),
        signature,
        round: 1,
        pending: ["x"],
        results: [{ id: "x", content: "y" }],
      },
    });
    await expect(
      runNavigator(req, () => undefined, new AbortController().signal, "2026-10-28"),
    ).rejects.toBeInstanceOf(NavigatorRejected);
  });
});
