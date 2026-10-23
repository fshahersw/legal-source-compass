import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  SEMANTIC_DATASETS,
  SEMANTIC_INDEX_VERSION,
  clampInt,
  normalizeQuery,
  parseHit,
  parsePayload,
  parseStatus,
  safeInternalHref,
  safeSourceUrl,
  toVectorLiteral,
} from "./semantic";
import {
  EMBEDDING_MODEL,
  embeddingUrl,
  relatedSemantic,
  resetSemanticState,
  searchSemantic,
  semanticConfigured,
  semanticCoverage,
  takeEmbeddingToken,
  type Deps,
} from "./semantic.server";

const vector = (n = EMBEDDING_DIMENSIONS) =>
  Array.from({ length: n }, (_, i) => (i % 7) / 10 - 0.3);

const hit = (over: Record<string, unknown> = {}) => ({
  rank: 1,
  dataset: "us_code_sections",
  record_id: "15:78u-6",
  chunk_no: 2,
  chunk_total: 8,
  title: "15 U.S.C. § 78u–6 Securities whistleblower incentives and protection",
  href: "/law/uscode/15/78u-6",
  source_url: "https://uscode.house.gov/us/usc/119-124/t15/s78u-6/",
  snippet: "The Commission shall pay an award to one or more whistleblowers.",
  distance: 0.21,
  ...over,
});

