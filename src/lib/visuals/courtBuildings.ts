/**
 * Courthouses of one court with a photograph (dataset court_buildings, id = court id). Each building is bound to the
 * court by an exact court id on an official U.S. Courts or court-website listing; the relationship label is shown as
 * recorded, and the photograph with its recorded author, licence and source page. A building that fails the shape
 * checks is dropped, never repaired.
 */
import { httpsUrlUnder, obj, optionalText, parseOpenImage, text, type OpenImage } from "./common";

export const COURT_BUILDINGS_DATASET = "court_buildings";
export const COURT_ID = /^[a-z0-9_-]{1,40}$/;
export const MAX_BUILDINGS = 12;
const ASSET_ID = /^[A-Za-z0-9._:-]{1,120}$/;
/** Official listings: U.S. Courts and court websites (federal *.uscourts.gov, state courts on .gov or .us hosts). */
const EVIDENCE_SUFFIXES = ["gov", "us"] as const;

export type CourtBuilding = {
  assetId: string;
  building: string;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  relationshipLabel: string;
  evidenceUrl: string;
  photo: OpenImage;
};

export type CourtBuildings = {
  courtId: string;
  buildings: CourtBuilding[];
  /** Buildings the official listing names for this court; null when the record does not say. */
  listed: number | null;
  /** Buildings the record says are shown with a photograph; null when it does not say. */
  shown: number | null;
  /** Buildings among the first twelve of the record that failed validation and are not shown. */
  dropped: number;
};

const count = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100000 ? v : null;

function coordinate(v: unknown, limit: number): { ok: boolean; value: number | null } {
  if (v === undefined || v === null) return { ok: true, value: null };
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit
    ? { ok: true, value: v }
    : { ok: false, value: null };
}

export function parseCourtBuilding(raw: unknown): CourtBuilding | null {
  const b = obj(raw);
  if (!b) return null;
  const assetId = text(b["asset_id"], 120);
  const building = text(b["building"], 300);
  const relationshipLabel = text(b["relationship_label"], 200);
  const evidenceUrl = httpsUrlUnder(b["evidence_url"], EVIDENCE_SUFFIXES);
  const photo = parseOpenImage(b["photo"]);
  const street = optionalText(b["street_address"], 300);
  const city = optionalText(b["city"], 120);
  const state = optionalText(b["state"], 60);
  const lat = coordinate(b["latitude"], 90);
  const lon = coordinate(b["longitude"], 180);
  if (!assetId || !ASSET_ID.test(assetId) || !building || !relationshipLabel || !evidenceUrl)
    return null;
  if (!photo || !street.ok || !city.ok || !state.ok || !lat.ok || !lon.ok) return null;
  // A position needs both coordinates.
  const located = lat.value !== null && lon.value !== null;
  return {
    assetId,
    building,
    streetAddress: street.value,
    city: city.value,
    state: state.value,
    latitude: located ? lat.value : null,
    longitude: located ? lon.value : null,
    relationshipLabel,
    evidenceUrl,
    photo,
  };
}

/** item.buildings + item.counts of a court_buildings record; null when nothing valid remains. */
export function parseCourtBuildings(
  courtId: string,
  buildings: unknown,
  counts: unknown,
): CourtBuildings | null {
  if (!COURT_ID.test(courtId) || !Array.isArray(buildings)) return null;
  const seen = new Set<string>();
  const out: CourtBuilding[] = [];
  let dropped = 0;
  for (const raw of buildings.slice(0, MAX_BUILDINGS)) {
    const b = parseCourtBuilding(raw);
    if (!b || seen.has(b.assetId)) {
      dropped += 1;
      continue;
    }
    seen.add(b.assetId);
    out.push(b);
  }
  if (!out.length) return null;
  const c = obj(counts);
  return {
    courtId,
    buildings: out,
    listed: count(c?.["buildings_listed"]),
    shown: count(c?.["buildings_shown"]),
    dropped,
  };
}

/** "219 South Dearborn Street, Chicago, IL" from the recorded parts; null when none is recorded. */
export function addressLine(b: Pick<CourtBuilding, "streetAddress" | "city" | "state">) {
  const parts = [b.streetAddress, b.city, b.state].filter((x): x is string => !!x);
  return parts.length ? parts.join(", ") : null;
}

/** The count line: recorded counts as published; a missing count reads "Not recorded", never zero. */
export function buildingsCountLine(d: Pick<CourtBuildings, "listed" | "shown">): string {
  const listed =
    d.listed === null
      ? "Buildings listed by U.S. Courts: Not recorded"
      : `${d.listed.toLocaleString("en-US")} building${d.listed === 1 ? "" : "s"} listed by U.S. Courts`;
  const shown =
    d.shown === null
      ? "shown with a photograph: Not recorded"
      : `${d.shown.toLocaleString("en-US")} shown with a photograph`;
  return `${listed}; ${shown}`;
}

export function mapLink(b: Pick<CourtBuilding, "latitude" | "longitude">): string | null {
  if (b.latitude === null || b.longitude === null) return null;
  const lat = b.latitude.toFixed(5);
  const lon = b.longitude.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}
