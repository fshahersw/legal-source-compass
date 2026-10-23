import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { courtListenerSearch, gunzipText, readRange, takeToken } from "./caselaw.server";

const KEY = "caselaw/read/2026-09-30/t1/scotus/scotus-1960s-0003-0123456789ab.jsonl.gz";

describe("readRange", () => {
  beforeEach(() => {
    process.env["EXTERNAL_SUPABASE_URL"] = "https://example.supabase.co";
    process.env["EXTERNAL_SUPABASE_KEY"] = "service-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses keys outside the case-law prefixes and bad ranges", async () => {
    await expect(
      readRange("caselaw/courtlistener/2026-09-30/t1/x.jsonl.gz", 0, 10),
    ).rejects.toThrow(/Unexpected storage key/);
    await expect(readRange("../secret", 0, 10)).rejects.toThrow(/Unexpected storage key/);
    await expect(readRange(KEY, 10, 10)).rejects.toThrow(/Invalid byte range/);
    await expect(readRange(KEY, 0, 50_000_000)).rejects.toThrow(/Invalid byte range/);
  });

  it("sends one Range request and checks the status and length", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)["Range"]).toBe("bytes=100-104");
      return new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 206 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await readRange(KEY, 100, 105);
    expect([...out]).toEqual([1, 2, 3, 4, 5]);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `https://example.supabase.co/storage/v1/object/corpus-originals/${KEY}`,
    );
  });

  it("fails when the server ignores the range", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(10), { status: 200 })),
    );
    await expect(readRange(KEY, 0, 5)).rejects.toThrow(/read failed \(200\)/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(3), { status: 206 })),
    );
    await expect(readRange(KEY, 0, 5)).rejects.toThrow(/unexpected length/);
  });

  it("decodes one gzip member", async () => {
    expect(await gunzipText(new Uint8Array(gzipSync(Buffer.from('{"a":"é"}'))))).toBe('{"a":"é"}');
  });
});

describe("CourtListener live search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["COURTLISTENER_API_KEY"];
  });

  it("limits requests per window", () => {
    const buckets = [
      { limit: 2, windowMs: 1000, hits: [] as number[] },
      { limit: 3, windowMs: 10_000, hits: [] as number[] },
    ];
    expect(takeToken(0, buckets)).toBe(true);
    expect(takeToken(10, buckets)).toBe(true);
    expect(takeToken(20, buckets)).toBe(false);
    expect(takeToken(1500, buckets)).toBe(true);
    expect(takeToken(2600, buckets)).toBe(false); // hour-style bucket full
    expect(takeToken(10_100, buckets)).toBe(true);
  });

  it("reports a missing token without calling out", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await courtListenerSearch(new URLSearchParams({ q: "unique-not-configured" }));
    expect(r).toEqual({ ok: false, reason: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });

  it("fetches once with the token, then answers from the cache", async () => {
    process.env["COURTLISTENER_API_KEY"] = "tok";
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("https://www.courtlistener.com/api/rest/v4/search/?");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe("Token tok");
      return new Response(JSON.stringify({ count: 1, results: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    const p = new URLSearchParams({ q: "cache me", type: "o" });
    const a = await courtListenerSearch(p);
    const b = await courtListenerSearch(new URLSearchParams({ type: "o", q: "cache me" }));
    expect(a.ok && a.source).toBe("live");
    expect(b.ok && b.source).toBe("cache");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("backs off after a 429", async () => {
    process.env["COURTLISTENER_API_KEY"] = "tok";
    const f = vi.fn(async () => new Response("slow down", { status: 429 }));
    vi.stubGlobal("fetch", f);
    expect(await courtListenerSearch(new URLSearchParams({ q: "first 429" }))).toEqual({
      ok: false,
      reason: "rate_limited",
      status: 429,
    });
    expect(await courtListenerSearch(new URLSearchParams({ q: "second after 429" }))).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
