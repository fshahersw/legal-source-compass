import { describe, expect, it } from "vitest";
import {
  hostOf,
  httpsUrlUnder,
  IMAGE_HOSTS,
  imageSrcSet,
  isWideMark,
  optionalText,
  parseFilePage,
  parseLicence,
  parseMarkImage,
  parseOpenImage,
  parseRendition,
  plainCredit,
  recordedLicence,
  creditSegments,
  sourceLabel,
  text,
  yearOf,
} from "./common";

const THUMB =
  "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3c/Stan_Roszkowski_US_Courthouse%2C_BMO_Harris_Bank_Center_in_downtown_Rockford.jpg";
const COMMONS_IMAGE = {
  file_page:
    "https://commons.wikimedia.org/wiki/File:Stan_Roszkowski_US_Courthouse,_BMO_Harris_Bank_Center_in_downtown_Rockford.jpg",
  display: { url: `${THUMB}/960px-x.jpg`, width: 960, height: 720 },
  thumb: { url: `${THUMB}/330px-x.jpg`, width: 330, height: 248 },
  license: "CC BY-SA 3.0",
  license_family: "cc by-sa",
  license_url: "https://creativecommons.org/licenses/by-sa/3.0",
  license_url_is_deed: true,
  author: "Alexbaumgarner",
  credit: null,
  verified_at: "2026-10-24T05:39:00Z",
};
// An FJC courthouse lead: no licence recorded at its source (shown since the owner's 2026-10-24 decision).
const FJC_IMAGE = {
  file_page: "https://www.fjc.gov/history/courthouse/chicago-illinois-1964",
  display: {
    url: "https://www.fjc.gov/sites/default/files/chicago-1964.jpg",
    width: 1000,
    height: 1333,
  },
  thumb: {
    url: "https://www.fjc.gov/sites/default/files/chicago-1964.jpg",
    width: 1000,
    height: 1333,
  },
  license: null,
  license_family: "other",
  rights_status: "review_required",
};
const IIIF = "https://tile.loc.gov/image-services/iiif/service:pnp:highsm:25100:25144/full";
const LOC_IMAGE = {
  file_page: "https://www.loc.gov/item/2013634629/",
  display: { url: `${IIIF}/pct:25/0/default.jpg`, width: 1536, height: 609 },
  thumb: { url: `${IIIF}/pct:12.5/0/default.jpg`, width: 768, height: 305 },
  license: "Public domain (Carol M. Highsmith Archive)",
  license_family: "public domain",
  license_url: "https://www.loc.gov/rr/print/res/482_high.html",
  license_url_is_deed: false,
  author: "Carol M. Highsmith",
  credit:
    "Library of Congress, Prints & Photographs Division, photograph by Carol M. Highsmith [LC-DIG-highsm-25144]",
  verified_at: "2026-10-24T05:45:00Z",
};

describe("text", () => {
  it("trims, bounds and rejects markup instead of stripping it", () => {
    expect(text("  Dirksen  ")).toBe("Dirksen");
    expect(text("")).toBeNull();
    expect(text("x".repeat(11), 10)).toBeNull();
    expect(text('<a href="//commons.wikimedia.org/wiki/User:DXR">DXR</a>')).toBeNull();
    expect(text("Siegel & Gale")).toBe("Siegel & Gale");
    expect(optionalText(undefined)).toEqual({ ok: true, value: null });
    expect(optionalText(null)).toEqual({ ok: true, value: null });
    expect(optionalText(42)).toEqual({ ok: false, value: null });
  });
});

