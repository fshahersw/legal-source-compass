/**
 * Pure models for two /places/$state analysis sections:
 *  - Outreach profile: residents 65+, with a disability, veterans, speaking a language other than English at home and
 *    households without broadband (Census ACS 5-year), for the state and rolled up to its federal districts.
 *  - Occupational-exposure screen: each county's share of employees in a sector (County Business Patterns) beside its
 *    OSHA inspection rate, joined on the exact 5-digit FIPS.
 * Shares are never counts of claimants or plaintiffs; a missing value is null ("Not recorded"), never 0.
 */

export type Share = { v: number; moe: number | null };

export type OutreachMeasure = {
  key: "age_65plus" | "disability" | "veterans" | "non_english" | "no_broadband";
  label: string;
  /** The ACS universe the published share is of. */
  universe: string;
  /** True when the universe is the total population, so a population-weighted district roll-up is exact. */
  totalPopUniverse: boolean;
};

export const OUTREACH_MEASURES: readonly OutreachMeasure[] = [
  { key: "age_65plus", label: "Aged 65 and over", universe: "total population", totalPopUniverse: true },
  {
    key: "disability",
    label: "With a disability",
    universe: "civilian noninstitutionalized population",
    totalPopUniverse: false,
  },
  { key: "veterans", label: "Veterans", universe: "civilian population 18 and over", totalPopUniverse: false },
  {
    key: "non_english",
    label: "Speak a language other than English at home",
    universe: "population 5 and over",
    totalPopUniverse: false,
  },
  {
    key: "no_broadband",
    label: "Households without a broadband subscription",
    universe: "households (100 minus the published broadband share)",
    totalPopUniverse: false,
  },
];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** ACS latest block ({measure: [value, moe, year, flag?]}) as shares for the outreach measures, plus population. */
export function parseLatest(raw: unknown): { year: number | null; pop: number | null; shares: Partial<Record<OutreachMeasure["key"], Share>> } {
  const l = obj(raw) ?? {};
  const cell = (k: string) => (Array.isArray(l[k]) ? (l[k] as unknown[]) : null);
  const pop = cell("pop");
  const shares: Partial<Record<OutreachMeasure["key"], Share>> = {};
  for (const m of OUTREACH_MEASURES) {
    const c = cell(m.key === "no_broadband" ? "broadband" : m.key);
    const v = fin(c?.[0]);
    if (v === null || v < 0 || v > 100) continue;
    shares[m.key] = { v: m.key === "no_broadband" ? 100 - v : v, moe: fin(c?.[1]) };
  }
  return { year: fin(pop?.[2]) ?? fin(cell("age_65plus")?.[2]), pop: fin(pop?.[0]), shares };
}

export type CountyAcs = {
  fips: string;
  name: string;
  year: number | null;
  pop: number | null;
  shares: Partial<Record<OutreachMeasure["key"], Share>>;
};

/** Keep the counties of the latest ACS release only (drops retired geographies, e.g. Connecticut's former counties). */
export function currentCounties(rows: readonly CountyAcs[]): CountyAcs[] {
  const latest = Math.max(...rows.map((r) => r.year ?? -Infinity));
  return Number.isFinite(latest) ? rows.filter((r) => r.year === latest) : [];
}

export type DistrictOutreach = {
  courtId: string;
  counties: number;
  pop: number;
  /** Population-weighted share of the district's counties with a value; exact only for total-population universes. */
  shares: Partial<Record<OutreachMeasure["key"], { v: number; exact: boolean; covered: number }>>;
};

/** Roll county shares up to districts by exact county FIPS -> court id. Counties without a district are left out. */
export function districtOutreach(
  counties: readonly CountyAcs[],
  courtByFips: ReadonlyMap<string, string>,
): DistrictOutreach[] {
  const by = new Map<string, CountyAcs[]>();
  for (const c of counties) {
    const court = courtByFips.get(c.fips);
    if (!court) continue;
    by.set(court, [...(by.get(court) ?? []), c]);
  }
  return [...by.entries()]
    .map(([courtId, list]) => {
      const shares: DistrictOutreach["shares"] = {};
      for (const m of OUTREACH_MEASURES) {
        let num = 0;
        let den = 0;
        let covered = 0;
        for (const c of list) {
          const s = c.shares[m.key];
          if (!s || c.pop == null || c.pop <= 0) continue;
          num += s.v * c.pop;
          den += c.pop;
          covered++;
        }
        if (den > 0) shares[m.key] = { v: num / den, exact: m.totalPopUniverse, covered };
      }
      return {
        courtId,
        counties: list.length,
        pop: list.reduce((s, c) => s + (c.pop ?? 0), 0),
        shares,
      };
    })
    .sort((a, b) => b.pop - a.pop || a.courtId.localeCompare(b.courtId));
}

// ------------------------------------------------------------------------------------------------ exposure screen

export const EXPOSURE_SECTORS = [
  { code: "31-33", label: "Manufacturing" },
  { code: "23", label: "Construction" },
  { code: "21", label: "Mining, quarrying, and oil and gas extraction" },
  { code: "62", label: "Health care and social assistance" },
] as const;
export type SectorCode = (typeof EXPOSURE_SECTORS)[number]["code"];

export type CountyCbp = { fips: string; name: string; total: number | null; sectors: Partial<Record<SectorCode, number>> };

/** One census_cbp_counties series block for a year: employees (the second element) per sector, total from "00". */
export function parseCbp(fips: string, name: string, series: unknown, year: string): CountyCbp {
  const s = obj(series) ?? {};
  const employees = (code: string): number | null => {
    const cell = obj(s[code])?.[year];
    return Array.isArray(cell) ? fin(cell[1]) : null;
  };
  const sectors: CountyCbp["sectors"] = {};
  for (const sec of EXPOSURE_SECTORS) {
    const e = employees(sec.code);
    if (e !== null && e >= 0) sectors[sec.code] = e;
  }
  return { fips, name, total: employees("00"), sectors };
}

export type ExposurePoint = {
  fips: string;
  name: string;
  /** Sector employees as % of all CBP employees in the county. */
  share: number;
  employees: number;
  oshaRate: number;
  oshaBase: number | null;
};

const median = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Counties with both a sector share and an OSHA rate (exact FIPS join), the state medians of each, and the counties
 * above both medians. A suppressed CBP cell or a missing OSHA rate leaves the county out (counted in `leftOut`).
 */
export function exposureScreen(
  cbp: readonly CountyCbp[],
  osha: ReadonlyMap<string, { rate: number | null; base: number | null }>,
  sector: SectorCode,
): { points: ExposurePoint[]; medianShare: number | null; medianOsha: number | null; above: ExposurePoint[]; leftOut: number } {
  const points: ExposurePoint[] = [];
  let leftOut = 0;
  for (const c of cbp) {
    const e = c.sectors[sector];
    const o = osha.get(c.fips);
    if (e == null || c.total == null || c.total <= 0 || !o || o.rate == null) {
      leftOut++;
      continue;
    }
    points.push({ fips: c.fips, name: c.name, share: (e / c.total) * 100, employees: e, oshaRate: o.rate, oshaBase: o.base });
  }
  const medianShare = median(points.map((p) => p.share));
  const medianOsha = median(points.map((p) => p.oshaRate));
  const above =
    medianShare === null || medianOsha === null
      ? []
      : points
          .filter((p) => p.share > medianShare && p.oshaRate > medianOsha)
          .sort((a, b) => b.employees - a.employees || a.name.localeCompare(b.name));
  return { points, medianShare, medianOsha, above, leftOut };
}
