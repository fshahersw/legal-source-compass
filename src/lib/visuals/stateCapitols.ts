/**
 * State capitol photographs (dataset state_capitol_images, id = two-letter USPS code). One photograph per state,
 * re-verified at its file page. The photograph is context for the state page; it is not evidence of where a body
 * currently meets. A record that fails validation is dropped, never repaired.
 */
import { obj, optionalText, parseOpenImage, text, type OpenImage } from "./common";

export const STATE_CAPITOLS_DATASET = "state_capitol_images";
export const USPS = /^[A-Z]{2}$/;

export type StateCapitolPhoto = OpenImage & {
  usps: string;
  building: string;
  city: string | null;
};

export function parseStateCapitol(usps: string, raw: unknown): StateCapitolPhoto | null {
  if (!USPS.test(usps)) return null;
  const p = obj(raw);
  const image = parseOpenImage(raw);
  const building = text(p?.["building"], 300);
  const city = optionalText(p?.["city"], 120);
  if (!image || !building || !city.ok) return null;
  return { ...image, usps, building, city: city.value };
}

/** "Alabama State Capitol · Montgomery, Alabama" when the record gives a city, else the building alone. */
export function capitolCaption(
  p: Pick<StateCapitolPhoto, "building" | "city">,
  stateName: string,
): string {
  return p.city ? `${p.building} · ${p.city}, ${stateName}` : p.building;
}
