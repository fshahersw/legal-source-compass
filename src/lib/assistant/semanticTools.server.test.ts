import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/external/rest.server", () => ({
  restGet: vi.fn(async () => ({ rows: [], total: null })),
  rpcPost: vi.fn(),
  rpcPostOptional: rpc,
}));

import { SEMANTIC_EXECUTORS, SEMANTIC_TOOL_DEFINITIONS } from "./semanticTools.server";
import { TOOL_DEFINITIONS, availableTools } from "./tools.server";
import { resetSemanticState } from "@/lib/semantic/semantic.server";
import {
  EMBEDDING_DIMENSIONS,
  SEMANTIC_DATASETS,
  SEMANTIC_INDEX_VERSION,
} from "@/lib/semantic/semantic";

const run = SEMANTIC_EXECUTORS["semantic_search"]!;
const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i % 5) / 10);

const row = (n: number, over: Record<string, unknown> = {}) => ({
  rank: n,
  dataset: "us_code_sections",
  record_id: `15:${n}`,
  chunk_no: 0,
  chunk_total: 3,
  title: `15 U.S.C. § ${n} Test provision ${n}`,
  href: `/law/uscode/15/${n}`,
  source_url: `https://uscode.house.gov/us/usc/119-124/t15/s${n}/`,
  snippet: "A snippet of the passage that matched by meaning.",
  distance: 0.2,
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetSemanticState();
  vi.stubEnv("VOYAGE_API_KEY", "k-secret-test");
  fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ data: [{ embedding: vector }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  rpc.mockReset();
  rpc.mockImplementation(async () => ({
    index_version: SEMANTIC_INDEX_VERSION,
    results: [row(1), row(2)],
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("semantic_search tool definition", () => {
  it("is a narrow read-only tool that tells the model a hit is not a citation", () => {
    const def = SEMANTIC_TOOL_DEFINITIONS[0]!;
    expect(def.name).toBe("semantic_search");
    expect(def.description).toMatch(/not a citation/i);
    expect(def.description).toMatch(/read_usc_section/);
    expect(def.description).not.toMatch(/voyage|embedding model|vector/i);
    const props = def.input_schema["properties"] as Record<string, { items?: { enum?: string[] } }>;
    expect(props["datasets"]!.items!.enum).toEqual(SEMANTIC_DATASETS.map((d) => d.id));
    expect(def.input_schema["required"]).toEqual(["query"]);
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toContain("semantic_search");
  });

  it("is offered only when the deployment has the key", () => {
    expect(availableTools().map((t) => t.name)).toContain("semantic_search");
    vi.stubEnv("VOYAGE_API_KEY", "");
    expect(availableTools().map((t) => t.name)).not.toContain("semantic_search");
  });
});

describe("semantic_search tool", () => {
  it("returns ranked records with passages, pages and a reminder that hits are not citations", async () => {
    const out = await run({
      query: "duty to pay whistleblower awards",
      datasets: ["us_code_sections"],
      limit: 5,
    });
    const body = JSON.parse(out.content);
    expect(body.query).toBe("duty to pay whistleblower awards");
    expect(body.note).toMatch(/not a citation/i);
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toEqual({
      rank: 1,
      dataset: "us_code_sections",
      dataset_label: "U.S. Code",
      title: "15 U.S.C. § 1 Test provision 1",
      record_id: "15:1",
      passage: "1 of 3",
      snippet: "A snippet of the passage that matched by meaning.",
      page: "/law/uscode/15/1",
      source_url: "https://uscode.house.gov/us/usc/119-124/t15/s1/",
    });
    expect(out.sources).toEqual([
      { title: "15 U.S.C. § 1 Test provision 1", url: "/law/uscode/15/1", internal: true },
      { title: "15 U.S.C. § 2 Test provision 2", url: "/law/uscode/15/2", internal: true },
    ]);
    expect(out.label).toBe("Searched by meaning");
    expect(out.detail).toBe("“duty to pay whistleblower awards” · 2 records");
    expect(rpc.mock.calls[0]![0]).toBe("semantic_search_v1");
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_datasets: ["us_code_sections"], p_limit: 5 });
  });

  it("caps the limit at 10 and never leaks the key or the provider", async () => {
    const out = await run({ query: "duty to pay whistleblower awards", limit: 50 });
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_limit: 10 });
    expect(JSON.stringify(out)).not.toMatch(/k-secret-test|voyage/i);
  });

  it("says plainly when search by meaning is not configured or the index is not loaded", async () => {
    vi.stubEnv("VOYAGE_API_KEY", "");
    const a = await run({ query: "duty to pay whistleblower awards" });
    expect(JSON.parse(a.content)).toMatchObject({ available: false });
    expect(a.detail).toBe("not configured");
    vi.stubEnv("VOYAGE_API_KEY", "k-secret-test");
    rpc.mockImplementation(async () => null);
    const b = await run({ query: "duty to pay whistleblower awards" });
    expect(JSON.parse(b.content).reason).toMatch(/not been loaded/);
    expect(b.sources).toEqual([]);
  });

  it("rejects a query that is too short and reports outages without naming a vendor", async () => {
    await expect(run({ query: "a" })).rejects.toThrow(/at least 2/);
    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    await expect(run({ query: "duty to pay whistleblower awards" })).rejects.toThrow(
      /temporarily unavailable/,
    );
    resetSemanticState();
    fetchMock.mockImplementation(async () => new Response("slow", { status: 429 }));
    await expect(run({ query: "another whistleblower query" })).rejects.toThrow(/busy/);
  });

  it("drops hits with unsafe links and keeps the result within the size bound", async () => {
    const long = "w ".repeat(190);
    rpc.mockImplementation(async () => ({
      index_version: SEMANTIC_INDEX_VERSION,
      results: [
        row(1, { href: "https://evil.example/x" }),
        ...Array.from({ length: 10 }, (_, i) =>
          row(i + 2, { snippet: long, title: `T${i} ${long}`.slice(0, 290) }),
        ),
      ],
    }));
    const out = await run({ query: "duty to pay whistleblower awards" });
    expect(out.content.length).toBeLessThanOrEqual(14000);
    const body = JSON.parse(out.content);
    expect(body.results.every((r: { page: string }) => r.page.startsWith("/law/uscode/"))).toBe(
      true,
    );
    expect(body.results.map((r: { record_id: string }) => r.record_id)).not.toContain("15:1");
  });
});
