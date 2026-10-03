import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { SNAPSHOT_PAGE_BYTES } from "./protocol";

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));
import { fetchBundleSnapshot } from "./client";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function pageResponse(bytes: Uint8Array, page: number, sha: string, total: number) {
  return new Response(new Uint8Array(bytes).buffer, { headers: {
    "X-Atlas-Snapshot-Sha256": sha, "X-Atlas-Snapshot-Bytes": String(total),
    "X-Atlas-Page": String(page), "X-Atlas-Page-Count": String(Math.ceil(total / SNAPSHOT_PAGE_BYTES)),
  } });
}

describe("authenticated snapshot assembly", () => {
  it("does not request any source bytes without a session", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await fetchBundleSnapshot("/data/catalog/nj.json")).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reassembles exact UTF-8 bytes across a page boundary and sends credentials only in headers", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "test-session" } } });
    const bytes = new TextEncoder().encode('"' + "x".repeat(SNAPSHOT_PAGE_BYTES - 2) + 'é"');
    const sha = createHash("sha256").update(bytes).digest("hex");
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).not.toContain("test-session");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-session");
      const request = new URL(url, "https://atlas.example"); const page = Number(request.searchParams.get("page"));
      if (page) expect(request.searchParams.get("version")).toBe(sha);
      return pageResponse(bytes.slice(page * SNAPSHOT_PAGE_BYTES, (page + 1) * SNAPSHOT_PAGE_BYTES), page, sha, bytes.length);
    });
    vi.stubGlobal("fetch", fetcher);
    expect(new Uint8Array(await (await fetchBundleSnapshot("/data/catalog/nj.json")).arrayBuffer())).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects changed bytes even when all page lengths are correct", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "test-session" } } });
    vi.stubGlobal("fetch", vi.fn(async () => pageResponse(new TextEncoder().encode("bad"), 0, "0".repeat(64), 3)));
    await expect(fetchBundleSnapshot("/data/catalog/nj.json")).rejects.toThrow("checksum mismatch");
  });
});
