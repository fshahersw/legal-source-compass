import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PATTERNS } from "./patterns.data";
import { loadPatternTable, patternsObjectPath, PATTERNS_BUCKET } from "./patterns.remote";

const bytes = readFileSync(new URL("./patterns.json", import.meta.url));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const env = (keys: Record<string, string>) => (name: string) => keys[name];
const ENV = env({
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
});

function storage(body: Uint8Array | string, status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchStub = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(body as BodyInit, { status });
  }) as unknown as typeof fetch;
  return { calls, fetch: fetchStub };
}

describe("loadPatternTable", () => {
  it("reads the content-addressed object and returns exactly patterns.json", async () => {
    const s = storage(new Uint8Array(bytes));
    const table = await loadPatternTable({ env: ENV, sha256, fetch: s.fetch });
    expect(JSON.parse(JSON.stringify(table))).toEqual(JSON.parse(JSON.stringify(PATTERNS)));
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toBe(
      `https://example.supabase.co/storage/v1/object/${PATTERNS_BUCKET}/${patternsObjectPath(sha256)}`,
    );
    expect(s.calls[0]!.headers).toEqual({
      apikey: "service-key",
      Authorization: "Bearer service-key",
    });
  });

  it("sends a secret key only as apikey", async () => {
    const s = storage(new Uint8Array(bytes));
    await loadPatternTable({
      env: env({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x",
      }),
      sha256,
      fetch: s.fetch,
    });
    expect(s.calls[0]!.headers).toEqual({ apikey: "sb_secret_x" });
  });

  it("refuses bytes that do not match the digest", async () => {
    const changed = new Uint8Array(bytes);
    changed[changed.length - 2] = 0x20;
    await expect(
      loadPatternTable({ env: ENV, sha256, fetch: storage(changed).fetch }),
    ).rejects.toThrow("digest mismatch");
  });

  it("fails on a storage error, a missing setting or an invalid digest", async () => {
    await expect(
      loadPatternTable({ env: ENV, sha256, fetch: storage("missing", 404).fetch }),
    ).rejects.toThrow("storage HTTP 404");
    await expect(
      loadPatternTable({ env: env({}), sha256, fetch: storage(new Uint8Array(bytes)).fetch }),
    ).rejects.toThrow("not available");
    await expect(
      loadPatternTable({ env: ENV, sha256: "abc", fetch: storage(new Uint8Array(bytes)).fetch }),
    ).rejects.toThrow("invalid digest");
  });

  it("refuses a table of the wrong shape even when the digest matches", async () => {
    const other = new TextEncoder().encode(JSON.stringify({ version: "x", rules: [] }));
    const digest = createHash("sha256").update(other).digest("hex");
    await expect(
      loadPatternTable({ env: ENV, sha256: digest, fetch: storage(other).fetch }),
    ).rejects.toThrow("unexpected shape");
  });
});
