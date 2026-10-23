import { describe, expect, it } from "vitest";
import {
  SLOW_WAIT_MS,
  availableViews,
  failureViews,
  hostLabel,
  interceptTarget,
  looksLikeDocument,
  relayUrl,
  sizeLabel,
  startViews,
} from "./sourceLinks";

const ORIGIN = "https://app.example.org";
const plain = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};
const anchor = (href: string, attrs: Record<string, string> = {}) => ({
  href,
  hasAttribute: (name: string) => name in attrs,
  getAttribute: (name: string) => attrs[name] ?? null,
});

describe("interceptTarget", () => {
  it("opens plain clicks on outside http(s) links", () => {
    expect(interceptTarget(anchor("https://www.uscourts.gov/rules"), plain, ORIGIN)).toBe(
      "https://www.uscourts.gov/rules",
    );
    expect(interceptTarget(anchor("http://example.com/a?b=1#c"), plain, ORIGIN)).toBe(
      "http://example.com/a?b=1#c",
    );
  });

  it("leaves same-site, non-web and credentialed links to the browser", () => {
    expect(interceptTarget(anchor(`${ORIGIN}/courts/cand`), plain, ORIGIN)).toBeNull();
    expect(interceptTarget(anchor("/courts/cand"), plain, ORIGIN)).toBeNull();
    expect(interceptTarget(anchor("mailto:clerk@example.gov"), plain, ORIGIN)).toBeNull();
    expect(interceptTarget(anchor("tel:+15555550100"), plain, ORIGIN)).toBeNull();
    expect(interceptTarget(anchor("javascript:alert(1)"), plain, ORIGIN)).toBeNull();
    expect(interceptTarget(anchor("https://user:pw@example.com/"), plain, ORIGIN)).toBeNull();
  });

  it("respects modified clicks, other buttons, handled clicks, downloads and opt-outs", () => {
    const link = anchor("https://example.com/");
    expect(interceptTarget(link, { ...plain, metaKey: true }, ORIGIN)).toBeNull();
    expect(interceptTarget(link, { ...plain, ctrlKey: true }, ORIGIN)).toBeNull();
    expect(interceptTarget(link, { ...plain, shiftKey: true }, ORIGIN)).toBeNull();
    expect(interceptTarget(link, { ...plain, altKey: true }, ORIGIN)).toBeNull();
    expect(interceptTarget(link, { ...plain, button: 1 }, ORIGIN)).toBeNull();
    expect(interceptTarget(link, { ...plain, defaultPrevented: true }, ORIGIN)).toBeNull();
    expect(
      interceptTarget(anchor("https://example.com/f.zip", { download: "" }), plain, ORIGIN),
    ).toBeNull();
    expect(
      interceptTarget(
        anchor("https://example.com/", { "data-source-viewer": "off" }),
        plain,
        ORIGIN,
      ),
    ).toBeNull();
  });
});

describe("views", () => {
  const base = { embeddable: false, remoteBrowser: true, reader: true };
  it("shows documents through the relay and framable pages directly", () => {
    expect(startViews({ ...base, kind: "pdf" })).toEqual(["document"]);
    expect(startViews({ ...base, kind: "image" })).toEqual(["document"]);
    expect(startViews({ ...base, kind: "text" })).toEqual(["document"]);
    expect(startViews({ ...base, kind: "file" })).toEqual(["file"]);
    expect(startViews({ ...base, kind: "page", embeddable: true })).toEqual(["embed"]);
  });

  it("starts the text and the live browser together for a page that refuses framing, so the first ready is shown", () => {
    expect(startViews({ ...base, kind: "page" })).toEqual(["reader", "browser"]);
  });

  it("starts only the quick view that is configured, and shows nothing when neither is", () => {
    expect(startViews({ ...base, kind: "page", reader: false })).toEqual(["browser"]);
    expect(startViews({ ...base, kind: "page", remoteBrowser: false })).toEqual(["reader"]);
    expect(
      startViews({ kind: "page", embeddable: false, remoteBrowser: false, reader: false }),
    ).toEqual(["blocked"]);
  });

  it("keeps a framable page and a document as they were whatever else is configured", () => {
    expect(startViews({ ...base, kind: "page", embeddable: true, reader: false })).toEqual([
      "embed",
    ]);
    expect(startViews({ ...base, kind: "pdf", reader: false, remoteBrowser: false })).toEqual([
      "document",
    ]);
  });

  it("lists only the views a source supports", () => {
    expect(availableViews({ ...base, kind: "page", embeddable: true })).toEqual([
      "embed",
      "reader",
      "browser",
    ]);
    expect(availableViews({ ...base, kind: "page" })).toEqual(["reader", "browser"]);
    expect(availableViews({ ...base, kind: "image" })).toEqual(["document", "browser"]);
    expect(availableViews({ ...base, kind: "file" })).toEqual(["file", "reader"]);
    expect(
      availableViews({ kind: "pdf", embeddable: false, remoteBrowser: false, reader: false }),
    ).toEqual(["document"]);
  });
});

