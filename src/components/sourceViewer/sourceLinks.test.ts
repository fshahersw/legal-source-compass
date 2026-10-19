import { describe, expect, it } from "vitest";
import {
  availableViews,
  hostLabel,
  initialView,
  interceptTarget,
  relayUrl,
  sizeLabel,
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
    expect(initialView({ ...base, kind: "pdf" })).toBe("document");
    expect(initialView({ ...base, kind: "image" })).toBe("document");
    expect(initialView({ ...base, kind: "text" })).toBe("document");
    expect(initialView({ ...base, kind: "file" })).toBe("file");
    expect(initialView({ ...base, kind: "page", embeddable: true })).toBe("embed");
  });

  it("falls back from a page that refuses framing to the live browser, then text, then nothing", () => {
    expect(initialView({ ...base, kind: "page" })).toBe("browser");
    expect(initialView({ ...base, kind: "page", remoteBrowser: false })).toBe("reader");
    expect(
      initialView({ kind: "page", embeddable: false, remoteBrowser: false, reader: false }),
    ).toBe("blocked");
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
});
