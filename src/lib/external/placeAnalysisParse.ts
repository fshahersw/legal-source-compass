/**
 * Defensive parsers for the state_analysis datasets (county_profiles, county_legal_activity, city_profiles,
 * state_cross_analysis). Stored JSON is untrusted: malformed values are dropped, never guessed; links are rebuilt only
 * in known in-app shapes from validated ids.
 */
type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
export const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
export const str = (v: unknown, max = 400): string =>
  typeof v === "string" ? v.slice(0, max) : "";
const KEY = /^[a-z0-9_]{1,64}$/;
export const FIPS = /^\d{5}$/;
export const USPS = /^[A-Z]{2}$/;
export const COURT = /^[a-z]{2,4}d$/;
const YEAR = /^\d{4}$/;

/** {metric: number | null} with safe keys; non-numbers become null (Not recorded). */
export function parseMetrics(raw: unknown): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(obj(raw))) if (KEY.test(k)) out[k] = num(v);
  return out;
}

export function parseYearSeries(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(raw))) {
    const n = num(v);
    if (YEAR.test(k) && n != null) out[k] = n;
  }
  return out;
}

export function parseCounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(raw))) {
    const n = num(v);
    if (KEY.test(k) && n != null && n >= 0) out[k] = n;
  }
  return out;
}

export function strings(raw: unknown, max = 40, len = 600): string[] {
  return Array.isArray(raw)
    ? raw
        .filter((s): s is string => typeof s === "string")
        .slice(0, max)
        .map((s) => s.slice(0, len))
    : [];
}

export type DistrictRef = {
  courtId: string;
  district: string;
  division: string | null;
  heldAt: string[];
  method: string | null;
  codeName: string | null;
  exception: string | null;
  sourceUrl: string | null;
};

export function parseDistrictRef(raw: unknown): DistrictRef | null {
  const d = obj(raw);
  const courtId = str(d["court_id"]);
  if (!COURT.test(courtId) || !str(d["district"])) return null;
  const url = str(d["source_url"]);
  return {
    courtId,
    district: str(d["district"], 120),
    division: str(d["division"], 120) || null,
    heldAt: strings(d["held_at"], 20, 160),
    method: str(d["method"], 40) || null,
    codeName: str(d["code_name"], 120) || null,
    exception: str(d["exception"], 400) || null,
    sourceUrl: /^https:\/\//.test(url) ? url : null,
  };
}

export type Test = {
  x: string;
  y: string;
  label: string;
  rho: number | null;
  n: number;
  ci: [number, number] | null;
  p: number | null;
  pBh: number | null;
  holds: boolean;
  strength: string | null;
};

export function parseTests(raw: unknown): Test[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t) => {
    const o = obj(t);
    const x = str(o["x"]),
      y = str(o["y"]);
    if (!KEY.test(x) || !KEY.test(y)) return [];
    const ci = Array.isArray(o["ci"]) && o["ci"].length === 2 ? o["ci"].map(num) : null;
    return [
      {
        x,
        y,
        label: str(o["label"], 120) || y,
        rho: num(o["rho"]),
        n: num(o["n"]) ?? 0,
        ci: ci && ci[0] != null && ci[1] != null ? [ci[0], ci[1]] : null,
        p: num(o["p"]),
        pBh: num(o["p_bh"]),
        holds: o["holds"] === true && num(o["rho"]) != null,
        strength: str(o["strength"], 20) || null,
      },
    ];
  });
}

export type Standout = {
  kind: string;
  text: string;
  county: string | null;
  courtId: string | null;
  metric: string | null;
};

export function parseStandouts(raw: unknown): Standout[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s) => {
    const o = obj(s);
    const text = str(o["text"], 600);
    if (!text) return [];
    const county = str(o["county"]);
    const court = str(o["court_id"]);
    const metric = str(o["metric"]);
    return [
      {
        kind: str(o["kind"], 40) || "note",
        text,
        county: FIPS.test(county) ? county : null,
        courtId: COURT.test(court) ? court : null,
        metric: KEY.test(metric) ? metric : null,
      },
    ];
  });
}

