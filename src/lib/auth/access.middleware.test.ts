import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  rejectObsoleteDataAssets,
  requireAccountCorpusFunction,
  requireAccountCorpusRequest,
} from "./access.middleware";
import { Route as FilesRoute } from "@/routes/api/files";

const mocks = vi.hoisted(() => ({
  requireCorpusAccess: vi.fn(),
  corpusAccessErrorResponse: vi.fn(),
  getRequest: vi.fn(),
  setResponseHeader: vi.fn(),
  fetchArtifact: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => ({ server: (server: unknown) => ({ options: { server } }) }),
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: mocks.getRequest,
  setResponseHeader: mocks.setResponseHeader,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("./access.server", () => ({
  requireCorpusAccess: mocks.requireCorpusAccess,
  corpusAccessErrorResponse: mocks.corpusAccessErrorResponse,
}));
vi.mock("@/lib/external/rest.server", () => ({ fetchArtifact: mocks.fetchArtifact }));

type Handler = (options: Record<string, unknown>) => Promise<unknown>;
const functionGuard = (requireAccountCorpusFunction as unknown as { options: { server: Handler } })
  .options.server;
const requestGuard = (requireAccountCorpusRequest as unknown as { options: { server: Handler } })
  .options.server;
const artifactRoute = (
  FilesRoute as unknown as { options: { server: { handlers: { GET: Handler } } } }
).options.server.handlers.GET;
const obsoleteAssetGuard = (rejectObsoleteDataAssets as unknown as { options: { server: Handler } })
  .options.server;
const request = new Request("https://workspace.example/api/files?route=%2Fpublished%2Ffile.pdf");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getRequest.mockReturnValue(request);
  mocks.requireCorpusAccess.mockResolvedValue({ userId: "verified-account-user", email: null });
  mocks.corpusAccessErrorResponse.mockReturnValue(new Response("Denied", { status: 401 }));
  mocks.fetchArtifact.mockResolvedValue(new Response("offline bytes"));
});

describe("global corpus middleware", () => {
  it("returns a private 404 before routing an obsolete static asset", async () => {
    const next = vi.fn();
    const response = (await obsoleteAssetGuard({
      request: new Request("https://workspace.example/data/atlas-import-bundle.json"),
      next,
    })) as Response;
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(next).not.toHaveBeenCalled();
    expect(mocks.requireCorpusAccess).not.toHaveBeenCalled();
  });
  it("retains authenticated dataset browser routing", async () => {
    const next = vi.fn().mockResolvedValue({ response: new Response("browser route") });
    await obsoleteAssetGuard({ request: new Request("https://workspace.example/data/mdls"), next });
    expect(next).toHaveBeenCalledOnce();
  });
  it("denies a direct/SSR function call before its handler runs", async () => {
    const denied = new Error("Denied");
    mocks.requireCorpusAccess.mockRejectedValue(denied);
    const next = vi.fn();
    await expect(functionGuard({ next })).rejects.toBe(denied);
    expect(next).not.toHaveBeenCalled();
  });
  it("puts only the verified identity in function context and prevents shared caching", async () => {
    const next = vi.fn().mockResolvedValue({ result: "handler result" });
    await functionGuard({ next });
    expect(mocks.requireCorpusAccess).toHaveBeenCalledWith(request);
    expect(next).toHaveBeenCalledWith({
      context: { corpusIdentity: { userId: "verified-account-user", email: null } },
    });
    expect(mocks.setResponseHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  });
  it("returns an HTTP denial before public server-function dispatch", async () => {
    mocks.requireCorpusAccess.mockRejectedValue(new Error("Denied"));
    const next = vi.fn();
    const response = (await requestGuard({ request, handlerType: "serverFn", next })) as Response;
    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
  it("permits the sign-in shell without approving corpus data", async () => {
    const next = vi.fn().mockResolvedValue({ response: new Response("sign-in shell") });
    await requestGuard({ request, handlerType: "router", next });
    expect(next).toHaveBeenCalledOnce();
    expect(mocks.requireCorpusAccess).not.toHaveBeenCalled();
  });
  it("marks authorized function responses private even when a handler provides a cache header", async () => {
    const response = new Response("result", {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
    const next = vi.fn().mockResolvedValue({ response });
    await requestGuard({ request, handlerType: "serverFn", next });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  });
});

describe("private corpus artifact route", () => {
  it("never reaches artifact lookup/storage for an unauthorized request", async () => {
    mocks.requireCorpusAccess.mockRejectedValue(new Error("Denied"));
    const response = (await artifactRoute({ request })) as Response;
    expect(response.status).toBe(401);
    expect(mocks.fetchArtifact).not.toHaveBeenCalled();
  });
  it("keeps ready-gated artifact delivery behind account verification", async () => {
    const response = (await artifactRoute({ request })) as Response;
    expect(mocks.fetchArtifact).toHaveBeenCalledWith("/published/file.pdf");
    expect(mocks.requireCorpusAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetchArtifact.mock.invocationCallOrder[0]!,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
