/**
 * Court building photographs (dataset court_images): one per court, with the licence, author and source page as
 * recorded. Owner decision 2026-10-24 ("forget the license check"): a photograph is shown whatever its rights status;
 * family "other" and an unrecorded licence are accepted, and the credit then names the source only. A row that fails
 * the shape checks is dropped, never repaired. Images are served from their origin, on the visual registry's fixed
 * image hosts (Wikimedia, Library of Congress, FJC, ...); nothing is copied.
 */
import {
  httpsLink,
  IMAGE_HOSTS,
  licenceFamily,
  parseFilePage,
  recordedLicence,
  sourceLabel,
  type ImageOrigin,
} from "@/lib/visuals/common";

export type PhotoRendition = { url: string; width: number; height: number };
export type LicenceFamily = "public domain" | "cc0" | "cc by" | "cc by-sa" | "other";

export type CourtPhoto = {
  courtId: string;
  file: string;
  sourcePage: string;
  /** Commons file page, Library of Congress item, or another site. */
  origin: ImageOrigin;
  display: PhotoRendition;
  display2x: { url: string; width: number } | null;
  thumb: PhotoRendition;
  /** Null when the record names no licence: the credit then reads "Source: <site>". */
  license: string | null;
  licenseFamily: LicenceFamily | null;
  licenseUrl: string | null;
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
  | "origin"
  | "license"
  | "licenseUrl"
  | "author"
  | "sourcePage"
  | "building"
  | "city"
  | "state"
>;

export const COURT_ID = /^[a-z0-9_-]{1,40}$/;
const MAX_PX = 20000;

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown, max = 600) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const px = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= MAX_PX ? v : null;

function httpsUrl(v: unknown, hosts: ReadonlySet<string>): string | null {
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

export function parseRendition(v: unknown): PhotoRendition | null {
  const o = obj(v);
  const url = httpsUrl(o?.["url"], IMAGE_HOSTS);
  const width = px(o?.["width"]);
  const height = px(o?.["height"]);
  return url && width && height ? { url, width, height } : null;
}

const absent = (v: unknown) => v === undefined || v === null || v === "";

/** item.photo of a court_images record, validated; null when anything required is missing or out of shape. */
export function parseCourtPhoto(raw: unknown, courtId: string): CourtPhoto | null {
  const p = obj(raw);
  if (!p || !COURT_ID.test(courtId)) return null;
  const family = licenceFamily(p["license_family"]);
  if (family === undefined) return null;
  const display = parseRendition(p["display"]);
  const thumb = parseRendition(p["thumb"]);
  const page = parseFilePage(p["source_page"]);
  const licenseText = absent(p["license"]) ? null : str(p["license"], 160);
  // A review status in the licence field ("Not assessed; ...") is not a licence: the credit then names the source only.
  const license = recordedLicence(licenseText);
  const licenseUrl = absent(p["license_url"]) ? null : httpsLink(p["license_url"]);
  const file = str(p["file"], 400);
  const verifiedAt = str(p["verified_at"], 40);
  if (!display || !thumb || !page || !file || !verifiedAt) return null;
  if ((!absent(p["license"]) && !licenseText) || (!absent(p["license_url"]) && !licenseUrl))
    return null;
  // A Commons file's renditions are Wikimedia's; a Library item's are the Library's.
  const wikimedia = (u: string) => /^(upload|thumb)\.wikimedia\.org$/.test(new URL(u).hostname);
  if (page.origin === "commons" && !(wikimedia(display.url) && wikimedia(thumb.url))) return null;
  const two = obj(p["display_2x"]);
  const twoUrl = httpsUrl(two?.["url"], IMAGE_HOSTS);
  const twoWidth = px(two?.["width"]);
  return {
    courtId,
    file,
    sourcePage: page.url,
    origin: page.origin,
    display,
    display2x:
      twoUrl && twoWidth && twoWidth > display.width ? { url: twoUrl, width: twoWidth } : null,
    thumb,
    license,
    licenseFamily: family,
    licenseUrl: license ? licenseUrl : null,
    licenseUrlIsDeed: !!license && !!licenseUrl && p["license_url_basis"] === "licence deed",
    author: str(p["attribution"], 2000),
    building: str(p["building"], 300),
    city: str(p["city"], 120),
    state: str(p["state"], 40),
    verifiedAt,
  };
}

export function toThumb(photo: CourtPhoto): CourtPhotoThumb {
  const { courtId, thumb, origin, license, licenseUrl, author, sourcePage, building, city, state } =
    photo;
  return { courtId, thumb, origin, license, licenseUrl, author, sourcePage, building, city, state };
}

/** "Wikimedia Commons", "Library of Congress" or the source site's host, for the source link. */
export function photoSource(p: Pick<CourtPhoto, "origin" | "sourcePage">): string {
  return sourceLabel({ origin: p.origin, filePage: p.sourcePage });
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