export type Distribution = {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
};

export function parseDistributions(raw: unknown): Record<string, Distribution> {
  const out: Record<string, Distribution> = {};
  for (const [k, v] of Object.entries(obj(raw))) {
    const o = obj(v);
    const vals = ["n", "min", "p25", "median", "p75", "max"].map((f) => num(o[f]));
    if (KEY.test(k) && vals.every((x) => x != null)) {
      const [n, min, p25, median, p75, max] = vals as number[];
      out[k] = { n: n!, min: min!, p25: p25!, median: median!, p75: p75!, max: max! };
    }
  }
  return out;
}

export type CountyName = { fips: string; name: string };

export function parseCountyNames(raw: unknown, max = 400): CountyName[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, max).flatMap((c) => {
    const o = obj(c);
    const fips = str(o["fips"]);
    return FIPS.test(fips) && str(o["name"]) ? [{ fips, name: str(o["name"], 120) }] : [];
  });
}

export type DistrictSummary = {
  courtId: string;
  name: string;
  usps: string;
  population: number | null;
  landSqmi: number | null;
  density: number | null;
  demographics: Record<string, number | null>;
  incomeRange: [number, number] | null;
  residentsFjc5y: number | null;
  residentsFjcRate: number | null;
  residentsCoreRate: number | null;
  oshaRate: number | null;
  cfpbRate: number | null;
  filedByResidence: Record<string, number>;
  filedByResidenceCore: Record<string, number>;
  filedFy: Record<string, number>;
  filed5y: number | null;
  counties: CountyName[];
  screened: CountyName[];
  divisions: { name: string; heldAt: string[]; counties: string[] }[];
  basis: string[];
};

export function parseDistrict(raw: unknown): DistrictSummary | null {
  const p = obj(raw);
  const courtId = str(p["court_id"]);
  const usps = str(p["usps"]);
  if (!COURT.test(courtId) || !USPS.test(usps)) return null;
  const range = Array.isArray(p["median_income_range"]) ? p["median_income_range"].map(num) : [];
  return {
    courtId,
    name: str(p["name"], 120) || courtId,
    usps,
    population: num(p["population"]),
    landSqmi: num(p["land_sqmi"]),
    density: num(p["density"]),
    demographics: parseMetrics(p["demographics"]),
    incomeRange:
      range.length === 2 && range[0] != null && range[1] != null ? [range[0], range[1]] : null,
    residentsFjc5y: num(p["residents_fjc_5y"]),
    residentsFjcRate: num(p["residents_fjc_rate"]),
    residentsCoreRate: num(p["residents_core_rate"]),
    oshaRate: num(p["osha_rate"]),
    cfpbRate: num(p["cfpb_rate"]),
    filedByResidence: parseCounts(p["filed_by_residence"]),
    filedByResidenceCore: parseCounts(p["filed_by_residence_core"]),
    filedFy: parseYearSeries(p["filed_fy"]),
    filed5y: num(p["filed_5y"]),
    counties: parseCountyNames(p["counties"]),
    screened: parseCountyNames(p["screened_counties"], 50),
    divisions: Array.isArray(p["divisions"])
      ? p["divisions"].slice(0, 40).flatMap((d) => {
          const o = obj(d);
          return str(o["name"])
            ? [
                {
                  name: str(o["name"], 120),
                  heldAt: strings(o["held_at"], 20, 160),
                  counties: strings(o["counties"], 300, 5).filter((f) => FIPS.test(f)),
                },
              ]
            : [];
        })
      : [],
    basis: strings(p["basis"], 5, 300).filter((u) => /^https:\/\//.test(u)),
  };
}

export type ScreenedCounty = { fips: string; name: string; reasons: string[] };

export function parseScreened(raw: unknown): ScreenedCounty[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).flatMap((c) => {
    const o = obj(c);
    const fips = str(o["fips"]);
    return FIPS.test(fips)
      ? [{ fips, name: str(o["name"], 120), reasons: strings(o["reasons"], 4, 600) }]
      : [];
  });
}
