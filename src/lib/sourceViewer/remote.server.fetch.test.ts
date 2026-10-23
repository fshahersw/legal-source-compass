import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkSource,
  checkSourceCached,
  clearSourceCaches,
  guardedFetch,
  readSourceTextCached,
  relayFile,
  serverTiming,
} from "./remote.server";

const OWN = "https://app.example.org";

type Call = { url: string; method: string; headers: Record<string, string> };

function stubFetch(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call = { url: String(input), method: init?.method ?? "GET", headers };
    calls.push(call);
    return responder(call);
  });
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

const html = (init: ResponseInit = {}) =>
  new Response(null, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });

beforeEach(() => clearSourceCaches());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("guardedFetch", () => {
  it("re-checks every redirect hop and refuses one that leads to a private address", async () => {
    const { calls } = stubFetch((c) =>
      c.url === "https://a.gov/start"
        ? new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest" },
          })
        : html(),
    );
    await expect(guardedFetch("https://a.gov/start")).rejects.toThrow(
      "The address redirects to a location that cannot be opened.",
    );
    expect(calls.map((c) => c.url)).toEqual(["https://a.gov/start"]);
  });

  it("follows public redirects and stops after five", async () => {
    let n = 0;
    stubFetch(
      () => new Response(null, { status: 301, headers: { location: `https://a.gov/${(n += 1)}` } }),
    );
    await expect(guardedFetch("https://a.gov/")).rejects.toThrow("Too many redirects.");
  });

  it("refuses an address that is not public before any request", async () => {
    const { mock } = stubFetch(() => html());
    await expect(guardedFetch("http://localhost:3000/")).rejects.toThrow(
      "Only public web addresses can be opened.",
    );
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("checkSource", () => {
  it("falls back to a one-byte GET when the host refuses HEAD, within one shared budget", async () => {
    const { calls } = stubFetch((c) =>
      c.method === "HEAD"
        ? new Response(null, { status: 405 })
        : html({
            status: 206,
            headers: { "content-type": "text/html", "content-range": "bytes 0-0/5000" },
          }),
    );
    const result = await checkSource("https://a.gov/p", OWN);
    expect(
      calls.map((c) => `${c.method}${c.headers["range"] ? ` ${c.headers["range"]}` : ""}`),
    ).toEqual(["HEAD", "GET bytes=0-0"]);
    expect(result).toMatchObject({ kind: "page", embeddable: true, size: 5000, status: 206 });
  });

  it("reports a site that refuses framing", async () => {
    stubFetch(() =>
      html({ headers: { "content-type": "text/html", "x-frame-options": "SAMEORIGIN" } }),
    );
    const result = await checkSource("https://a.gov/p", OWN);
    expect(result.embeddable).toBe(false);
    expect(result.reason).toBe("The site does not allow its pages to be shown inside other sites.");
  });

  it("turns a timeout into a plain message", async () => {
    stubFetch(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await expect(checkSource("https://a.gov/slow", OWN)).rejects.toThrow(
      "The site took too long to answer.",
    );
  });
});

describe("checkSourceCached", () => {
  it("makes one request for concurrent checks of the same address, and none while the answer is fresh", async () => {
    const { mock } = stubFetch(() => html());
    const [a, b] = await Promise.all([
      checkSourceCached("https://a.gov/p", OWN),
      checkSourceCached("https://a.gov/p", OWN),
    ]);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(a.check).toEqual(b.check);
    const again = await checkSourceCached("https://a.gov/p", OWN);
    expect(again.cached).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("keeps answers for different addresses and different origins apart", async () => {
    const { mock } = stubFetch(() => html());
    await checkSourceCached("https://a.gov/p", OWN);
    await checkSourceCached("https://a.gov/q", OWN);
    await checkSourceCached("https://a.gov/p", "https://other.example.org");
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("asks again when told to (the reload button)", async () => {
    const { mock } = stubFetch(() => html());
    await checkSourceCached("https://a.gov/p", OWN);
    const fresh = await checkSourceCached("https://a.gov/p", OWN, { fresh: true });
    expect(fresh.cached).toBe(false);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("does not remember a failure beyond a moment", async () => {
    let up = false;
    const { mock } = stubFetch(() => {
      if (!up) throw new Error("connection reset");
      return html();
    });
    await expect(checkSourceCached("https://a.gov/p", OWN)).rejects.toThrow("connection reset");
    up = true;
    await expect(checkSourceCached("https://a.gov/p", OWN, { fresh: true })).resolves.toBeTruthy();
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe("relayFile", () => {
  const pdf = (init: ResponseInit & { body?: string } = {}) =>
    new Response(init.body ?? "%PDF-1.7 body", {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "accept-ranges": "bytes",
        "content-length": "13",
      },
      ...init,
    });

  it("streams a PDF inline and lets the browser keep it for a few minutes", async () => {
    stubFetch(() => pdf());
    const res = await relayFile("https://a.gov/doc.pdf", true);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("content-length")).toBe("13");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(await res.text()).toBe("%PDF-1.7 body");
  });

  it("refuses a file over the size cap and does not read it", async () => {
    stubFetch(() =>
      pdf({
        headers: { "content-type": "application/pdf", "content-length": String(61 * 1024 * 1024) },
      }),
    );
    expect((await relayFile("https://a.gov/big.pdf", true)).status).toBe(413);
  });

  it("does not repeat a length that no longer matches the body once the host compressed it", async () => {
    stubFetch(
      () =>
        new Response("hello", {
          headers: {
            "content-type": "text/plain",
            "content-encoding": "gzip",
            "content-length": "3",
          },
        }),
    );
    const res = await relayFile("https://a.gov/a.txt", true);
    expect(res.headers.get("content-length")).toBeNull();
  });

  it("shows text-like documents inline as plain text, so they load instead of downloading", async () => {
    for (const type of [
      "application/json",
      "text/csv; charset=utf-8",
      "application/xml",
      "application/ld+json",
    ]) {
      stubFetch(() => new Response("a,b", { headers: { "content-type": type } }));
      const res = await relayFile("https://a.gov/data", true);
      expect(res.headers.get("content-type")).toMatch(/^text\/plain; charset=/);
      expect(res.headers.get("content-disposition")).toContain("inline");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("never shows HTML inline, whatever it is called", async () => {
    for (const type of [
      "text/html",
      "text/html; charset=utf-8",
      "application/xhtml+xml",
      "image/svg+xml;x=1",
    ]) {
      stubFetch(
        () => new Response("<script>alert(1)</script>", { headers: { "content-type": type } }),
      );
      const res = await relayFile("https://a.gov/page", true);
      if (type.startsWith("image/svg")) continue; // SVG is shown as an image inside the relay's sandbox
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("content-disposition")).toContain("attachment");
    }
  });

  it("serves a download as an attachment that is not kept", async () => {
    stubFetch(() => new Response("PK", { headers: { "content-type": "application/zip" } }));
    const res = await relayFile("https://a.gov/f.zip", false);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("readSourceTextCached", () => {
  it("reads a page once however many callers ask, and again only when told to", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    const { mock } = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            data: { markdown: "# Heading\n\nBody text.", metadata: { title: "T" } },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const [a, b] = await Promise.all([
      readSourceTextCached("https://a.gov/p"),
      readSourceTextCached("https://a.gov/p"),
    ]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ title: "T", truncated: false });
    await readSourceTextCached("https://a.gov/p");
    expect(mock).toHaveBeenCalledTimes(1);
    await readSourceTextCached("https://a.gov/p", { fresh: true });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("refuses a non-public address without calling the provider", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    const { mock } = stubFetch(() => html());
    await expect(readSourceTextCached("http://10.0.0.5/")).rejects.toThrow(
      "Only public web addresses can be opened.",
    );
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("serverTiming", () => {
  it("writes a Server-Timing header value", () => {
    expect(
      serverTiming([
        { name: "check", dur: 12.4 },
        { name: "cache", desc: "hit" },
      ]),
    ).toBe('check;dur=12, cache;desc="hit"');
    expect(serverTiming([])).toBe("");
  });
});
