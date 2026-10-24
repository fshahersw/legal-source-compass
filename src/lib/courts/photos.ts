/**
 * Court building photographs (dataset court_images): one per court, each with a licence read from the image's own
 * Wikimedia Commons file page. A row that fails validation is dropped, never repaired. Images are served from their
 * origin (upload.wikimedia.org originals, thumb.wikimedia.org renditions); nothing is copied.
 */

export type PhotoRendition = { url: string; width: number; height: number };
export type LicenceFamily = "public domain" | "cc0" | "cc by" | "cc by-sa";

export type CourtPhoto = {
  courtId: string;
  file: string;
  sourcePage: string;
  display: PhotoRendition;
  display2x: { url: string; width: number } | null;
  thumb: PhotoRendition;
  license: string;
  licenseFamily: LicenceFamily;
  licenseUrl: string;
  /** True when the link is a licence deed; public-domain files link to the file page's licensing section. */
  licenseUrlIsDeed: boolean;
  author: string | null;
  building: string | null;
  city: string | null;
  state: string | null;
  verifiedAt: string;
};

/** What a list row needs: the thumbnail and its credit. */
export type CourtPhotoThumb = Pick<
  CourtPhoto,
  | "courtId"
  | "thumb"
  | "license"
  | "licenseUrl"
  | "author"
  | "sourcePage"
  | "building"
  | "city"
  | "state"
>;

const FAMILIES: readonly LicenceFamily[] = ["public domain", "cc0", "cc by", "cc by-sa"];
export const COURT_ID = /^[a-z0-9_-]{1,40}$/;
const IMAGE_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);
const LICENCE_HOSTS = new Set(["creativecommons.org", "commons.wikimedia.org"]);
const MAX_PX = 20000;

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown, max = 600) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const px = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= MAX_PX ? v : null;

function httpsUrl(v: unknown, hosts: Set<string>): string | null {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && hosts.has(u.hostname) && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}

function commonsFilePage(v: unknown): string | null {
  const href = httpsUrl(v, new Set(["commons.wikimedia.org"]));
  return href && new URL(href).pathname.startsWith("/wiki/File:") ? href : null;
}

export function parseRendition(v: unknown): PhotoRendition | null {
  const o = obj(v);
  const url = httpsUrl(o?.["url"], IMAGE_HOSTS);
  const width = px(o?.["width"]);
  const height = px(o?.["height"]);
  return url && width && height ? { url, width, height } : null;
}

/** item.photo of a court_images record, validated; null when anything required is missing or out of shape. */
export function parseCourtPhoto(raw: unknown, courtId: string): CourtPhoto | null {
  const p = obj(raw);
  if (!p || !COURT_ID.test(courtId)) return null;
  const family = str(p["license_family"]) as LicenceFamily | null;
  if (!family || !FAMILIES.includes(family)) return null;
  const display = parseRendition(p["display"]);
  const thumb = parseRendition(p["thumb"]);
  const sourcePage = commonsFilePage(p["source_page"]);
  const licenseUrl = httpsUrl(p["license_url"], LICENCE_HOSTS);
  const license = str(p["license"], 80);
  const file = str(p["file"], 400);
  const verifiedAt = str(p["verified_at"], 40);
  if (!display || !thumb || !sourcePage || !licenseUrl || !license || !file || !verifiedAt)
    return null;
  const two = obj(p["display_2x"]);
  const twoUrl = httpsUrl(two?.["url"], IMAGE_HOSTS);
  const twoWidth = px(two?.["width"]);
  return {
    courtId,
    file,
    sourcePage,
    display,
    display2x:
      twoUrl && twoWidth && twoWidth > display.width ? { url: twoUrl, width: twoWidth } : null,
    thumb,
    license,
    licenseFamily: family,
    licenseUrl,
    licenseUrlIsDeed: p["license_url_basis"] === "licence deed",
    author: str(p["attribution"], 2000),
    building: str(p["building"], 300),
    city: str(p["city"], 120),
    state: str(p["state"], 40),
    verifiedAt,
  };
}

export function toThumb(photo: CourtPhoto): CourtPhotoThumb {
  const { courtId, thumb, license, licenseUrl, author, sourcePage, building, city, state } = photo;
  return { courtId, thumb, license, licenseUrl, author, sourcePage, building, city, state };
}

export function photoPlace(p: Pick<CourtPhoto, "city" | "state">): string | null {
  const parts = [p.city, p.state].filter((x): x is string => !!x);
  return parts.length ? parts.join(", ") : null;
}

/** Alt text from what the record states: the building and its place, else the court it was recorded for. */
export function photoAlt(
  p: Pick<CourtPhoto, "building" | "city" | "state">,
  courtTitle: string,
): string {
  const place = photoPlace(p);
  if (p.building) return `Photograph of ${p.building}${place ? `, ${place}` : ""}`;
  return `Photograph of the building recorded for ${courtTitle}${place ? `, ${place}` : ""}`;
}

/** Author as credited on the file page; "Author not recorded" when the file names none. */
export function photoAuthor(p: Pick<CourtPhoto, "author">): string {
  return p.author ?? "Author not recorded";
}

/** srcset for the hero image; the 2x rendition only when the original is large enough to have one. */
export function photoSrcSet(p: Pick<CourtPhoto, "display" | "display2x">): string {
  const one = `${p.display.url} ${p.display.width}w`;
  return p.display2x ? `${one}, ${p.display2x.url} ${p.display2x.width}w` : one;
}
