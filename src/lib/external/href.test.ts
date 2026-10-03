import { describe, expect, it } from "vitest";
import { externalHref } from "./href";

describe("externalHref", () => {
  it("percent-encodes raw spaces without touching the rest of the URL", () => {
    expect(
      externalHref("https://www.uscourts.gov/sites/default/files/Smith, John 2024.pdf?x=1&y=2#p3"),
    ).toBe("https://www.uscourts.gov/sites/default/files/Smith,%20John%202024.pdf?x=1&y=2#p3");
  });

  it("never double-encodes an existing escape and fixes a bare percent sign", () => {
    expect(externalHref("https://x.test/a%20b.pdf")).toBe("https://x.test/a%20b.pdf");
    expect(externalHref("https://x.test/a%2Fb")).toBe("https://x.test/a%2Fb");
    expect(externalHref("https://x.test/100%.pdf")).toBe("https://x.test/100%25.pdf");
    expect(externalHref("https://x.test/a%2.pdf")).toBe("https://x.test/a%252.pdf");
  });

  it("encodes non-ASCII and characters a URL may not contain, and trims the ends", () => {
    expect(externalHref("https://x.test/é.pdf")).toBe("https://x.test/%C3%A9.pdf");
    expect(externalHref("https://x.test/a|b{c}.pdf")).toBe("https://x.test/a%7Cb%7Bc%7D.pdf");
    expect(externalHref("  https://x.test/ok  ")).toBe("https://x.test/ok");
  });

  it("returns an already-valid URL unchanged", () => {
    const url = "https://www.courtlistener.com/docket/69674950/?filed_after=2025-01-01#entry-3";
    expect(externalHref(url)).toBe(url);
  });
});
