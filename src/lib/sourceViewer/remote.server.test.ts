import { describe, expect, it } from "vitest";
import { publicUrl } from "@/lib/net/publicUrl";
import { crossSiteRequest } from "@/lib/assistant/limits.server";
import { absolutizeLinks, framingAllowed, kindOf } from "./remote.server";

const OWN = "https://app.example.org";

describe("framingAllowed", () => {
  it("allows pages without framing restrictions", () => {
    expect(framingAllowed(new Headers(), OWN)).toEqual({ ok: true, reason: null });
    expect(
      framingAllowed(new Headers({ "content-security-policy": "default-src 'self'" }), OWN).ok,
    ).toBe(true);
  });

  it("refuses X-Frame-Options deny, sameorigin and allow-from", () => {
    for (const value of ["DENY", "sameorigin", "ALLOW-FROM https://x.gov"])
      expect(framingAllowed(new Headers({ "x-frame-options": value }), OWN).ok).toBe(false);
  });

  it("reads CSP frame-ancestors", () => {
    const csp = (v: string) => new Headers({ "content-security-policy": v });
    expect(framingAllowed(csp("frame-ancestors 'self'"), OWN).ok).toBe(false);
    expect(framingAllowed(csp("frame-ancestors 'none'"), OWN).ok).toBe(false);
    expect(framingAllowed(csp("default-src *; frame-ancestors https://other.org"), OWN).ok).toBe(
      false,
    );
    expect(framingAllowed(csp("frame-ancestors *"), OWN).ok).toBe(true);
    expect(framingAllowed(csp("frame-ancestors https://app.example.org/"), OWN).ok).toBe(true);
  });
});

describe("kindOf", () => {
  const u = (s: string) => new URL(s);
  it("classifies by content type, then by extension", () => {
    expect(kindOf("application/pdf", u("https://a.gov/doc"))).toBe("pdf");
    expect(kindOf(null, u("https://a.gov/doc.PDF"))).toBe("pdf");
    expect(kindOf("image/png", u("https://a.gov/seal"))).toBe("image");
    expect(kindOf("text/html; charset=utf-8", u("https://a.gov/"))).toBe("page");
    expect(kindOf("application/xhtml+xml", u("https://a.gov/"))).toBe("page");
    expect(kindOf("text/plain", u("https://a.gov/a.txt"))).toBe("text");
    expect(kindOf("application/json", u("https://a.gov/api"))).toBe("text");
    expect(kindOf("application/zip", u("https://a.gov/bulk.zip"))).toBe("file");
    expect(kindOf(null, u("https://a.gov/form.docx"))).toBe("file");
    expect(kindOf(null, u("https://a.gov/about"))).toBe("page");
  });
});

describe("absolutizeLinks", () => {
  const base = new URL("https://www.uscourts.gov/rules-policies/current-rules");
  it("resolves relative link targets, drops link titles, images and empty links", () => {
    const md =
      'See [Civil Rules](/rules/civil) and [next](../archive "Archive").\n![seal](/seal.png)\n[abs](https://x.gov/a "A") [mail](mailto:a@b.gov) [![logo](/l.png)](/home)';
    expect(absolutizeLinks(md, base)).toBe(
      "See [Civil Rules](https://www.uscourts.gov/rules/civil) and [next](https://www.uscourts.gov/archive).\n\n[abs](https://x.gov/a) [mail](mailto:a@b.gov) ",
    );
  });

  it("never leaves a non-web target", () => {
    expect(absolutizeLinks("[x](javascript:alert(1))", base)).not.toContain("javascript:");
  });
});

describe("publicUrl", () => {
  it("accepts public web addresses", () => {
    expect(publicUrl("https://www.sec.gov/")?.hostname).toBe("www.sec.gov");
    expect(publicUrl("http://8.8.8.8/")?.hostname).toBe("8.8.8.8");
  });

  it("refuses private, loopback, link-local, metadata and non-web addresses", () => {
    for (const raw of [
      "http://localhost:3000/",
      "http://app.localhost/",
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://0x7f000001/",
      "http://10.1.2.3/",
      "http://172.16.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://metadata.google.internal/",
      "https://user:pw@example.com/",
      "ftp://example.com/",
      "file:///etc/passwd",
      "not a url",
    ])
      expect(publicUrl(raw), raw).toBeNull();
  });
});

describe("crossSiteRequest", () => {
  const req = (site?: string) =>
    new Request("https://app.example.org/api/source-file", {
      headers: site ? { "sec-fetch-site": site } : {},
    });
  it("refuses requests made by other sites and passes this site's own and direct ones", () => {
    expect(crossSiteRequest(req("cross-site"))).toBe(true);
    expect(crossSiteRequest(req("same-site"))).toBe(true);
    expect(crossSiteRequest(req("same-origin"))).toBe(false);
    expect(crossSiteRequest(req("none"))).toBe(false);
    expect(crossSiteRequest(req())).toBe(false);
  });
});
