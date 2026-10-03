import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCorpusAccess: vi.fn(),
  files: {} as Record<string, { bytes: number; sha256: string; storage_key: string }>,
}));
vi.mock("@/lib/auth/access.server", () => ({ requireCorpusAccess: mocks.requireCorpusAccess }));
vi.mock("./manifest.server.json", () => ({ default: { files: mocks.files } }));

const name = "offline-review.json";
const bytes = new TextEncoder().encode('{"offline":true}');
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const query = (fields: Record<string, string> = {}) =>
  new Request(
    `https://workspace.example/api/bundles?${new URLSearchParams({ file: name, ...fields })}`,
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  for (const key of Object.keys(mocks.files)) delete mocks.files[key];
  mocks.files[name] = {
    bytes: bytes.length,
    sha256: digest(bytes),
    storage_key: "offline/immutable.bin",
  };
  mocks.requireCorpusAccess.mockResolvedValue({ userId: "offline-invited", email: null });
  vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://xosqzzsnhxcyehcnirpa.supabase.co");
  vi.stubEnv("EXTERNAL_SUPABASE_KEY", "sb_offline_test_key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("independent private snapshot reader review", () => {
  it("rechecks access before delivering previously cached bytes", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal("fetch", fetch);
    const { serveSnapshotPage } = await import("./snapshot.server");
    expect((await serveSnapshotPage(query())).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    mocks.requireCorpusAccess.mockRejectedValue(new Error("No longer invited"));
    await expect(serveSnapshotPage(query())).rejects.toThrow("No longer invited");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ file: "../offline-review.json" }, 400],
    [{ file: "%2e%2e/offline-review.json" }, 400],
    [{ file: "/private/offline-review.json" }, 400],
    [{ file: "unlisted.json" }, 404],
    [{ page: "-1" }, 400],
    [{ page: "1" }, 409],
    [{ version: "a".repeat(64) }, 409],
    [{ page: "1", version: digest(bytes) }, 416],
  ] as const)(
    "refuses invalid/unlisted/versionless/out-of-range requests %# before storage",
    async (fields, expected) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const { serveSnapshotPage } = await import("./snapshot.server");
      const response = await serveSnapshotPage(query(fields));
      expect(response.status).toBe(expected);
      expect(fetch).not.toHaveBeenCalled();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toBe("Authorization, Cookie");
    },
  );

  it.each([bytes.slice(1), new Uint8Array(bytes.length + 1), new Uint8Array(bytes.length)])(
    "refuses truncated, oversized and changed source bytes %#",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
      const { serveSnapshotPage } = await import("./snapshot.server");
      await expect(serveSnapshotPage(query())).rejects.toThrow(
        /truncated|size mismatch|checksum mismatch/,
      );
    },
  );

  it("returns only the requested 256KiB page after checking the complete original", async () => {
    const original = new Uint8Array(256 * 1024 + 11).fill(7);
    mocks.files[name] = {
      bytes: original.length,
      sha256: digest(original),
      storage_key: "offline/large-immutable.bin",
    };
    const fetch = vi.fn().mockResolvedValue(new Response(original));
    vi.stubGlobal("fetch", fetch);
    const { serveSnapshotPage } = await import("./snapshot.server");
    const first = await serveSnapshotPage(query());
    expect((await first.arrayBuffer()).byteLength).toBe(256 * 1024);
    const second = await serveSnapshotPage(query({ page: "1", version: digest(original) }));
    expect((await second.arrayBuffer()).byteLength).toBe(11);
    expect(second.headers.get("X-Atlas-Page-Count")).toBe("2");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.requireCorpusAccess).toHaveBeenCalledTimes(2);
  });
});
