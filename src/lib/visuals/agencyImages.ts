/**
 * Images of a federal agency (dataset agency_images, id = Federal Register agency id): building photographs
 * (item.photos) and seals or logos (item.marks). The building's name, the photograph's date and its association with
 * the agency are the source's statements; current occupancy is not verified. A mark is shown only where the site has
 * no GSA mark for the agency. An image that fails the shape checks is dropped, never repaired.
 */
import {
  obj,
  optionalText,
  parseMarkImage,
  parseOpenImage,
  text,
  yearOf,
  type MarkImage,
  type OpenImage,
} from "./common";

export const AGENCY_IMAGES_DATASET = "agency_images";
export const AGENCY_ID = /^\d{1,6}$/;
export const MAX_AGENCY_PHOTOS = 3;
export const MAX_AGENCY_MARKS = 3;

export type AgencyPhoto = OpenImage & {
  /** The building as the source names it; null when the source records the photograph without a building name. */
  building: string | null;
  photoDate: string | null;
  occupancyNote: string | null;
};

export function parseAgencyPhoto(raw: unknown): AgencyPhoto | null {
  const p = obj(raw);
  const image = parseOpenImage(raw, { filePage: "source_page", credit: "credit_line" });
  // A photograph the source files under this agency without naming the building is still shown, captioned only as
  // the agency's building photograph (owner decision 2026-10-27: accurate records are not withheld).
  const building = optionalText(p?.["building"], 300);
  const date = optionalText(p?.["photo_date"], 60);
  const note = optionalText(p?.["occupancy_note"], 400);
  if (!image || !building.ok || !date.ok || !note.ok) return null;
  return {
    ...image,
    building: building.value,
    photoDate: date.value,
    occupancyNote: note.value,
  };
}

export type AgencyImages = { photos: AgencyPhoto[]; marks: MarkImage[] };

function firstValid<T>(
  raw: unknown,
  max: number,
  parse: (v: unknown) => T | null,
  key: (v: T) => string,
) {
  const seen = new Set<string>();
  const out: T[] = [];
  if (!Array.isArray(raw)) return out;
  for (const item of raw.slice(0, max)) {
    const v = parse(item);
    if (v && !seen.has(key(v))) {
      seen.add(key(v));
      out.push(v);
    }
  }
  return out;
}

/**
 * The mark that heads the agency's page: a seal first, then a logo, then any other mark; the first recorded within a
 * kind. Null when the agency has no mark.
 */
export function primaryAgencyMark(marks: readonly MarkImage[]): MarkImage | null {
  return (
    marks.find((m) => m.kind === "seal") ?? marks.find((m) => m.kind === "logo") ?? marks[0] ?? null
  );
}

/** "Agency seal" / "Agency logo" / "Agency mark", for a caption. */
export function agencyMarkLabel(mark: Pick<MarkImage, "kind">): string {
  return mark.kind === "seal"
    ? "Agency seal"
    : mark.kind === "logo"
      ? "Agency logo"
      : "Agency mark";
}

/** item.photos and item.marks of an agency_images record, primary first; null when neither has a valid image. */
export function parseAgencyImages(
  agencyId: string,
  photos: unknown,
  marks?: unknown,
): AgencyImages | null {
  if (!AGENCY_ID.test(agencyId)) return null;
  const out = {
    photos: firstValid(photos, MAX_AGENCY_PHOTOS, parseAgencyPhoto, (p) => p.display.url),
    marks: firstValid(marks, MAX_AGENCY_MARKS, parseMarkImage, (m) => m.url),
  };
  return out.photos.length || out.marks.length ? out : null;
}

/**
 * "J. Edgar Hoover Building · photographed 2012". A date naming no single year is quoted as recorded
 * ("photograph dated [between 1980 and 2006]"); no date reads "photograph date not recorded".
 */
export function agencyPhotoCaption(p: Pick<AgencyPhoto, "building" | "photoDate">): string {
  return `${p.building ?? "Building photograph"} · ${agencyPhotoWhen(p)}`;
}

/** The date part of the caption: "photographed 2012". */
export function agencyPhotoWhen(p: Pick<AgencyPhoto, "photoDate">): string {
  const year = yearOf(p.photoDate);
  if (year) return `photographed ${year}`;
  return p.photoDate ? `photograph dated ${p.photoDate}` : "photograph date not recorded";
}

export const AGENCY_PHOTO_NOTE =
  "The photograph's date and its association with this agency come from the source; current occupancy is not verified.";
