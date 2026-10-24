import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/rest.server", () => ({ restGet: vi.fn() }));

import { restGet } from "@/lib/external/rest.server";
import {
  parseCourtPhoto,
  parseRendition,
  photoAlt,
  photoAuthor,
  photoPlace,
  photoSource,
  photoSrcSet,
  toThumb,
} from "./photos";
import { readCourtPhoto, readCourtPhotoThumbs } from "./photos.server";

// Shape of a court_images item.photo as the builder writes it (values from the alaska record).
const PHOTO = {
  file: "File:Boney Courthouse, Anchorage.jpg",
  source_page: "https://commons.wikimedia.org/wiki/File:Boney_Courthouse,_Anchorage.jpg",
  display: {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/Boney_Courthouse%2C_Anchorage.jpg/960px-Boney_Courthouse%2C_Anchorage.jpg",
    width: 960,
    height: 639,
  },
  display_2x: {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/Boney_Courthouse%2C_Anchorage.jpg/1920px-Boney_Courthouse%2C_Anchorage.jpg",
    width: 1920,
  },
  thumb: {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/Boney_Courthouse%2C_Anchorage.jpg/330px-Boney_Courthouse%2C_Anchorage.jpg",
    width: 330,
    height: 220,
  },
  license: "CC BY 2.0",
  license_family: "cc by",
  license_url: "https://creativecommons.org/licenses/by/2.0",
  license_url_basis: "licence deed",
  attribution: "James Brooks from Juneau, Alaska",
  building: "Boney Courthouse - Alaska State Supreme Court",
  city: "Anchorage",
  state: "AK",
  verified_at: "2026-10-24T01:38:12Z",
};

describe("parseCourtPhoto", () => {
  it("keeps a complete record", () => {
    const p = parseCourtPhoto(PHOTO, "alaska")!;
    expect(p.courtId).toBe("alaska");
    expect(p.display).toEqual(PHOTO.display);
    expect(p.display2x?.width).toBe(1920);
    expect(p.licenseFamily).toBe("cc by");
    expect(p.licenseUrlIsDeed).toBe(true);
    expect(p.author).toBe("James Brooks from Juneau, Alaska");
  });

  it("drops a record with an unknown licence family; 'other' and an unrecorded licence are kept", () => {
    expect(parseCourtPhoto({ ...PHOTO, license_family: "cc by-nc" }, "alaska")).toBeNull();
    // Owner decision 2026-10-24: shown whatever the rights status; the credit then names the source only.
    const other = parseCourtPhoto(
      { ...PHOTO, license_family: "other", license: null, license_url: null },
      "alaska",
    )!;
    expect(other.license).toBeNull();
    expect(other.licenseUrl).toBeNull();
    expect(other.licenseUrlIsDeed).toBe(false);
    expect(
      parseCourtPhoto({ ...PHOTO, license_family: undefined }, "alaska")?.licenseFamily,
    ).toBeNull();
  });

  it("drops images served from a host outside the visual registry's image hosts", () => {
    const off = { ...PHOTO.display, url: "https://example.com/960px-x.jpg" };
    expect(parseCourtPhoto({ ...PHOTO, display: off }, "alaska")).toBeNull();
    const http = { ...PHOTO.thumb, url: PHOTO.thumb.url.replace("https:", "http:") };
    expect(parseCourtPhoto({ ...PHOTO, thumb: http }, "alaska")).toBeNull();
  });

  it("keeps a photograph from another source site with that site as the source link", () => {
    const fjc = "https://www.fjc.gov/sites/default/files/history/courthouses/anchorage.jpg";
    const p = parseCourtPhoto(
      {
        ...PHOTO,
        source_page: "https://www.fjc.gov/history/courthouse/anchorage-alaska-1940",
        display: { url: fjc, width: 1000, height: 700 },
        thumb: { url: fjc, width: 1000, height: 700 },
        display_2x: null,
        license: "Not assessed",
        license_family: "other",
        license_url: null,
      },
      "alaska",
    )!;
    expect(p.origin).toBe("other");
    expect(photoSource(p)).toBe("fjc.gov");
  });

  it("reads a review status in the licence field as no licence, so the credit names the source", () => {
    const p = parseCourtPhoto(
      {
        ...PHOTO,
        license: "Not assessed; credit original repository cited on FJC source page",
        license_family: "other",
        license_url: null,
      },
      "alaska",
    )!;
    expect(p.license).toBeNull();
    expect(p.licenseUrl).toBeNull();
    expect(p.licenseUrlIsDeed).toBe(false);
  });

  it("drops a Commons file whose renditions are not Wikimedia's, and malformed links", () => {
    const fjc = { url: "https://www.fjc.gov/x.jpg", width: 960, height: 639 };
    expect(parseCourtPhoto({ ...PHOTO, display: fjc }, "alaska")).toBeNull();
    expect(
      parseCourtPhoto({ ...PHOTO, source_page: "http://commons.wikimedia.org/x" }, "alaska"),
    ).toBeNull();
    expect(
      parseCourtPhoto({ ...PHOTO, license_url: "ftp://example.org/licence" }, "alaska"),
    ).toBeNull();
  });

  it("accepts a public-domain record whose licence link is the file page's licensing section", () => {
    const p = parseCourtPhoto(
      {
        ...PHOTO,
        license: "Public domain",
        license_family: "public domain",
        license_url: `${PHOTO.source_page}#Licensing`,
        license_url_basis: "file page licensing section",
        attribution: null,
      },
      "alaska",
    )!;
    expect(p.licenseUrlIsDeed).toBe(false);
    expect(photoAuthor(p)).toBe("Author not recorded");
  });

  it("drops a 2x rendition that is not wider than the display rendition", () => {
    const p = parseCourtPhoto(
      { ...PHOTO, display_2x: { url: PHOTO.display.url, width: 960 } },
      "alaska",
    )!;
    expect(p.display2x).toBeNull();
    expect(photoSrcSet(p)).toBe(`${PHOTO.display.url} 960w`);
  });

  it("rejects malformed renditions and bad court ids", () => {
    expect(parseRendition({ ...PHOTO.display, width: 0 })).toBeNull();
    expect(parseRendition({ ...PHOTO.display, height: 1.5 })).toBeNull();
    expect(parseCourtPhoto(PHOTO, "Bad Id")).toBeNull();
  });
});

