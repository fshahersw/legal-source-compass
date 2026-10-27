/**
 * Exposure geography: typed views of three planned corpus datasets built by scripts/enrichment/exposure_geo
 * (CMS Part D prescriptions for drugs named in MDL titles, CDC PLACES county estimates for MDL-linked conditions, EPA
 * UCMR 5 PFAS occurrence for the AFFF MDL). Pure: parses jsonb, never fills a gap, never sums what is not additive.
 *
 * Every value is either the published figure or null ("Not recorded"). A Part D year whose state total misses a
 * suppressed product is a lower bound and is flagged, never ranked.
 */

export const EXPOSURE_DATASETS = {
  partd: "exposure_partd_mdl_drugs",
  places: "exposure_places_county",
  pfasStates: "exposure_ucmr5_pfas_states",
  pfasSystems: "exposure_ucmr5_pfas_systems",
} as const;

export const PARTD_SOURCE = {
  label: "CMS, Medicare Part D Prescribers by Geography and Drug",
  url: "https://data.cms.gov/provider-summary-by-type-of-service/medicare-part-d-prescribers/medicare-part-d-prescribers-by-geography-and-drug",
};
export const PLACES_SOURCE = {
  label: "CDC, PLACES county data (2025 release)",
  url: "https://data.cdc.gov/d/swc5-untb",
};
export const UCMR_SOURCE = {
  label: "EPA, UCMR 5 occurrence data",
  url: "https://www.epa.gov/dwucmr/occurrence-data-unregulated-contaminant-monitoring-rule",
};
export const SDWIS_SOURCE = {
  label: "EPA, SDWIS water systems (population served)",
  url: "https://data.epa.gov/efservice/WATER_SYSTEM",
};

export type PartdProduct = {
  brand: string;
  generic: string;
  claims: number | null;
  fills: number | null;
  cost: number | null;
  benes: number | null;
};
export type PartdPoint = {
  year: number;
  claims: number | null;
  fills: number | null;
  cost: number | null;
  benes: number | null;
  lowerBound: boolean;
  missingProducts: string[];
  products: PartdProduct[];
};
export type PartdRank = {
  year: number;
  rank: number;
  of: number;
  shareOfNational: number | null;
};
export type PartdExposure = {
  mdl: string;
  mdlTitle: string;
  label: string;
  scope: "ingredient" | "brand";
  genericNames: string[];
  brandNames: string[];
  className: string | null;
  note: string | null;
  geo: { level: "state" | "national"; usps: string; name: string };
  series: PartdPoint[];
  latestRank: PartdRank | null;
};

export type Interval = { v: number | null; lo: number | null; hi: number | null };
export type MdlLink = {
  mdls: string[];
  relation: string;
  sourceLabel: string;
  sourceUrl: string;
  caveat: string | null;
};
export type PlacesMeasure = {
  id: string;
  label: string;
  year: string;
  crude: Interval;
  ageAdjusted: Interval;
  links: MdlLink[];
};
export type PlacesCounty = {
  fips: string | null;
  usps: string;
  county: string | null;
  stateName: string;
  population: number | null;
  adultPopulation: number | null;
  measures: PlacesMeasure[];
};

