import { describe, expect, it, vi } from "vitest";
import {
  CHECK_FAILURE_TTL_MS,
  CHECK_TTL_MS,
  createSessionRefresher,
  createSourceClient,
} from "./sourceClient";
import type { CheckResult } from "./sourceLinks";

const page: CheckResult = {
  url: "https://a.gov/x",
  finalUrl: "https://a.gov/x",
  embeddable: true,
  reason: null,
  contentType: "text/html",
  kind: "page",
  fileName: null,
  size: null,
  remoteBrowser: true,
  reader: true,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(responder: (url: string) => Response | Promise<Response>) {
  let t = 10_000;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    responder(String(input)),
  );
  const client = createSourceClient({
    fetch: fetchMock as unknown as typeof fetch,
    headers: async () => ({}),
    now: () => t,
  });
  return { client, fetchMock, advance: (ms: number) => (t += ms) };
}

describe("source client: check", () => {
  it("asks once for the same address, however many callers and prefetches", async () => {
    const { client, fetchMock } = setup(() => json(page));
    const [a, b] = await Promise.all([client.check(page.url), client.check(page.url)]);
    client.prefetchCheck(page.url);
    await client.check(page.url);
    expect(a).toEqual({ ok: true, data: page });
    expect(b).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `/api/source-check?url=${encodeURIComponent(page.url)}`,
    );
  });

  it("asks the server again when told to, without the browser's own copy", async () => {
    const { client, fetchMock } = setup(() => json(page));
    await client.check(page.url);
    await client.check(page.url, { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      `/api/source-check?url=${encodeURIComponent(page.url)}&fresh=1`,
    );
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ cache: "reload" });
  });

  it("a prefetch started on hover is the request the click then uses", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { client, fetchMock } = setup(async () => {
      await gate;
      return json(page);
    });
    expect(client.prefetchCheck(page.url)).toBe(true);
    const clicked = client.check(page.url);
    await Promise.resolve();
    release();
    expect((await clicked).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("remembers a success for five minutes and asks again after", async () => {
    const { client, fetchMock, advance } = setup(() => json(page));
    await client.check(page.url);
    advance(CHECK_TTL_MS - 1);
    await client.check(page.url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(2);
    await client.check(page.url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries an unreachable address soon, but keeps a non-public one", async () => {
    const { client, fetchMock, advance } = setup((url) =>
      url.includes("private")
        ? json({ error: "Only public web addresses can be opened here.", code: "not_public" }, 400)
        : json({ error: "down", code: "unreachable", remoteBrowser: true, reader: true }, 422),
    );
    const down = await client.check("https://down.gov/");
    expect(down).toMatchObject({
      ok: false,
      code: "unreachable",
      remoteBrowser: true,
      reader: true,
    });
    await client.check("https://down.gov/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(CHECK_FAILURE_TTL_MS + 1);
    await client.check("https://down.gov/");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await client.check("https://private.example/");
    await client.check("https://private.example/");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never remembers a sign-in failure", async () => {
    const { client, fetchMock } = setup(() => json({ error: "Sign in" }, 401));
    expect(await client.check("https://a.gov/")).toMatchObject({ ok: false, code: "access" });
    await client.check("https://a.gov/");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a network failure as unreachable without throwing", async () => {
    const { client } = setup(() => {
      throw new Error("offline");
    });
    expect(await client.check("https://a.gov/")).toMatchObject({
      ok: false,
      code: "unreachable",
      remoteBrowser: false,
      reader: false,
    });
  });

  it("limits hover prefetches so a sweep across a table cannot use up the rate limit", async () => {
    const { client, fetchMock, advance } = setup(() => json(page));
    const started = Array.from({ length: 10 }, (_, i) =>
      client.prefetchCheck(`https://a.gov/${i}`),
    );
    expect(started.filter(Boolean)).toHaveLength(6);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(6);
    // Clicks are never limited by the budget.
    await client.check("https://a.gov/9");
    expect(fetchMock).toHaveBeenCalledTimes(7);
    advance(6_000);
    expect(client.prefetchCheck("https://a.gov/10")).toBe(true);
  });
});

describe("source client: page text", () => {
  it("reads the text once and serves it from memory afterwards", async () => {
    const { client, fetchMock } = setup(() =>
      json({ title: "T", markdown: "# T\n\ntext", truncated: false }),
    );
    const first = await client.reader("https://a.gov/p");
    const again = await client.reader("https://a.gov/p");
    expect(first).toEqual({
      ok: true,
      data: { title: "T", markdown: "# T\n\ntext", truncated: false },
    });
    expect(again).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The reload button reads again, and tells the server and the browser's own cache to do so too.
    await client.reader("https://a.gov/p", { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("&fresh=1");
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ cache: "reload" });
  });

  it("turns an error body or an empty page into a message", async () => {
    const a = setup(() => json({ error: "No readable text was found on the page." }, 422));
    expect(await a.client.reader("https://a.gov/p")).toEqual({
      ok: false,
      message: "No readable text was found on the page.",
    });
    const b = setup(() => json({ title: "x" }));
    expect(await b.client.reader("https://a.gov/p")).toEqual({
      ok: false,
      message: "The page text could not be read.",
    });
  });
});

describe("session refresher", () => {
  it("stops asking once the server reports that sign-in is not enforced", async () => {
    const refresh = vi.fn(async () => ({ required: false }));
    const ensure = createSessionRefresher(refresh);
    await ensure();
    await ensure();
    await ensure();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes a required session once per interval and shares a refresh in flight", async () => {
    let t = 0;
    const refresh = vi.fn(async () => ({ required: true }));
    const ensure = createSessionRefresher(refresh, { everyMs: 1000, now: () => t });
    await Promise.all([ensure(), ensure()]);
    expect(refresh).toHaveBeenCalledTimes(1);
    t = 999;
    await ensure();
    expect(refresh).toHaveBeenCalledTimes(1);
    t = 1001;
    await ensure();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("tries again after a failed refresh and never rejects", async () => {
    const refresh = vi
      .fn<() => Promise<{ required: boolean }>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ required: true });
    const ensure = createSessionRefresher(refresh);
    await expect(ensure()).resolves.toBeUndefined();
    await ensure();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