describe("text helpers", () => {
  const p = parseCourtPhoto(PHOTO, "alaska")!;
  it("builds alt text from the recorded building and place", () => {
    expect(photoAlt(p, "Alaska Supreme Court")).toBe(
      "Photograph of Boney Courthouse - Alaska State Supreme Court, Anchorage, AK",
    );
    expect(photoAlt({ building: null, city: null, state: null }, "Alaska Supreme Court")).toBe(
      "Photograph of the building recorded for Alaska Supreme Court",
    );
    expect(photoPlace({ city: null, state: "AK" })).toBe("AK");
  });
  it("lists the 2x rendition in the srcset", () => {
    expect(photoSrcSet(p)).toBe(`${PHOTO.display.url} 960w, ${PHOTO.display_2x.url} 1920w`);
  });
  it("keeps only the thumbnail and credit for lists", () => {
    expect(Object.keys(toThumb(p)).sort()).toEqual(
      [
        "author",
        "building",
        "city",
        "courtId",
        "license",
        "licenseUrl",
        "origin",
        "sourcePage",
        "state",
        "thumb",
      ].sort(),
    );
  });
});

describe("server reads", () => {
  it("reads one court by exact id and validates it", async () => {
    vi.mocked(restGet).mockResolvedValueOnce({ rows: [{ id: "alaska", p: PHOTO }], total: null });
    expect((await readCourtPhoto("alaska"))?.file).toBe(PHOTO.file);
    expect(vi.mocked(restGet).mock.calls.at(-1)?.[0]).toContain(
      "dataset=eq.court_images&id=eq.alaska",
    );
  });

  it("returns null for no row, a different id, or a bad id without querying", async () => {
    vi.mocked(restGet).mockResolvedValueOnce({ rows: [], total: null });
    expect(await readCourtPhoto("alaska")).toBeNull();
    vi.mocked(restGet).mockResolvedValueOnce({ rows: [{ id: "ala", p: PHOTO }], total: null });
    expect(await readCourtPhoto("alaska")).toBeNull();
    const calls = vi.mocked(restGet).mock.calls.length;
    expect(await readCourtPhoto("x;drop")).toBeNull();
    expect(vi.mocked(restGet).mock.calls.length).toBe(calls);
  });

  it("indexes thumbnails by court id and drops invalid rows", async () => {
    vi.mocked(restGet).mockResolvedValueOnce({
      rows: [
        { id: "alaska", p: PHOTO },
        { id: "ala", p: { ...PHOTO, license_family: "cc by-nd" } },
        { id: "BAD", p: PHOTO },
      ],
      total: null,
    });
    const index = await readCourtPhotoThumbs();
    expect(Object.keys(index)).toEqual(["alaska"]);
    expect(index["alaska"]!.thumb.width).toBe(330);
  });
});
