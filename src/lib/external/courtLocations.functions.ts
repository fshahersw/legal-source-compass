/**
 * A court's courthouse addresses (dataset court_locations): each address as the court prints it on its own website, with
 * the page it was read from and, where the U.S. Census Bureau Geocoder matched it, coordinates. Read-only; a location
 * that fails validation is dropped, never repaired, and the number dropped is returned.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

export type CourtLocation = {
  name: string | null;
  mailing: boolean;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  otherSpellings: string[];
  lat: number | null;
  lon: number | null;
  geocodeMatch: string | null;
  sourceUrl: string;
  retrievedAt: string | null;
};
export type CourtLocations = {
  courtId: string;
  court: string;
  locations: CourtLocation[];
  dropped: number;
  sharedSiteWith: string[];
};

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const COURT_ID = /^[a-z0-9]{2,24}$/;
const STATE = /^[A-Z]{2}$/;
const ZIP = /^\d{5}$/;
const OFFICIAL = /^https?:\/\/(www\.)?([a-z0-9]+\.uscourts\.gov|supremecourt\.gov)\//;

const coord = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

export function parseLocation(raw: unknown): CourtLocation | null {
  const o = obj(raw);
  const address1 = str(o?.["address1"]);
  const city = str(o?.["city"]);
  const state = str(o?.["state"]);
  const zip = str(o?.["zip"]);
  const sourceUrl = str(o?.["source_url"]);
  if (!o || !address1 || !city || !state || !STATE.test(state) || !zip || !ZIP.test(zip))
    return null;
  if (!sourceUrl || !OFFICIAL.test(sourceUrl)) return null;
  const match = str(o["geocode_match"]);
  const lat = coord(o["lat"], -90, 90);
  const lon = coord(o["lon"], -180, 180);
  const located = match === "Match" && lat !== null && lon !== null;
  return {
    name: str(o["name"]),
    mailing: /^p\.?\s?o\.?\s+box/i.test(address1),
    address1,
    address2: str(o["address2"]),
    city,
    state,
    zip,
    otherSpellings: (Array.isArray(o["other_spellings"]) ? o["other_spellings"] : [])
      .map(str)
      .filter((s): s is string => !!s)
      .slice(0, 6),
    lat: located ? lat : null,
    lon: located ? lon : null,
    geocodeMatch: match,
    sourceUrl,
    retrievedAt: str(o["retrieved_at"]),
  };
}

export function parseCourtLocations(raw: unknown, courtId: string): CourtLocations | null {
  const p = obj(raw);
  if (!p || p["court_id"] !== courtId) return null;
  const list = Array.isArray(p["locations"]) ? p["locations"] : [];
  const locations = list.map(parseLocation).filter((l): l is CourtLocation => !!l);
  if (!locations.length) return null;
  return {
    courtId,
    court: str(p["court"]) ?? courtId,
    locations,
    dropped: list.length - locations.length,
    sharedSiteWith: (Array.isArray(p["shared_site_with"]) ? p["shared_site_with"] : [])
      .map(str)
      .filter((s): s is string => !!s && COURT_ID.test(s)),
  };
}

/** OpenStreetMap view of a geocoded point; null without coordinates. */
export function mapHref(l: Pick<CourtLocation, "lat" | "lon">): string | null {
  if (l.lat === null || l.lon === null) return null;
  const lat = l.lat.toFixed(5);
  const lon = l.lon.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

export const getCourtLocations = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<CourtLocations | null> => {
    const r = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.court_locations&id=eq.${data.id}&limit=1`,
    );
    return r.rows.length === 1 ? parseCourtLocations(r.rows[0]!.p, data.id) : null;
  });
