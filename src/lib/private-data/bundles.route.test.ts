import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/api/bundles";

const mocks = vi.hoisted(() => ({
  requireCorpusAccess: vi.fn(),
  corpusAccessErrorResponse: vi.fn(),
  serveSnapshotPage: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/lib/auth/access.server", () => ({
  requireCorpusAccess: mocks.requireCorpusAccess,
  corpusAccessErrorResponse: mocks.corpusAccessErrorResponse,
}));
vi.mock("@/lib/private-data/snapshot.server", () => ({
  serveSnapshotPage: mocks.serveSnapshotPage,
}));

type Handler = (options: { request: Request }) => Promise<Response>;
const handler = (Route as unknown as { options: { server: { handlers: { GET: Handler } } } })
  .options.server.handlers.GET;
const request = new Request(
  "https://workspace.example/api/bundles?file=atlas-import-bundle.json&page=0",
);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireCorpusAccess.mockResolvedValue({
    userId: "offline-verified-invited-user",
    email: null,
  });
  mocks.serveSnapshotPage.mockResolvedValue(
    new Response("offline bounded page", {
      headers: { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" },
    }),
  );
});

describe("private bundle route authorization", () => {
  it.each([401, 403, 503])(
    "does not consult the manifest or byte cache after auth status %s",
    async (status) => {
      mocks.requireCorpusAccess.mockRejectedValue(new Error("Access denied"));
      mocks.corpusAccessErrorResponse.mockReturnValue(new Response("Denied", { status }));
      expect((await handler({ request })).status).toBe(status);
      expect(mocks.serveSnapshotPage).not.toHaveBeenCalled();
    },
  );

  it("authorizes before passing the unchanged request to the bounded page reader", async () => {
    const response = await handler({ request });
    expect(response.status).toBe(200);
    expect(mocks.requireCorpusAccess).toHaveBeenCalledWith(request);
    expect(mocks.serveSnapshotPage).toHaveBeenCalledWith(request);
    expect(mocks.requireCorpusAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.serveSnapshotPage.mock.invocationCallOrder[0]!,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns a generic failure instead of exposing storage/configuration errors", async () => {
    mocks.serveSnapshotPage.mockRejectedValue(new Error("sensitive storage grant and object key"));
    const response = await handler({ request });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
