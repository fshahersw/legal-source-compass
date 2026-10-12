import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  methods: [] as string[],
  getRequest: vi.fn(
    () => new Request("https://example.invalid/_serverFn/test", { method: "POST" }),
  ),
  setResponseHeader: vi.fn(),
  extractConversation: vi.fn(async () => ({
    status: "unavailable",
    reason: "not_configured",
    message: "Not configured",
  })),
  conversationCapability: vi.fn(() => ({ configured: false, providerName: null })),
  requireCorpusAccess: vi.fn(async () => ({ userId: "open-access", email: null })),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: ({ method }: { method: string }) => {
    mocks.methods.push(method);
    const builder = {
      inputValidator: (_validator: unknown) => builder,
      handler: (handler: (context: { data: unknown }) => unknown) => handler,
    };
    return builder;
  },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: mocks.getRequest,
  setResponseHeader: mocks.setResponseHeader,
}));
vi.mock("./conversation.server", () => ({
  extractConversation: mocks.extractConversation,
  conversationCapability: mocks.conversationCapability,
}));
vi.mock("@/lib/auth/access.server", () => ({ requireCorpusAccess: mocks.requireCorpusAccess }));
import { extractConversationFacts, getConversationCapability } from "./conversation.functions";

describe("conversation server function transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequest.mockReturnValue(
      new Request("https://example.invalid/_serverFn/test", { method: "POST" }),
    );
  });

  it("uses GET only for capability and POST for private narrative extraction", () => {
    expect(mocks.methods).toEqual(["GET", "POST"]);
  });

  it("returns only configuration capability with caching disabled", async () => {
    const result = await (
      getConversationCapability as unknown as (arg: { data: unknown }) => Promise<unknown>
    )({ data: undefined });
    expect(result).toEqual({ configured: false, providerName: null });
    expect(mocks.requireCorpusAccess).toHaveBeenCalledOnce();
    expect(mocks.setResponseHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  });

  it("passes private body data to the bounded server adapter, never to URL parameters", async () => {
    const data = { messages: [{ id: "u1", role: "user", content: "Synthetic case facts" }] };
    await (extractConversationFacts as unknown as (arg: { data: unknown }) => Promise<unknown>)({
      data,
    });
    expect(mocks.extractConversation).toHaveBeenCalledExactlyOnceWith(data);
    expect(mocks.requireCorpusAccess).toHaveBeenCalledOnce();
    expect(mocks.getRequest().url).not.toContain("Synthetic");
    expect(mocks.setResponseHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  });

  it("rejects declared oversized bodies before the provider adapter", async () => {
    mocks.getRequest.mockReturnValue(
      new Request("https://example.invalid/_serverFn/test", {
        method: "POST",
        headers: { "Content-Length": "200001" },
      }),
    );
    const result = await (
      extractConversationFacts as unknown as (arg: { data: unknown }) => Promise<unknown>
    )({ data: {} });
    expect(result).toMatchObject({ status: "invalid_input" });
    expect(mocks.extractConversation).not.toHaveBeenCalled();
  });
});
