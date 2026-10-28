import { describe, expect, it } from "vitest";
import {
  agencyMarkLabel,
  agencyPhotoCaption,
  parseAgencyImages,
  parseAgencyPhoto,
  primaryAgencyMark,
} from "./agencyImages";
import { agency_images } from "./fixtures/rows";

const photos = agency_images[0]!.item["photos"] as Record<string, unknown>[];
const marks = agency_images[0]!.item["marks"] as Record<string, unknown>[];
const fbi = photos[0]!;

describe("parseAgencyImages", () => {
  it("keeps the fixture photograph with its Library of Congress credit line", () => {
    const [p] = parseAgencyImages("160", photos)!.photos;
    expect(p!.building).toBe("J. Edgar Hoover Building");
    expect(p!.origin).toBe("loc");
    expect(p!.filePage).toBe("https://www.loc.gov/item/2013634629/");
    expect(p!.credit).toBe(
      "Library of Congress, Prints & Photographs Division, photograph by Carol M. Highsmith [LC-DIG-highsm-25144]",
    );
    expect(p!.licenseUrl).toBe("https://www.loc.gov/rr/print/res/482_high.html");
  });

  it("keeps a photograph the source records without a building name", () => {
    const [p] = parseAgencyImages("160", [{ ...fbi, building: null }])!.photos;
    expect(p!.building).toBeNull();
    expect(agencyPhotoCaption(p!)).toBe("Building photograph · photographed 2012");
  });

  it("keeps at most three, drops duplicates and failures, and needs a valid agency id", () => {
    const dup = [fbi, fbi, { ...fbi, building: "" }, fbi];
    expect(parseAgencyImages("160", dup)!.photos).toHaveLength(1);
    expect(parseAgencyImages("FBI", photos)).toBeNull();
    expect(parseAgencyImages("160", [])).toBeNull();
    expect(parseAgencyImages("160", null, [])).toBeNull();
  });

  it("reads the recorded marks beside the photographs, and marks alone", () => {
    const both = parseAgencyImages("160", photos, marks)!;
    expect(both.marks[0]!.url).toContain("agency-logos.federalregister.gov/160/");
    expect(both.marks[0]!.rightsStatus).toBe("restricted");
    const only = parseAgencyImages("5", [], agency_images[1]!.item["marks"])!;
    expect(only.photos).toEqual([]);
    expect(only.marks).toHaveLength(1);
    expect(parseAgencyImages("5", [], [{ ...marks[0], mime: "image/tiff" }])).toBeNull();
  });

  it("drops a photograph whose renditions do not match its Library item, or are off the hosts", () => {
    expect(
      parseAgencyPhoto({ ...fbi, source_page: "https://commons.wikimedia.org/wiki/File:X.jpg" }),
    ).toBeNull();
    expect(
      parseAgencyPhoto({
        ...fbi,
        display: { ...(fbi["display"] as object), url: "https://www.fbi.gov/x.jpg" },
      }),
    ).toBeNull();
  });
});

describe("primaryAgencyMark", () => {
  const mark = (asset_type: string | null, n: number) => ({
    ...marks[0],
    url: `https://agency-logos.federalregister.gov/160/${n}.png`,
    asset_type,
  });

  it("prefers a seal, then a logo, whatever the rights status says", () => {
    const parsed = parseAgencyImages(
      "160",
      [],
      [
        { ...mark("logo", 1), rights_status: "review_required" },
        { ...mark("seal", 2), rights_status: "restricted" },
        mark(null, 3),
      ],
    )!;
    expect(primaryAgencyMark(parsed.marks)?.kind).toBe("seal");
    expect(primaryAgencyMark(parsed.marks)?.rightsStatus).toBe("restricted");
    expect(primaryAgencyMark(parsed.marks.filter((m) => m.kind !== "seal"))?.kind).toBe("logo");
    expect(primaryAgencyMark(parsed.marks.filter((m) => m.kind === null))?.kind).toBeNull();
    expect(primaryAgencyMark([])).toBeNull();
  });

  it("labels the mark by kind and does not filter on rights status or licence family", () => {
    const kinds = ["seal", "logo", null] as const;
    expect(kinds.map((k) => agencyMarkLabel({ kind: k }))).toEqual([
      "Agency seal",
      "Agency logo",
      "Agency mark",
    ]);
    for (const status of ["restricted", "review_required", "reusable", "anything else"]) {
      const parsed = parseAgencyImages("160", [], [{ ...mark("seal", 1), rights_status: status }]);
      expect(parsed?.marks).toHaveLength(1);
    }
    expect(
      parseAgencyImages("160", [], [{ ...mark("seal", 1), license_family: "other" }])?.marks,
    ).toHaveLength(1);
  });

  it("draws bitmap formats browsers can show, including BMP", () => {
    expect(
      parseAgencyImages("160", [], [{ ...mark("seal", 1), mime: "image/bmp" }])?.marks,
    ).toHaveLength(1);
  });
});

describe("agencyPhotoCaption", () => {
  it("names the year only when the source date is a plain date", () => {
    expect(
      agencyPhotoCaption({ building: "J. Edgar Hoover Building", photoDate: "2012-01-01" }),
    ).toBe("J. Edgar Hoover Building · photographed 2012");
    expect(
      agencyPhotoCaption({ building: "FBI building", photoDate: "[between 1980 and 2006]" }),
    ).toBe("FBI building · photograph dated [between 1980 and 2006]");
    expect(agencyPhotoCaption({ building: "FBI building", photoDate: null })).toBe(
      "FBI building · photograph date not recorded",
    );
  });
});