describe("failureViews", () => {
  const down = { code: "unreachable", remoteBrowser: true, reader: true };
  it("starts the text service and the live browser for an address this server could not reach", () => {
    expect(failureViews(down, false)).toEqual(["reader", "browser"]);
    expect(failureViews({ ...down, reader: false }, false)).toEqual(["browser"]);
    expect(failureViews({ ...down, reader: false, remoteBrowser: false }, false)).toEqual([
      "blocked",
    ]);
  });

  it("leaves a document that is already loading alone when only the check failed", () => {
    expect(failureViews(down, true)).toEqual(["document"]);
    expect(failureViews({ ...down, reader: false, remoteBrowser: false }, true)).toEqual([
      "document",
    ]);
  });

  it("shows nothing for an address that is not public or a sign-in problem, even with other views configured", () => {
    expect(failureViews({ ...down, code: "not_public" }, false)).toEqual(["blocked"]);
    expect(failureViews({ ...down, code: "not_public" }, true)).toEqual(["blocked"]);
    expect(failureViews({ ...down, code: "access" }, false)).toEqual(["blocked"]);
  });
});

describe("looksLikeDocument", () => {
  it("recognises an address that is plainly a PDF by its path, ignoring query and case", () => {
    expect(looksLikeDocument("https://a.gov/x/doc.pdf")).toBe(true);
    expect(looksLikeDocument("https://a.gov/x/DOC.PDF?download=1#page=3")).toBe(true);
    expect(looksLikeDocument("https://a.gov/x/doc.pdf.html")).toBe(false);
    expect(looksLikeDocument("https://a.gov/pdf")).toBe(false);
    expect(looksLikeDocument("https://a.gov/doc?file=x.pdf")).toBe(false);
    expect(looksLikeDocument("not a url")).toBe(false);
  });
});

describe("labels", () => {
  it("builds relay addresses and short labels", () => {
    expect(relayUrl("https://a.gov/x y.pdf?q=1&r=2", true)).toBe(
      "/api/source-file?url=https%3A%2F%2Fa.gov%2Fx%20y.pdf%3Fq%3D1%26r%3D2&inline=1",
    );
    expect(relayUrl("https://a.gov/f.zip", false)).toBe(
      "/api/source-file?url=https%3A%2F%2Fa.gov%2Ff.zip",
    );
    expect(hostLabel("https://www.sec.gov/edgar")).toBe("sec.gov");
    expect(hostLabel("not a url")).toBe("not a url");
    expect(sizeLabel(null)).toBeNull();
    expect(sizeLabel(512)).toBe("512 B");
    expect(sizeLabel(2048)).toBe("2 KB");
    expect(sizeLabel(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("waits a few seconds before a loading state offers the way out", () => {
    expect(SLOW_WAIT_MS).toBeGreaterThanOrEqual(2000);
    expect(SLOW_WAIT_MS).toBeLessThanOrEqual(6000);
  });
});
