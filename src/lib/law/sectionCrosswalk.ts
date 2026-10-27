/**
 * Products and recalls under one CFR section (pure), joined by exact identifier only:
 *  - 21 CFR: FDA device types whose classification regulation number equals the section (openFDA device
 *    classification, filters.regulation_number, e.g. "870.3610" = 21 CFR 870.3610);
 *  - 49 CFR 571.N: NHTSA recalls whose FMVSS number equals N (item.recall.fmvss "208" = 49 CFR 571.208). Other FMVSS
 *    values (e.g. "567", which is 49 CFR part 567, not 571.567) are never mapped.
 * A device type listed here is FDA's classification as published, not a statement about any product's compliance.
 */

export type CrosswalkKind = "device" | "vehicle" | null;

/** Which crosswalk applies to a CFR section, and the exact key it joins on. */
export function crosswalkFor(
  title: string,
  section: string,
): { kind: "device"; regulation: string } | { kind: "vehicle"; fmvss: string } | null {
  if (title === "21" && /^8\d{2}\.\d{1,5}$/.test(section)) return { kind: "device", regulation: section };
  const m = title === "49" ? /^571\.(\d{3}[a-z]?)$/.exec(section) : null;
  return m ? { kind: "vehicle", fmvss: m[1]! } : null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export type DeviceType = {
  productCode: string;
  name: string;
  deviceClass: string | null;
  implant: boolean | null;
  lifeSustaining: boolean | null;
  specialty: string | null;
};

const flag = (v: unknown): boolean | null => (v === "Y" ? true : v === "N" ? false : null);

export function toDeviceType(raw: unknown): DeviceType | null {
  const f = obj(obj(raw)["filters"]);
  const code = str(f["product_code"]);
  if (!code) return null;
  return {
    productCode: code,
    name: str(f["device_name"]) ?? code,
    deviceClass: str(f["device_class"]),
    implant: flag(f["implant_flag"]),
    lifeSustaining: flag(f["life_sustain_support_flag"]),
    specialty: str(f["medical_specialty_description"]),
  };
}

export type DeviceSummary = {
  types: number;
  classIII: number;
  implants: number;
  lifeSustaining: number;
  byClass: { label: string; value: number }[];
};

export function deviceSummary(rows: readonly DeviceType[]): DeviceSummary {
  const classes = ["1", "2", "3", "U", "N", "f"];
  const label: Record<string, string> = {
    "1": "Class I",
    "2": "Class II",
    "3": "Class III",
    U: "Unclassified",
    N: "Not classified",
    f: "HDE",
  };
  return {
    types: rows.length,
    classIII: rows.filter((r) => r.deviceClass === "3").length,
    implants: rows.filter((r) => r.implant === true).length,
    lifeSustaining: rows.filter((r) => r.lifeSustaining === true).length,
    byClass: classes
      .map((c) => ({ label: label[c] ?? c, value: rows.filter((r) => r.deviceClass === c).length }))
      .filter((c) => c.value > 0),
  };
}

export type VehicleRecall = {
  campaign: string;
  title: string;
  manufacturer: string | null;
  date: string | null;
  units: number | null;
  url: string | null;
};

export function toVehicleRecall(raw: unknown): VehicleRecall | null {
  const r = obj(raw);
  const id = str(r["id"]);
  if (!id) return null;
  const units = Number(r["units"]);
  const date = str(r["report_date"]);
  return {
    campaign: id,
    title: (str(r["title"]) ?? id).replace(/\s+/g, " "),
    manufacturer: str(r["manufacturer"]),
    date: date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null,
    units: r["units"] != null && r["units"] !== "" && Number.isFinite(units) && units >= 0 ? units : null,
    url: str(r["source_url"]),
  };
}

export type RecallYear = { year: string; recalls: number; units: number | null; partial: boolean };

/**
 * Recalls per report year from the first recorded year to the current year (a year without a recall is a real 0;
 * units are null when any recall that year has no unit count). Recalls without a date are counted apart.
 */
export function recallYears(rows: readonly VehicleRecall[], today: string): RecallYear[] {
  const dated = rows.filter((r) => r.date);
  if (!dated.length) return [];
  const first = Math.min(...dated.map((r) => Number(r.date!.slice(0, 4))));
  const last = Number(today.slice(0, 4));
  const out: RecallYear[] = [];
  for (let y = first; y <= last; y++) {
    const mine = dated.filter((r) => r.date!.startsWith(String(y)));
    out.push({
      year: String(y),
      recalls: mine.length,
      units: mine.some((r) => r.units === null) ? null : mine.reduce((a, r) => a + (r.units ?? 0), 0),
      partial: y === last,
    });
  }
  return out;
}

export type SectionCrosswalk =
  | { kind: "device"; key: string; dataset: string; sourceUrl: string | null; exportDate: string | null; devices: DeviceType[] }
  | { kind: "vehicle"; key: string; recalls: VehicleRecall[]; today: string };
