import { describe, expect, it } from "vitest";
import { parseCompanyLogo, TRADEMARK_NOTE, wikidataUrl } from "./companyLogos";
import { company_logos_open } from "./fixtures/rows";

const logo = company_logos_open[0]!.item["logo"] as Record<string, unknown>;

describe("parseCompanyLogo", () => {
  it("keeps the fixture logo with its Wikidata statement", () => {
    const l = parseCompanyLogo("0000066740", logo)!;
    expect(l.licenseFamily).toBe("public domain");
    expect(l.licenseUrlIsDeed).toBe(false);
    expect(l.thumb.url).toContain("330px-3M_wordmark.svg.png");
    expect(wikidataUrl(l)).toBe("https://www.wikidata.org/wiki/Q159433#P154");
    expect(TRADEMARK_NOTE).toBe(
      "Logo shown to identify the company. Trademarks belong to their owners; no endorsement implied.",
    );
  });

  it("drops a statement that belongs to another entity or is malformed", () => {
    expect(parseCompanyLogo("0000066740", { ...logo, wikidata: "Q1" })).toBeNull();
    expect(parseCompanyLogo("0000066740", { ...logo, statement_id: "Q159433" })).toBeNull();
    expect(parseCompanyLogo("0000066740", { ...logo, wikidata: "3M" })).toBeNull();
  });

  it("drops a bad CIK and renditions that do not match a Commons page", () => {
    expect(parseCompanyLogo("66740", logo)).toBeNull();
    expect(
      parseCompanyLogo("0000066740", {
        ...logo,
        thumb: { url: "https://storage.googleapis.com/x.png", width: 330, height: 174 },
      }),
    ).toBeNull();
  });

  it("filters on no licence family", () => {
    expect(
      parseCompanyLogo("0000066740", { ...logo, license_family: "copyrighted free use" })
        ?.licenseFamily,
    ).toBe("other");
  });

  it("keeps a logo whose licence is recorded as 'other'", () => {
    expect(
      parseCompanyLogo("0000066740", {
        ...logo,
        license: "Copyrighted free use",
        license_family: "other",
        license_url: null,
      })?.license,
    ).toBe("Copyrighted free use");
  });
});