describe("hosts", () => {
  it("accepts a chamber subdomain and rejects look-alikes, http and credentials", () => {
    expect(httpsUrlUnder("https://rules.house.gov/copyright", ["house.gov"])).toBe(
      "https://rules.house.gov/copyright",
    );
    expect(httpsUrlUnder("https://house.gov.example.com/x", ["house.gov"])).toBeNull();
    expect(httpsUrlUnder("https://evilhouse.gov/x", ["house.gov"])).toBeNull();
    expect(httpsUrlUnder("http://rules.house.gov/", ["house.gov"])).toBeNull();
    expect(httpsUrlUnder("https://u:p@rules.house.gov/", ["house.gov"])).toBeNull();
    expect(httpsUrlUnder("https://rules.house.gov:8443/", ["house.gov"])).toBeNull();
  });

  it("keeps renditions only on the registry's image hosts with integer pixel sizes", () => {
    expect(IMAGE_HOSTS.size).toBe(44);
    expect(parseRendition(COMMONS_IMAGE.thumb)).toEqual(COMMONS_IMAGE.thumb);
    expect(parseRendition(LOC_IMAGE.thumb)).toEqual(LOC_IMAGE.thumb);
    expect(parseRendition(FJC_IMAGE.thumb)).toEqual(FJC_IMAGE.thumb);
    expect(parseRendition({ ...COMMONS_IMAGE.thumb, url: "https://example.org/a.jpg" })).toBeNull();
    expect(parseRendition({ ...FJC_IMAGE.thumb, url: "http://www.fjc.gov/a.jpg" })).toBeNull();
    expect(parseRendition({ ...FJC_IMAGE.thumb, url: "https://fjc.gov/a.jpg" })).toBeNull();
    expect(parseRendition({ ...COMMONS_IMAGE.thumb, width: 330.5 })).toBeNull();
    expect(parseRendition({ ...COMMONS_IMAGE.thumb, height: "248" })).toBeNull();
    expect(parseRendition({ ...COMMONS_IMAGE.thumb, width: 0 })).toBeNull();
  });

  it("names the origin of an image's own page; any other https page is its source site", () => {
    expect(parseFilePage(COMMONS_IMAGE.file_page)?.origin).toBe("commons");
    expect(parseFilePage(LOC_IMAGE.file_page)?.origin).toBe("loc");
    expect(parseFilePage(FJC_IMAGE.file_page)?.origin).toBe("other");
    expect(parseFilePage("https://commons.wikimedia.org/wiki/Category:Courthouses")?.origin).toBe(
      "other",
    );
    expect(parseFilePage("http://www.fjc.gov/history")).toBeNull();
    expect(parseFilePage("javascript:alert(1)")).toBeNull();
    expect(sourceLabel({ origin: "other", filePage: FJC_IMAGE.file_page })).toBe("fjc.gov");
    expect(sourceLabel({ origin: "loc", filePage: LOC_IMAGE.file_page })).toBe(
      "Library of Congress",
    );
  });
});

describe("parseLicence", () => {
  it("keeps the recorded licence with its link, flagged as a deed only on a deed host", () => {
    expect(parseLicence(COMMONS_IMAGE)?.licenseUrlIsDeed).toBe(true);
    expect(parseLicence({ ...COMMONS_IMAGE, license_url_is_deed: false })?.licenseUrlIsDeed).toBe(
      false,
    );
    expect(parseLicence(LOC_IMAGE)?.licenseFamily).toBe("public domain");
    expect(parseLicence({ ...LOC_IMAGE, license_url_is_deed: true })).toBeNull();
    expect(
      parseLicence({
        ...COMMONS_IMAGE,
        license_url: "http://creativecommons.org/licenses/by-sa/3.0",
      }),
    ).toBeNull();
  });

  it("accepts family 'other' and an unrecorded licence, which carries no link", () => {
    expect(parseLicence(FJC_IMAGE)).toEqual({
      license: null,
      licenseFamily: "other",
      licenseUrl: null,
      licenseUrlIsDeed: false,
    });
    expect(
      parseLicence({ license: "Attribution", license_family: "other", license_url: "" })?.license,
    ).toBe("Attribution");
    expect(parseLicence({})?.licenseFamily).toBeNull();
  });

  it("drops unknown families and malformed flags", () => {
    for (const family of ["cc by-nc", "gfdl", "", 7])
      expect(parseLicence({ ...COMMONS_IMAGE, license_family: family })).toBeNull();
    expect(parseLicence({ ...COMMONS_IMAGE, license_url_is_deed: "true" })).toBeNull();
    expect(parseLicence({ ...COMMONS_IMAGE, license: "<a>CC</a>" })).toBeNull();
  });
});

