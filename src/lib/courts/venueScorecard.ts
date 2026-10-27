/**
 * MDL transferee-venue scorecard: for each district holding pending MDL actions (JPML report), its congestion
 * (FCMS) and the citizen voting-age population of its counties (Census ACS 5-year, table B29001), a proxy for the
 * jury-eligible population. Pure. Counties join districts only through the district court id that the county
 * profile records from 28 U.S.C. chapter 5 (exact county FIPS -> court id); a county without one is left out and
 * counted. Margins of error are combined by the Census root-sum-of-squares approximation for sums.
 */

export type CountyDistrict = { fips: string; courtId: string | null; division: string | null };

export type CvapCounty = {
  fips: string;
  cvap: number | null;
  cvapMoe: number | null;
  age18to29: number | null;
  age30to44: number | null;
  age45to64: number | null;
  age65plus: number | null;
};

export type DistrictCvap = {
  courtId: string;
  counties: number;
  /** Counties of the district with no 2024 CVAP estimate. */
  countiesMissing: number;
  cvap: number;
  cvapMoe: number | null;
  ages: { age18to29: number; age30to44: number; age45to64: number; age65plus: number } | null;
  divisions: { name: string; counties: number; cvap: number }[];
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const FIPS = /^\d{5}$/;

/** A county_profiles row read as {id, court, division}. */
export function parseCountyDistrict(raw: unknown): CountyDistrict | null {
  const r = obj(raw);
  const fips = r?.["id"];
  if (typeof fips !== "string" || !FIPS.test(fips)) return null;
  const court = r!["court"];
  const division = r!["division"];
  return {
    fips,
    courtId: typeof court === "string" && /^[a-z0-9]{2,16}$/.test(court) ? court : null,
    division: typeof division === "string" && division.trim() ? division.trim().slice(0, 80) : null,
  };
}

/** A census_acs_cvap_counties row read as {id, years}; only county rows (5-digit FIPS) with a 2024 block. */
export function parseCvapCounty(raw: unknown, year = "2024"): CvapCounty | null {
  const r = obj(raw);
  const fips = r?.["id"];
  if (typeof fips !== "string" || !FIPS.test(fips)) return null;
  const y = obj(obj(r!["years"])?.[year]);
  const e = obj(y?.["estimate"]);
  const m = obj(y?.["moe"]);
  if (!e) return null;
  const n = (o: Json | null, k: string) => (isNum(o?.[k]) ? (o![k] as number) : null);
  return {
    fips,
    cvap: n(e, "cvap"),
    cvapMoe: n(m, "cvap"),
    age18to29: n(e, "age_18_29"),
    age30to44: n(e, "age_30_44"),
    age45to64: n(e, "age_45_64"),
    age65plus: n(e, "age_65_plus"),
  };
}

export function districtCvap(
  counties: readonly CountyDistrict[],
  cvap: readonly CvapCounty[],
): Map<string, DistrictCvap> {
  const byFips = new Map(cvap.map((c) => [c.fips, c]));
  const out = new Map<string, DistrictCvap & { moeSq: number; moeMissing: boolean; agesOk: boolean }>();
  for (const c of counties) {
    if (!c.courtId) continue;
    let d = out.get(c.courtId);
    if (!d) {
      d = {
        courtId: c.courtId,
        counties: 0,
        countiesMissing: 0,
        cvap: 0,
        cvapMoe: null,
        ages: { age18to29: 0, age30to44: 0, age45to64: 0, age65plus: 0 },
        divisions: [],
        moeSq: 0,
        moeMissing: false,
        agesOk: true,
      };
      out.set(c.courtId, d);
    }
    d.counties++;
    const v = byFips.get(c.fips);
    if (!v || v.cvap === null) {
      d.countiesMissing++;
      continue;
    }
    d.cvap += v.cvap;
    if (v.cvapMoe === null) d.moeMissing = true;
    else d.moeSq += v.cvapMoe ** 2;
    if (
      v.age18to29 === null ||
      v.age30to44 === null ||
      v.age45to64 === null ||
      v.age65plus === null
    )
      d.agesOk = false;
    else if (d.ages) {
      d.ages.age18to29 += v.age18to29;
      d.ages.age30to44 += v.age30to44;
      d.ages.age45to64 += v.age45to64;
      d.ages.age65plus += v.age65plus;
    }
    if (c.division) {
      const div = d.divisions.find((x) => x.name === c.division);
      if (div) {
        div.counties++;
        div.cvap += v.cvap;
      } else d.divisions.push({ name: c.division, counties: 1, cvap: v.cvap });
    }
  }
  const result = new Map<string, DistrictCvap>();
  for (const [k, d] of out) {
    const { moeSq, moeMissing, agesOk, ...rest } = d;
    result.set(k, {
      ...rest,
      cvapMoe: moeMissing || d.counties === d.countiesMissing ? null : Math.round(Math.sqrt(moeSq)),
      ages: agesOk && d.countiesMissing === 0 ? d.ages : null,
      divisions: d.divisions.sort((a, b) => b.cvap - a.cvap || a.name.localeCompare(b.name)),
    });
  }
  return result;
}

/** Age shares (percent) of a district's CVAP; null when the age split is not complete. */
export function ageShares(d: DistrictCvap) {
  if (!d.ages) return null;
  const total = d.ages.age18to29 + d.ages.age30to44 + d.ages.age45to64 + d.ages.age65plus;
  if (!(total > 0)) return null;
  const p = (v: number) => (100 * v) / total;
  return {
    age18to29: p(d.ages.age18to29),
    age30to44: p(d.ages.age30to44),
    age45to64: p(d.ages.age45to64),
    age65plus: p(d.ages.age65plus),
  };
}
