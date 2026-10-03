import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/api/matter-pdf";

const mocks = vi.hoisted(() => ({
  requireCorpusAccess: vi.fn(),
  corpusAccessErrorResponse: vi.fn(),
  lookupRegistryObject: vi.fn(),
  fetchStoredPdf: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/lib/auth/access.server", () => ({
  requireCorpusAccess: mocks.requireCorpusAccess,
  corpusAccessErrorResponse: mocks.corpusAccessErrorResponse,
}));
vi.mock("@/lib/matters/source.server", () => ({
  lookupRegistryObject: mocks.lookupRegistryObject,
  fetchStoredPdf: mocks.fetchStoredPdf,
}));

type Handler = (options: { request: Request }) => Promise<Response>;
const handler = (Route as unknown as { options: { server: { handlers: { GET: Handler } } } })
  .options.server.handlers.GET;
const sha = "ab".repeat(32);
const url =
  "https://workspace.example/api/matter-pdf?source=docketbird&doc=flnd-3%3A2025-md-03140-00771";
const get = (u = url, headers: Record<string, string> = {}) => new Request(u, { headers });
const open = {
  availability: "open",
  sha256: sha,
  bytes: 9,
  bucket: "corpus-originals",
  storageKey: `seeger-weiss/pdf-sha256/ab/${sha}.pdf`,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireCorpusAccess.mockResolvedValue({ userId: "open-access", email: null });
  mocks.lookupRegistryObject.mockResolvedValue(open);
  mocks.fetchStoredPdf.mockResolvedValue(
    new Response("%PDF-1.7 x", { status: 200, headers: { "content-length": "10" } }),
  );
});

describe("matter PDF streaming route", () => {
  it.each([401, 403, 503])(
    "stops at the account guard with status %s before touching the registry",
    async (status) => {
      mocks.requireCorpusAccess.mockRejectedValue(new Error("denied"));
      mocks.corpusAccessErrorResponse.mockReturnValue(new Response("Denied", { status }));
      expect((await handler({ request: get() })).status).toBe(status);
      expect(mocks.lookupRegistryObject).not.toHaveBeenCalled();
      expect(mocks.fetchStoredPdf).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://workspace.example/api/matter-pdf",
    "https://workspace.example/api/matter-pdf?source=pacer&doc=x",
    "https://workspace.example/api/matter-pdf?source=docketbird&doc=a%00b",
    `https://workspace.example/api/matter-pdf?source=docketbird&doc=${"x".repeat(501)}`,
  ])("rejects a malformed request %s without a registry lookup", async (bad) => {
    const response = await handler({ request: get(bad) });
    expect(response.status).toBe(400);
    expect(mocks.lookupRegistryObject).not.toHaveBeenCalled();
  });

  it("never passes a client-supplied storage key anywhere", async () => {
    await handler({ request: get(`${url}&key=seeger-weiss/pdf-sha256/zz/evil.pdf&storage_key=x`) });
    expect(mocks.lookupRegistryObject).toHaveBeenCalledWith(
      "docketbird",
      "flnd-3:2025-md-03140-00771",
    );
    expect(mocks.fetchStoredPdf).toHaveBeenCalledWith(open.storageKey, null);
  });

  it("returns 404 for unknown documents and 403 for held ones, without reading storage", async () => {
    mocks.lookupRegistryObject.mockResolvedValue(null);
    expect((await handler({ request: get() })).status).toBe(404);
    mocks.lookupRegistryObject.mockResolvedValue({ availability: "held" });
    const held = await handler({ request: get() });
    expect(held.status).toBe(403);
    expect(held.headers.get("x-matter-pdf")).toBe("held");
    expect(mocks.fetchStoredPdf).not.toHaveBeenCalled();
  });

  it("streams an open document inline with private headers and a content-addressed filename", async () => {
    const response = await handler({ request: get() });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="matter-${sha.slice(0, 12)}.pdf"`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe("10");
    expect(await response.text()).toBe("%PDF-1.7 x");
    // The storage key and bucket path are never echoed to the client.
    expect([...response.headers.values()].join("\n")).not.toContain("seeger-weiss/pdf-sha256");
  });

  it("serves a download on request and forwards a byte range", async () => {
    mocks.fetchStoredPdf.mockResolvedValue(
      new Response("%PDF-1.7", {
        status: 206,
        headers: { "content-length": "8", "content-range": "bytes 0-7/10" },
      }),
    );
    const response = await handler({ request: get(`${url}&download=1`, { range: "bytes=0-7" }) });
    expect(mocks.fetchStoredPdf).toHaveBeenCalledWith(open.storageKey, "bytes=0-7");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-7/10");
    expect(response.headers.get("content-disposition")).toContain("attachment");
  });

  it("reports registry or storage failures generically", async () => {
    mocks.lookupRegistryObject.mockRejectedValue(new Error("secret registry detail"));
    const registry = await handler({ request: get() });
    expect(registry.status).toBe(503);
    expect(await registry.text()).not.toContain("secret");
    mocks.lookupRegistryObject.mockResolvedValue(open);
    mocks.fetchStoredPdf.mockRejectedValue(new Error("storage grant leaked"));
    const storage = await handler({ request: get() });
    expect(storage.status).toBe(502);
    expect(await storage.text()).not.toContain("leaked");
    mocks.fetchStoredPdf.mockResolvedValue(new Response("nope", { status: 404 }));
    expect((await handler({ request: get() })).status).toBe(404);
  });
});