describe("parseOpenImage", () => {
  it("keeps complete Commons and Library of Congress images", () => {
    const c = parseOpenImage(COMMONS_IMAGE)!;
    expect(c.origin).toBe("commons");
    expect(c.author).toBe("Alexbaumgarner");
    const l = parseOpenImage(LOC_IMAGE)!;
    expect(l.origin).toBe("loc");
    expect(l.credit).toContain("LC-DIG-highsm-25144");
  });

  it("keeps an image from another source with no licence recorded, and its rights status", () => {
    const f = parseOpenImage(FJC_IMAGE)!;
    expect(f.origin).toBe("other");
    expect(f.license).toBeNull();
    expect(f.rightsStatus).toBe("review_required");
    expect(f.verifiedAt).toBeNull();
  });

  it("drops an image whose renditions are not served by its own origin", () => {
    expect(parseOpenImage({ ...LOC_IMAGE, thumb: COMMONS_IMAGE.thumb })).toBeNull();
    expect(parseOpenImage({ ...COMMONS_IMAGE, display: LOC_IMAGE.display })).toBeNull();
    expect(parseOpenImage({ ...COMMONS_IMAGE, display: FJC_IMAGE.display })).toBeNull();
  });

  it("drops missing or malformed required fields instead of repairing them", () => {
    expect(parseOpenImage({ ...COMMONS_IMAGE, verified_at: "yesterday" })).toBeNull();
    expect(parseOpenImage({ ...COMMONS_IMAGE, rights_status: 3 })).toBeNull();
    expect(parseOpenImage({ ...COMMONS_IMAGE, author: "<b>Alex</b>" })).toBeNull();
    expect(parseOpenImage({ ...COMMONS_IMAGE, thumb: undefined })).toBeNull();
    expect(parseOpenImage([])).toBeNull();
    expect(parseOpenImage({ ...COMMONS_IMAGE, author: null })?.author).toBeNull();
  });

  it("reads the file page and credit from dataset-specific keys", () => {
    const { file_page, credit, ...rest } = LOC_IMAGE;
    const p = parseOpenImage(
      { ...rest, source_page: file_page, credit_line: credit },
      { filePage: "source_page", credit: "credit_line" },
    );
    expect(p?.filePage).toBe(file_page);
    expect(p?.credit).toBe(credit);
  });
});

describe("parseMarkImage", () => {
  const MARK = {
    url: "https://agency-logos.federalregister.gov/5/medium.jpg?1321651510",
    width: 245,
    height: 118,
    mime: "image/jpeg",
    source_page:
      "https://www.federalregister.gov/agencies/agency-for-healthcare-research-and-quality",
    license: null,
    author: null,
    rights_status: "review_required",
  };
  it("keeps a mark from a registry host with its source page", () => {
    const m = parseMarkImage(MARK)!;
    expect(m.sourcePage).toContain("federalregister.gov");
    expect(m.license).toBeNull();
    expect(isWideMark(m)).toBe(true);
    expect(hostOf(m.sourcePage)).toBe("federalregister.gov");
  });
  it("drops a mark off the hosts, of a type browsers cannot draw, or without a source page", () => {
    expect(parseMarkImage({ ...MARK, url: "https://example.org/logo.png" })).toBeNull();
    expect(parseMarkImage({ ...MARK, mime: "image/tiff" })).toBeNull();
    expect(parseMarkImage({ ...MARK, source_page: null })).toBeNull();
    expect(parseMarkImage({ ...MARK, width: 245.5 })).toBeNull();
    expect(parseMarkImage({ ...MARK, license_url: "ftp://x" })).toBeNull();
  });
});