describe("pure helpers", () => {
  it("normalizes a query without changing its words", () => {
    expect(normalizeQuery("  statute of\n\tlimitations   for   securities ")).toBe(
      "statute of limitations for securities",
    );
    expect(normalizeQuery("a\u0000b\u001fc")).toBe("a b c");
    expect(normalizeQuery("x".repeat(900))).toHaveLength(400);
    expect(normalizeQuery(42)).toBe("");
  });

  it("clamps integers and falls back for non-numbers", () => {
    expect(clampInt(50, 1, 20, 10)).toBe(20);
    expect(clampInt(0, 1, 20, 10)).toBe(1);
    expect(clampInt(7.9, 1, 20, 10)).toBe(7);
    expect(clampInt("5", 1, 20, 10)).toBe(10);
    expect(clampInt(Number.NaN, 1, 20, 10)).toBe(10);
  });

  it("writes a 1024-number embedding as a vector literal and refuses anything else", () => {
    const lit = toVectorLiteral(vector());
    expect(lit.startsWith("[") && lit.endsWith("]")).toBe(true);
    expect(lit.split(",")).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(() => toVectorLiteral(vector(10))).toThrow(/expected length/);
    expect(() => toVectorLiteral([...vector(1023), Number.NaN])).toThrow(/not a number/);
    expect(() => toVectorLiteral("[1,2]")).toThrow();
  });

  it("accepts only in-app links of the shapes the index writes", () => {
    for (const ok of [
      "/law/uscode/15/78u-6",
      "/law/cfr/17/240.10b-5",
      "/law/cfr/2/Appendix%20A%20to%20Part%2025",
      "/law/uscode/41/41%2B42",
      "/records/oversight_reports/ovr%3A0267ee6b3410ee",
      "/cases/108356",
      "/law/legislation/federal/119/hr/5631",
      "/records/crs_reports/IF10333",
      "/records/oversight_reports/ovr:0267ee6b3410ee",
    ])
      expect(safeInternalHref(ok)).toBe(ok);
    for (const bad of [
      "//evil.example",
      "https://evil.example/x",
      "javascript:alert(1)",
      "/admin/secret",
      "/cases/abc",
      "/law/uscode/15",
      "/law/uscode/15/78 u",
      "/cases/1?x=1",
      42,
      null,
    ])
      expect(safeInternalHref(bad)).toBeNull();
    expect(safeSourceUrl("https://www.ecfr.gov/current/title-17")).toContain("ecfr.gov");
    expect(safeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(safeSourceUrl("ftp://x.example/a")).toBeNull();
  });

  it("has a unique id and label for every dataset", () => {
    expect(new Set(SEMANTIC_DATASETS.map((d) => d.id)).size).toBe(SEMANTIC_DATASETS.length);
    for (const d of SEMANTIC_DATASETS) expect(d.label).not.toMatch(/voyage|embedding|vector/i);
  });
});

describe("parsers", () => {
  it("reads a hit, turns the 0-based passage into a 1-based number and drops the distance", () => {
    const h = parseHit(hit());
    expect(h).toMatchObject({
      rank: 1,
      dataset: "us_code_sections",
      datasetLabel: "U.S. Code",
      recordId: "15:78u-6",
      href: "/law/uscode/15/78u-6",
      passage: { number: 3, of: 8 },
    });
    expect(Object.keys(h!)).not.toContain("distance");
  });

  it("drops rows with a missing title, an unsafe link or a bad passage number", () => {
    expect(parseHit(hit({ title: "  " }))).toBeNull();
    expect(parseHit(hit({ href: "https://evil.example" }))).toBeNull();
    expect(parseHit(hit({ chunk_no: -1 }))).toBeNull();
    expect(parseHit(hit({ rank: 0 }))).toBeNull();
    expect(parseHit("nope")).toBeNull();
    expect(parseHit(hit({ source_url: "javascript:x" }))?.sourceUrl).toBeNull();
  });

  it("keeps one hit per record, in rank order, renumbered 1..n", () => {
    const p = parsePayload({
      index_version: "si-1",
      results: [
        hit({
          rank: 3,
          record_id: "b",
          title: "B",
          href: "/records/crs_reports/b",
          dataset: "crs_reports",
        }),
        hit({ rank: 1, record_id: "a", title: "A" }),
        hit({ rank: 2, record_id: "a", title: "A again", chunk_no: 5 }),
        { broken: true },
      ],
    });
    expect(p!.hits.map((h) => [h.rank, h.title])).toEqual([
      [1, "A"],
      [2, "B"],
    ]);
    expect(p!.indexVersion).toBe("si-1");
  });

  it("returns null for a malformed envelope and reads indexed:false", () => {
    expect(parsePayload(null)).toBeNull();
    expect(parsePayload({ results: "x" })).toBeNull();
    expect(parsePayload({ indexed: false, index_version: "si-1", results: [] })).toMatchObject({
      indexed: false,
      hits: [],
    });
  });

  it("reads coverage and ignores unknown datasets", () => {
    const s = parseStatus({
      index_version: "si-1",
      datasets: [
        {
          dataset: "us_code_sections",
          records: 10,
          loaded_chunks: 25,
          capped_records: 1,
          composed: false,
        },
        { dataset: "something_else", records: 1, loaded_chunks: 1 },
      ],
    });
    expect(s!.datasets).toEqual([
      {
        dataset: "us_code_sections",
        label: "U.S. Code",
        records: 10,
        loadedChunks: 25,
        cappedRecords: 1,
        composed: false,
      },
    ]);
    expect(parseStatus({})).toBeNull();
  });
});

function deps(over: Partial<Deps> & { key?: string | null } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const rpcCalls: { fn: string; body: Record<string, unknown> }[] = [];
  const d: Deps = {
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ data: [{ embedding: vector() }], usage: { total_tokens: 7 } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch,
    rpc: (async (fn: string, body: Record<string, unknown>) => {
      rpcCalls.push({ fn, body });
      return { index_version: SEMANTIC_INDEX_VERSION, results: [hit()] };
    }) as unknown as Deps["rpc"],
    now: () => 1_000_000,
    env: (name: string) =>
      name === "VOYAGE_API_KEY" ? (over.key === undefined ? "k-test" : over.key) : null,
    ...over,
  };
  return { d, calls, rpcCalls };
}

beforeEach(() => {
  resetSemanticState();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("searchSemantic", () => {
  it("embeds the query as a query and calls the search function with the vector literal", async () => {
    const { d, calls, rpcCalls } = deps();
    const out = await searchSemantic(
      "  statute of limitations  for whistleblower retaliation ",
      ["us_code_sections"],
      5,
      d,
    );
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.query).toBe("statute of limitations for whistleblower retaliation");
    expect(out.hits[0]!.title).toContain("78u–6");
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent).toEqual({
      input: ["statute of limitations for whistleblower retaliation"],
      model: EMBEDDING_MODEL,
      input_type: "query",
    });
    expect((calls[0]!.init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer k-test",
    );
    expect(rpcCalls[0]!.fn).toBe("semantic_search_v1");
    expect(rpcCalls[0]!.body["p_datasets"]).toEqual(["us_code_sections"]);
    expect(rpcCalls[0]!.body["p_limit"]).toBe(5);
    expect(String(rpcCalls[0]!.body["p_embedding"]).startsWith("[")).toBe(true);
  });

  it("never puts the key or the provider in an outcome", async () => {
    const { d } = deps();
    const out = await searchSemantic("whistleblower award", null, undefined, d);
    expect(JSON.stringify(out)).not.toMatch(/k-test|voyage/i);
  });

  it("says not configured, without a call, when the key is absent", async () => {
    const { d, calls, rpcCalls } = deps({ key: null });
    expect(await searchSemantic("whistleblower award", null, 10, d)).toEqual({
      status: "not_configured",
    });
    expect(calls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(semanticConfigured(d)).toBe(false);
  });

  it("rejects short queries and unknown datasets before any call", async () => {
    const { d, calls } = deps();
    expect((await searchSemantic(" a ", null, 10, d)).status).toBe("invalid");
    expect((await searchSemantic("x".repeat(500), null, 10, d)).status).toBe("invalid");
    expect((await searchSemantic("whistleblower", ["open_us_law"], 10, d)).status).toBe("invalid");
    expect(calls).toHaveLength(0);
  });

  it("caches the query vector so a repeat costs no embedding call", async () => {
    const { d, calls } = deps();
    await searchSemantic("whistleblower award", null, 10, d);
    await searchSemantic("Whistleblower award", null, 10, d);
    await searchSemantic("  whistleblower   award ", null, 10, d);
    expect(calls).toHaveLength(2); // the second differs in case; the third normalizes to the first
  });

  it("reports an embedding failure and a rate limit as unavailable, not as an exception", async () => {
    const down = deps({
      fetch: (async () => new Response("no", { status: 503 })) as unknown as typeof fetch,
    });
    expect(await searchSemantic("whistleblower award", null, 10, down.d)).toEqual({
      status: "unavailable",
      reason: "embedding",
    });
    const limited = deps({
      fetch: (async () => new Response("slow", { status: 429 })) as unknown as typeof fetch,
    });
    expect(await searchSemantic("whistleblower award", null, 10, limited.d)).toEqual({
      status: "unavailable",
      reason: "busy",
    });
    const thrown = deps({
      fetch: (async () => {
        throw new TypeError("network");
      }) as unknown as typeof fetch,
    });
    expect(await searchSemantic("whistleblower award", null, 10, thrown.d)).toEqual({
      status: "unavailable",
      reason: "embedding",
    });
    const wrong = deps({
      fetch: (async () =>
        new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    expect(await searchSemantic("whistleblower award", null, 10, wrong.d)).toEqual({
      status: "unavailable",
      reason: "embedding",
    });
  });

  it("says not loaded when the database function or data is missing, and unavailable on a database error", async () => {
    expect(
      await searchSemantic(
        "whistleblower award",
        null,
        10,
        deps({ rpc: (async () => null) as unknown as Deps["rpc"] }).d,
      ),
    ).toEqual({ status: "not_loaded" });
    const empty = deps({
      rpc: (async () => ({ index_version: null, results: [] })) as unknown as Deps["rpc"],
    });
    expect(await searchSemantic("whistleblower award", null, 10, empty.d)).toEqual({
      status: "not_loaded",
    });
    const broken = deps({
      rpc: (async () => {
        throw new Error("External corpus read failed (500).");
      }) as unknown as Deps["rpc"],
    });
    expect(await searchSemantic("whistleblower award", null, 10, broken.d)).toEqual({
      status: "unavailable",
      reason: "database",
    });
    const garbage = deps({ rpc: (async () => ({ nope: 1 })) as unknown as Deps["rpc"] });
    expect(await searchSemantic("whistleblower award", null, 10, garbage.d)).toEqual({
      status: "unavailable",
      reason: "database",
    });
  });

  it("refuses an index built with another configuration", async () => {
    const other = deps({
      rpc: (async () => ({ index_version: "si-9", results: [hit()] })) as unknown as Deps["rpc"],
    });
    expect(await searchSemantic("whistleblower award", null, 10, other.d)).toEqual({
      status: "unavailable",
      reason: "version",
    });
  });

  it("returns ok with no hits when nothing is close, so the page can say so", async () => {
    const none = deps({
      rpc: (async () => ({
        index_version: SEMANTIC_INDEX_VERSION,
        results: [],
      })) as unknown as Deps["rpc"],
    });
    expect(await searchSemantic("whistleblower award", null, 10, none.d)).toEqual({
      status: "ok",
      query: "whistleblower award",
      hits: [],
    });
  });

  it("limits embedding calls per instance", () => {
    const buckets = [{ limit: 2, windowMs: 1000, hits: [] as number[] }];
    expect(takeEmbeddingToken(0, buckets)).toBe(true);
    expect(takeEmbeddingToken(10, buckets)).toBe(true);
    expect(takeEmbeddingToken(20, buckets)).toBe(false);
    expect(takeEmbeddingToken(1500, buckets)).toBe(true);
  });
});

describe("relatedSemantic", () => {
  it("returns related records and works without the embedding key", async () => {
    const { d, rpcCalls, calls } = deps({ key: null });
    const out = await relatedSemantic("us_code_sections", "15:78u-6", 6, ["ecfr_sections_full"], d);
    expect(out.status).toBe("ok");
    expect(calls).toHaveLength(0);
    expect(rpcCalls[0]).toEqual({
      fn: "semantic_related_v1",
      body: {
        p_dataset: "us_code_sections",
        p_record_id: "15:78u-6",
        p_limit: 6,
        p_datasets: ["ecfr_sections_full"],
      },
    });
  });

  it("separates a record that is not in the index from an index that is not loaded", async () => {
    const notIndexed = deps({
      rpc: (async () => ({
        indexed: false,
        index_version: SEMANTIC_INDEX_VERSION,
        results: [],
      })) as unknown as Deps["rpc"],
    });
    expect(await relatedSemantic("us_code_sections", "99:99", 8, null, notIndexed.d)).toEqual({
      status: "not_indexed",
    });
    const missingFn = deps({ rpc: (async () => null) as unknown as Deps["rpc"] });
    expect(await relatedSemantic("us_code_sections", "1:1", 8, null, missingFn.d)).toEqual({
      status: "not_loaded",
    });
    const noData = deps({
      rpc: (async () => ({
        indexed: false,
        index_version: null,
        results: [],
      })) as unknown as Deps["rpc"],
    });
    expect(await relatedSemantic("us_code_sections", "1:1", 8, null, noData.d)).toEqual({
      status: "not_loaded",
    });
  });

  it("validates the dataset and the record id", async () => {
    const { d, rpcCalls } = deps();
    expect((await relatedSemantic("open_us_law", "1", 8, null, d)).status).toBe("invalid");
    expect((await relatedSemantic("us_code_sections", "a b", 8, null, d)).status).toBe("invalid");
    expect((await relatedSemantic("us_code_sections", "1:1", 8, ["nope"], d)).status).toBe(
      "invalid",
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it("reports a database failure as unavailable", async () => {
    const broken = deps({
      rpc: (async () => {
        throw new Error("x");
      }) as unknown as Deps["rpc"],
    });
    expect(await relatedSemantic("us_code_sections", "1:1", 8, null, broken.d)).toEqual({
      status: "unavailable",
      reason: "database",
    });
  });
});

describe("semanticCoverage", () => {
  it("lists only datasets that have loaded passages and caches a good answer", async () => {
    const rpc = vi.fn(async () => ({
      index_version: SEMANTIC_INDEX_VERSION,
      datasets: [
        {
          dataset: "us_code_sections",
          records: 3,
          loaded_chunks: 9,
          capped_records: 0,
          composed: false,
        },
        {
          dataset: "congress_bills",
          records: 5,
          loaded_chunks: 0,
          capped_records: 0,
          composed: true,
        },
      ],
    }));
    const { d } = deps({ rpc: rpc as unknown as Deps["rpc"] });
    const a = await semanticCoverage(d);
    await semanticCoverage(d);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ status: "ok" });
    if (a.status === "ok") expect(a.datasets.map((x) => x.dataset)).toEqual(["us_code_sections"]);
  });

  it("is not_loaded before the functions exist and does not cache a failure", async () => {
    expect(
      await semanticCoverage(deps({ rpc: (async () => null) as unknown as Deps["rpc"] }).d),
    ).toEqual({ status: "not_loaded" });
    resetSemanticState();
    const broken = vi.fn(async () => {
      throw new Error("x");
    });
    const d = deps({ rpc: broken as unknown as Deps["rpc"] }).d;
    expect(await semanticCoverage(d)).toEqual({ status: "unavailable", reason: "database" });
    expect(await semanticCoverage(d)).toEqual({ status: "unavailable", reason: "database" });
    expect(broken).toHaveBeenCalledTimes(2);
  });
});

describe("embeddingUrl", () => {
  const env = (value: string | null) => ({
    env: (n: string) => (n === "SEMANTIC_EMBEDDING_URL" ? value : null),
  });
  it("uses the service address unless a loopback stand-in is configured", () => {
    const service = embeddingUrl(env(null));
    expect(service.startsWith("https://")).toBe(true);
    expect(embeddingUrl(env("http://127.0.0.1:5489/v1/embeddings"))).toBe(
      "http://127.0.0.1:5489/v1/embeddings",
    );
    expect(embeddingUrl(env("http://localhost:5489/e"))).toBe("http://localhost:5489/e");
  });
  it("never sends the key to another host", () => {
    const service = embeddingUrl(env(null));
    for (const v of [
      "https://example.com/v1/embeddings",
      "http://10.0.0.5/v1/embeddings",
      "http://127.0.0.1.example.com/x",
      "https://127.0.0.1/x",
      "not a url",
    ])
      expect(embeddingUrl(env(v))).toBe(service);
  });
});
