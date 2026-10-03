import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  corpusAuthRequired,
  corpusRequestToken,
  corpusSessionCookie,
  isAllowedCorpusUser,
} from "./accessPolicy";
import { corpusLogoutResponse } from "./logout.server";
import {
  OPEN_ACCESS_IDENTITY,
  corpusAccessErrorResponse,
  requireCorpusAccess,
} from "./access.server";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: auth.createClient }));
const id = "11111111-2222-3333-4444-555555555555";
const anotherId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const verified = { id, email: "account@example.test", email_confirmed_at: "2026-10-02T00:00:00Z" };
const request = (
  headers: Record<string, string> = { authorization: "Bearer offline-test-token" },
) => new Request("https://workspace.example/api", { headers });

beforeEach(() => {
  vi.resetAllMocks();
  auth.createClient.mockReturnValue({ auth: { getUser: auth.getUser } });
  auth.getUser.mockResolvedValue({ data: { user: verified }, error: null });
  vi.stubEnv("SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "offline-test-publishable-key");
  // The enforcement suites below run with account enforcement ON whatever the surrounding environment says.
  vi.stubEnv("CORPUS_REQUIRE_AUTH", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("CORPUS_REQUIRE_AUTH switch", () => {
  it.each([undefined, "", "0", "false", "off", "no", "yes", "2", " "])("is off for %j", (value) => {
    expect(corpusAuthRequired({ CORPUS_REQUIRE_AUTH: value })).toBe(false);
  });
  it.each(["1", "true", "TRUE", " True "])("is on for %j", (value) => {
    expect(corpusAuthRequired({ CORPUS_REQUIRE_AUTH: value })).toBe(true);
  });
  it("reads the process environment by default and is off when unset", () => {
    vi.stubEnv("CORPUS_REQUIRE_AUTH", "");
    expect(corpusAuthRequired()).toBe(false);
    vi.stubEnv("CORPUS_REQUIRE_AUTH", "1");
    expect(corpusAuthRequired()).toBe(true);
  });
  it("skips every credential and provider call while enforcement is off", async () => {
    vi.stubEnv("CORPUS_REQUIRE_AUTH", "");
    vi.stubEnv("SUPABASE_URL", "not-a-url");
    await expect(requireCorpusAccess(request({}))).resolves.toEqual(OPEN_ACCESS_IDENTITY);
    await expect(requireCorpusAccess(request({ authorization: "Bearer forged" }))).resolves.toEqual(
      OPEN_ACCESS_IDENTITY,
    );
    expect(auth.createClient).not.toHaveBeenCalled();
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(OPEN_ACCESS_IDENTITY.email).toBeNull();
  });
  it("enforces the verified-account rules again as soon as the switch is on", async () => {
    vi.stubEnv("CORPUS_REQUIRE_AUTH", "");
    await expect(requireCorpusAccess(request({}))).resolves.toEqual(OPEN_ACCESS_IDENTITY);
    vi.stubEnv("CORPUS_REQUIRE_AUTH", "true");
    await expect(requireCorpusAccess(request({}))).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe("verified account policy", () => {
  it("admits a confirmed account without requiring an invitation list", () => {
    expect(isAllowedCorpusUser(verified)).toBe(true);
  });
  it.each([null, "", "   "])("denies accounts without an email %s", (email) => {
    expect(isAllowedCorpusUser({ ...verified, email })).toBe(false);
  });
  it("denies a provider account with no email property", () => {
    expect(isAllowedCorpusUser({ id, email_confirmed_at: verified.email_confirmed_at })).toBe(
      false,
    );
  });
  it("requires provider-confirmed email, regardless of client profile claims", () => {
    expect(isAllowedCorpusUser({ ...verified, email_confirmed_at: null })).toBe(false);
  });
  it("denies anonymous Supabase identities even if they claim confirmed email", () => {
    expect(isAllowedCorpusUser({ ...verified, is_anonymous: true })).toBe(false);
  });
});

describe("server authentication boundary", () => {
  it("denies anonymous requests before creating any provider client", async () => {
    await expect(requireCorpusAccess(request({}))).rejects.toMatchObject({ statusCode: 401 });
    expect(auth.createClient).not.toHaveBeenCalled();
  });
  it("requires provider verification before trusting an account", async () => {
    expect(await requireCorpusAccess(request())).toEqual({ userId: id, email: verified.email });
    expect(auth.getUser).toHaveBeenCalledWith("offline-test-token");
  });
  it("does not trust an unsigned or client-decoded identity", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    await expect(
      requireCorpusAccess(request({ authorization: "Bearer fake.fake.fake" })),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
  it("admits any different provider-verified account with confirmed email", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { ...verified, id: anotherId } }, error: null });
    await expect(requireCorpusAccess(request())).resolves.toMatchObject({ userId: anotherId });
  });
  it("denies provider-verified but unconfirmed accounts", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: { ...verified, email_confirmed_at: null } },
      error: null,
    });
    await expect(requireCorpusAccess(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("denies anonymous provider identities", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: { ...verified, is_anonymous: true } },
      error: null,
    });
    await expect(requireCorpusAccess(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([undefined, "", "http://outside.example.test", "not-a-url"])(
    "fails closed for invalid auth origin %s",
    async (url) => {
      vi.stubEnv("SUPABASE_URL", url);
      await expect(requireCorpusAccess(request())).rejects.toMatchObject({ statusCode: 503 });
    },
  );
  it.each([429, 500, 503])("does not admit accounts when auth returns %s", async (status) => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { status } });
    await expect(requireCorpusAccess(request())).rejects.toMatchObject({ statusCode: 503 });
  });
  it("turns provider exceptions into a generic service denial", async () => {
    auth.getUser.mockRejectedValue(new Error("sensitive provider internals"));
    await expect(requireCorpusAccess(request())).rejects.toMatchObject({
      statusCode: 503,
      message: "Workspace access is temporarily unavailable.",
    });
  });
  it("shares provider verification only within the exact request", async () => {
    const same = request();
    await Promise.all([requireCorpusAccess(same), requireCorpusAccess(same)]);
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    await requireCorpusAccess(request());
    expect(auth.getUser).toHaveBeenCalledTimes(2);
  });
  it("sanitizes unrelated errors and prevents shared caches", async () => {
    const response = corpusAccessErrorResponse(new Error("private upstream details"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private upstream details");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  });
});

describe("session cookie and logout", () => {
  it("reads only the exact host cookie and rejects duplicate or malformed values", () => {
    expect(corpusRequestToken(request({ cookie: "__Host-corpus-session=offline-token" }))).toBe(
      "offline-token",
    );
    expect(
      corpusRequestToken(request({ cookie: "corpus-session-local=offline-token" })),
    ).toBeNull();
    expect(
      corpusRequestToken(
        request({ cookie: "__Host-corpus-session=one; __Host-corpus-session=two" }),
      ),
    ).toBeNull();
    expect(corpusRequestToken(request({ cookie: "__Host-corpus-session=%zz" }))).toBeNull();
  });
  it.each(["Basic invalid", "Bearer ", "Bearer token extra"])(
    "does not fall back to cookies after bad auth header %s",
    (authorization) => {
      expect(
        corpusRequestToken(
          request({ authorization, cookie: "__Host-corpus-session=offline-token" }),
        ),
      ).toBeNull();
    },
  );
  it("issues a short-lived secure HttpOnly host cookie without a domain", () => {
    const cookie = corpusSessionCookie(request(), "offline-token");
    expect(cookie).toBe(
      "__Host-corpus-session=offline-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure",
    );
    expect(cookie).not.toContain("Domain=");
  });
  it("permits an insecure cookie only on HTTP loopback development", () => {
    expect(
      corpusSessionCookie(new Request("http://127.0.0.1:4173/api"), "offline-token"),
    ).toContain("corpus-session-local=");
    expect(
      corpusSessionCookie(new Request("http://remote.example/api"), "offline-token"),
    ).toContain("; Secure");
  });
  it("clears an expired session with same-origin POST without requiring a live JWT", () => {
    const response = corpusLogoutResponse(
      new Request("https://workspace.example/api/auth/logout", {
        method: "POST",
        headers: { origin: "https://workspace.example" },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it.each([null, "https://other.example"])("denies cross-origin logout %s", (origin) => {
    const response = corpusLogoutResponse(
      new Request("https://workspace.example/api/auth/logout", {
        method: "POST",
        headers: origin ? { origin } : {},
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("does not change a session on GET", () => {
    expect(
      corpusLogoutResponse(new Request("https://workspace.example/api/auth/logout")).status,
    ).toBe(405);
  });
});