describe("helpers", () => {
  it("builds a srcset from both renditions, smallest first", () => {
    const img = parseOpenImage(COMMONS_IMAGE)!;
    expect(imageSrcSet(img)).toBe(`${img.thumb.url} 330w, ${img.display.url} 960w`);
    expect(imageSrcSet({ thumb: img.display, display: img.display })).toBe(
      `${img.display.url} 960w`,
    );
  });

  it("reads one year from a recorded date and never narrows a range", () => {
    expect(yearOf("2012-01-01")).toBe("2012");
    expect(yearOf("2008 July.")).toBe("2008");
    expect(yearOf("July 2008")).toBe("2008");
    expect(yearOf("2023-02-03T10:00:00Z")).toBe("2023");
    expect(yearOf("[between 1980 and 2006]")).toBeNull();
    expect(yearOf("ca. 1950")).toBeNull();
    expect(yearOf("1930s")).toBeNull();
    expect(yearOf("2012?")).toBeNull();
    expect(yearOf(null)).toBeNull();
  });
});

describe("recordedLicence", () => {
  it("keeps a named licence or rights statement and drops registry review wording", () => {
    for (const named of [
      "CC BY-SA 4.0",
      "Public domain",
      "No known restrictions on publication.",
      "Copyrighted free use",
      "U.S. government work under official committee copyright policy",
    ])
      expect(recordedLicence(named)).toBe(named);
    for (const status of [
      "Not assessed; credit original repository cited on FJC source page",
      "Not specified by logo registry",
      "Pending file-specific policy and visual review",
      "GSA-hosted photograph; individual image reuse rights/credit not stated on profile",
      "",
      "   ",
    ])
      expect(recordedLicence(status)).toBeNull();
    expect(recordedLicence(null)).toBeNull();
  });

  it("makes parsed images and marks read 'Source: <site>' for such a status", () => {
    const fjc = parseOpenImage({
      ...FJC_IMAGE,
      license: "Not assessed; credit original repository cited on FJC source page",
    })!;
    expect(fjc.license).toBeNull();
    expect(fjc.licenseUrl).toBeNull();
    expect(
      parseLicence({
        license: "Pending file-specific policy and visual review",
        license_family: "other",
        license_url: "https://agriculture.house.gov/privacy",
      }),
    ).toEqual({ license: null, licenseFamily: "other", licenseUrl: null, licenseUrlIsDeed: false });
  });
});

describe("credit text", () => {
  it("turns each URL into a link labelled with its host, never the raw address", () => {
    const segs = creditSegments(
      "James Brooks · https://www.flickr.com/photos/jkbrooks85/50796914563/",
    );
    expect(segs).toEqual([
      { kind: "text", text: "James Brooks · " },
      {
        kind: "link",
        href: "https://www.flickr.com/photos/jkbrooks85/50796914563/",
        host: "flickr.com",
      },
    ]);
    expect(plainCredit("James Brooks · https://www.flickr.com/photos/x/1/")).toBe(
      "James Brooks · flickr.com",
    );
  });

  it("handles several URLs, trailing punctuation and http addresses", () => {
    const text =
      "Library of Congress Catalog: http://lccn.loc.gov/2014630182, image https://cdn.loc.gov/master/a.tif.";
    expect(plainCredit(text)).toBe("Library of Congress Catalog: lccn.loc.gov, image cdn.loc.gov.");
    expect(creditSegments(text).filter((s) => s.kind === "link")).toHaveLength(2);
    expect(creditSegments("see (https://www.census.gov/)")[1]).toEqual({
      kind: "link",
      href: "https://www.census.gov/",
      host: "census.gov",
    });
  });

  it("leaves plain text, other schemes and unparsable addresses as text", () => {
    expect(creditSegments("Ken Lund from Reno, Nevada, USA")).toEqual([
      { kind: "text", text: "Ken Lund from Reno, Nevada, USA" },
    ]);
    expect(creditSegments("javascript:alert(1) and ftp://x.org/a")).toEqual([
      { kind: "text", text: "javascript:alert(1) and ftp://x.org/a" },
    ]);
    expect(plainCredit("https:// broken")).toBe("https:// broken");
    expect(creditSegments("")).toEqual([]);
  });
});