export type UcmrPopulation = {
  sum: number | null;
  withPopulation: number;
  withoutPopulation: number;
};
export type UcmrState = {
  agency: string;
  agencyName: string;
  systemsSampled: number;
  systemsWithDetect: number;
  systemsAtOrAbove4: number;
  populationSampled: UcmrPopulation;
  populationWithDetect: UcmrPopulation;
  populationAtOrAbove4: UcmrPopulation;
  byAnalyte: { analyte: string; systems: number }[];
  firstSample: string | null;
  lastSample: string | null;
};
export type UcmrSystem = {
  pwsid: string;
  name: string;
  populationServed: number | null;
  analytesDetected: number;
  pfoaMax: number | null;
  pfosMax: number | null;
  atOrAbove4: string[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Short name of an MDL for chart labels: the drug or product the title names, without "IN RE:" and the case type. */
export function shortMdlLabel(title: string): string {
  let t = title.replace(/^IN RE:\s*/i, "");
  t = t.replace(/\s+(Marketing|Products Liability|Film Products).*$/i, "").trim();
  const paren = /\(([^)]+)\)/.exec(t);
  if (t.length > 32 && paren && paren[1] && paren[1].length <= 12) return paren[1];
  if (t.length > 32 && paren) return t.slice(0, paren.index).trim();
  return t;
}

function parsePoint(v: unknown): PartdPoint | null {
  if (!isObj(v)) return null;
  const year = num(v["year"]);
  if (year === null) return null;
  const products = Array.isArray(v["products"])
    ? v["products"].filter(isObj).map((p) => ({
        brand: str(p["brand"]),
        generic: str(p["generic"]),
        claims: num(p["claims"]),
        fills: num(p["fills"]),
        cost: num(p["cost"]),
        benes: num(p["benes"]),
      }))
    : [];
  return {
    year,
    claims: num(v["claims"]),
    fills: num(v["fills"]),
    cost: num(v["cost"]),
    benes: num(v["benes"]),
    lowerBound: v["lower_bound"] === true,
    missingProducts: strs(v["missing_products"]),
    products,
  };
}

export function parsePartd(v: unknown): PartdExposure | null {
  if (!isObj(v) || v["kind"] !== "partd_mdl_drug") return null;
  const geo = isObj(v["geo"]) ? v["geo"] : null;
  const mdl = str(v["mdl"]);
  if (!geo || !/^\d{1,6}$/.test(mdl)) return null;
  const level = geo["level"] === "national" ? "national" : "state";
  const rank = isObj(v["latest_rank"]) ? v["latest_rank"] : null;
  const rankYear = rank ? num(rank["year"]) : null;
  const rankN = rank ? num(rank["rank"]) : null;
  const rankOf = rank ? num(rank["of"]) : null;
  const title = str(v["mdl_title"]);
  return {
    mdl,
    mdlTitle: title,
    label: shortMdlLabel(title),
    scope: v["scope"] === "brand" ? "brand" : "ingredient",
    genericNames: strs(v["generic_names"]),
    brandNames: strs(v["brand_names"]),
    className: str(v["class_name"]) || null,
    note: str(v["note"]) || null,
    geo: { level, usps: str(geo["usps"]), name: str(geo["name"]) },
    series: (Array.isArray(v["series"]) ? v["series"] : [])
      .map(parsePoint)
      .filter((p): p is PartdPoint => p !== null)
      .sort((a, b) => a.year - b.year),
    latestRank:
      rankYear !== null && rankN !== null && rankOf !== null
        ? {
            year: rankYear,
            rank: rankN,
            of: rankOf,
            shareOfNational: num(rank?.["share_of_national"]),
          }
        : null,
  };
}

const interval = (v: unknown): Interval =>
  isObj(v)
    ? { v: num(v["v"]), lo: num(v["lo"]), hi: num(v["hi"]) }
    : { v: null, lo: null, hi: null };

export function parsePlaces(v: unknown): PlacesCounty | null {
  if (!isObj(v) || v["kind"] !== "places_county") return null;
  const measures = isObj(v["measures"]) ? v["measures"] : {};
  const linkMap = isObj(v["mdl_links"]) ? v["mdl_links"] : {};
  const fips = str(v["fips"]);
  return {
    fips: /^\d{5}$/.test(fips) ? fips : null,
    usps: str(v["usps"]),
    county: str(v["county"]) || null,
    stateName: str(v["state_name"]),
    population: num(v["population"]),
    adultPopulation: num(v["adult_population"]),
    measures: Object.entries(measures)
      .filter((e): e is [string, Obj] => isObj(e[1]))
      .map(([id, m]) => ({
        id,
        label: str(m["label"]) || id,
        year: str(m["year"]),
        crude: interval(m["crude"]),
        ageAdjusted: interval(m["age_adjusted"]),
        links: (Array.isArray(linkMap[id]) ? (linkMap[id] as unknown[]) : [])
          .filter(isObj)
          .map((l) => ({
            mdls: strs(l["mdls"]),
            relation: str(l["relation"]),
            sourceLabel: str(l["source_label"]),
            sourceUrl: str(l["source_url"]),
            caveat: str(l["caveat"]) || null,
          })),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

const population = (v: unknown): UcmrPopulation =>
  isObj(v)
    ? {
        sum: num(v["sum"]),
        withPopulation: num(v["systems_with_population"]) ?? 0,
        withoutPopulation: num(v["systems_without_population"]) ?? 0,
      }
    : { sum: null, withPopulation: 0, withoutPopulation: 0 };

export function parseUcmrState(v: unknown): UcmrState | null {
  if (!isObj(v) || v["kind"] !== "ucmr5_state") return null;
  const sampled = num(v["systems_sampled"]);
  if (sampled === null) return null;
  const by = isObj(v["systems_detecting_by_analyte"]) ? v["systems_detecting_by_analyte"] : {};
  return {
    agency: str(v["agency"]),
    agencyName: str(v["agency_name"]),
    systemsSampled: sampled,
    systemsWithDetect: num(v["systems_with_detect"]) ?? 0,
    systemsAtOrAbove4: num(v["systems_pfoa_pfos_at_or_above_4"]) ?? 0,
    populationSampled: population(v["population_sampled"]),
    populationWithDetect: population(v["population_with_detect"]),
    populationAtOrAbove4: population(v["population_pfoa_pfos_at_or_above_4"]),
    byAnalyte: Object.entries(by)
      .map(([analyte, n]) => ({ analyte, systems: num(n) ?? 0 }))
      .sort((a, b) => b.systems - a.systems || a.analyte.localeCompare(b.analyte)),
    firstSample: str(v["first_sample"]) || null,
    lastSample: str(v["last_sample"]) || null,
  };
}

export function parseUcmrSystem(v: unknown): UcmrSystem | null {
  if (!isObj(v)) return null;
  const pwsid = str(v["pwsid"]);
  if (!pwsid) return null;
  return {
    pwsid,
    name: str(v["name"]) || pwsid,
    populationServed: num(v["population_served"]),
    analytesDetected: num(v["analytes_detected"]) ?? 0,
    pfoaMax: num(v["pfoa_max_ngl"]),
    pfosMax: num(v["pfos_max_ngl"]),
    atOrAbove4: strs(v["pfoa_pfos_at_or_above_4"]),
  };
}

/** The point for a given year, or the latest point. */
export function pointFor(e: PartdExposure, year?: number): PartdPoint | null {
  if (year === undefined) return e.series.at(-1) ?? null;
  return e.series.find((p) => p.year === year) ?? null;
}

/** Latest data year across the national records (the year every state is compared in). */
export function latestYear(national: readonly PartdExposure[]): number | null {
  const years = national.flatMap((e) => e.series.map((p) => p.year));
  return years.length ? Math.max(...years) : null;
}

/**
 * One row per MDL for a state in `year`: claims (null when not published, or when a suppressed product makes the total
 * a lower bound), the state's share of the national claims, and its rank among states.
 */
export function stateMdlRows(
  state: readonly PartdExposure[],
  national: readonly PartdExposure[],
  year: number,
) {
  const nat = new Map(national.map((e) => [e.mdl, pointFor(e, year)] as const));
  return state
    .map((e) => {
      const p = pointFor(e, year);
      const complete = p && !p.lowerBound ? p.claims : null;
      const natClaims = nat.get(e.mdl)?.claims ?? null;
      return {
        id: e.mdl,
        mdl: e.mdl,
        label: `${e.label} · MDL ${e.mdl}`,
        title: e.mdlTitle,
        claims: complete,
        lowerBound: p?.lowerBound ?? false,
        atLeast: p?.lowerBound ? p.claims : null,
        share: complete !== null && natClaims ? complete / natClaims : null,
        rank: e.latestRank && e.latestRank.year === year ? e.latestRank : null,
      };
    })
    .sort((a, b) => (b.claims ?? -1) - (a.claims ?? -1) || Number(a.mdl) - Number(b.mdl));
}

/** Year series of one record, with lower-bound years flagged so charts treat them as incomplete. */
export function claimsSeries(e: PartdExposure, years: readonly number[]) {
  return years.map((y) => {
    const p = pointFor(e, y);
    return { year: String(y), claims: p?.claims ?? null, partial: p?.lowerBound ?? false };
  });
}

export function median(values: readonly number[]): number | null {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** Measures that link to at least one MDL by a reviewed basis, in a stable order. */
export function linkedMeasures(counties: readonly PlacesCounty[]): PlacesMeasure[] {
  const seen = new Map<string, PlacesMeasure>();
  for (const c of counties)
    for (const m of c.measures) if (m.links.length && !seen.has(m.id)) seen.set(m.id, m);
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** County values of one measure (crude prevalence), the median of the counties that have one, and the count. */
export function measureDistribution(counties: readonly PlacesCounty[], measureId: string) {
  const items = counties
    .filter((c) => c.fips)
    .map((c) => {
      const m = c.measures.find((x) => x.id === measureId);
      return {
        fips: c.fips!,
        label: c.county ?? c.fips!,
        value: m?.crude.v ?? null,
        lo: m?.crude.lo ?? null,
        hi: m?.crude.hi ?? null,
        adults: c.adultPopulation,
      };
    });
  const values = items.map((i) => i.value).filter((v): v is number => v !== null);
  return { items, median: median(values), recorded: values.length };
}

/**
 * Adults with the condition, derived as crude prevalence × adult population for each county and summed; null when any
 * county lacks either figure. Labelled "derived" wherever it is shown.
 */
export function derivedAdults(counties: readonly PlacesCounty[], measureId: string): number | null {
  let total = 0;
  let any = false;
  for (const c of counties) {
    if (!c.fips) continue;
    const v = c.measures.find((m) => m.id === measureId)?.crude.v ?? null;
    if (v === null || c.adultPopulation === null) return null;
    total += (v / 100) * c.adultPopulation;
    any = true;
  }
  return any ? Math.round(total) : null;
}
