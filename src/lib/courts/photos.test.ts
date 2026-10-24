import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/rest.server", () => ({ restGet: vi.fn() }));

import { restGet } from "@/lib/external/rest.server";
import {
  parseCourtPhoto,
  parseRendition,
  photoAlt,
  photoAuthor,
  photoPlace,
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

  it("drops a record with a licence family that is not kept", () => {
    expect(parseCourtPhoto({ ...PHOTO, license_family: "cc by-nc" }, "alaska")).toBeNull();
    expect(parseCourtPhoto({ ...PHOTO, license_family: undefined }, "alaska")).toBeNull();
  });

  it("drops images served from any host other than Wikimedia's upload and thumbnail hosts", () => {
    const off = { ...PHOTO.display, url: "https://example.com/960px-x.jpg" };
    expect(parseCourtPhoto({ ...PHOTO, display: off }, "alaska")).toBeNull();
    const http = { ...PHOTO.thumb, url: PHOTO.thumb.url.replace("https:", "http:") };
    expect(parseCourtPhoto({ ...PHOTO, thumb: http }, "alaska")).toBeNull();
  });

  it("requires a Commons file page as the source and a licence link on an allowed host", () => {
    expect(
      parseCourtPhoto({ ...PHOTO, source_page: "https://en.wikipedia.org/wiki/X" }, "alaska"),
    ).toBeNull();
    expect(
      parseCourtPhoto({ ...PHOTO, license_url: "https://example.org/licence" }, "alaska"),
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
