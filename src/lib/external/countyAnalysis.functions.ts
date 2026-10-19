/**
 * County analysis reads (datasets county_profiles and county_legal_activity, built by
 * scripts/enrichment/state_analysis). Read-only, bounded PostgREST queries selecting only the JSON paths a view needs.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import {
  COURT,
  FIPS,
  num,
  obj,
  parseCounts,
  parseDistrict,
  parseDistributions,
  parseDistrictRef,
  parseMetrics,
  parseYearSeries,
  str,
  strings,
  type DistrictRef,
  type DistrictSummary,
  type Distribution,
} from "./placeAnalysisParse";

export type CountyRow = {
  id: string;
  name: string;
  courtId: string | null;
  metrics: Record<string, number | null>;
  /** Reasons the county's FJC residence code was screened out (its FJC rates are Not recorded). */
  screened: string[];
  note: string | null;
};
export type StateCountyAnalysis = { usps: string; counties: CountyRow[] };

type ProfileRow = { id: string; n: unknown; m: unknown; c: unknown };
type LegalRow = { id: string; m: unknown; f: unknown; note: unknown };

/** Merge the demographic and legal rows of one state by county FIPS (pure; exported for tests). */
export function mergeCountyRows(profiles: ProfileRow[], legal: LegalRow[]): CountyRow[] {
  const byId = new Map(legal.filter((l) => FIPS.test(l.id)).map((l) => [l.id, l]));
  return profiles
    .filter((p) => FIPS.test(p.id) && typeof p.n === "string")
    .map((p) => {
      const l = byId.get(p.id);
      const court = typeof p.c === "string" && COURT.test(p.c) ? p.c : null;
      return {
        id: p.id,
        name: str(p.n, 120),
        courtId: court,
        metrics: { ...parseMetrics(p.m), ...(l ? parseMetrics(l.m) : {}) },
        screened: l ? strings(l.f, 4, 600) : [],
        note: l ? str(l.note, 600) || null : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

const CACHE_MS = 10 * 60 * 1000;
const stateCache = new Map<string, { at: number; value: StateCountyAnalysis }>();

/** Every county of one state with its map/ranking metrics (about 40 numbers each). */
export const getStateCountyAnalysis = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<StateCountyAnalysis> => {
    const hit = stateCache.get(data.usps);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const [profiles, legal] = await Promise.all([
      restGet<ProfileRow[]>(
        `corpus_records?select=id,n:item->profile->>name,m:item->metrics,c:item->profile->district->>court_id&dataset=eq.county_profiles&state=eq.${data.usps}&order=id.asc&limit=400`,
      ),
      restGet<LegalRow[]>(
        `corpus_records?select=id,m:item->metrics,f:item->legal->fjc_flag,note:item->legal->>note&dataset=eq.county_legal_activity&state=eq.${data.usps}&order=id.asc&limit=400`,
      ),
    ]);
    const value = { usps: data.usps, counties: mergeCountyRows(profiles.rows, legal.rows) };
    stateCache.set(data.usps, { at: Date.now(), value });
    return value;
  });

export type AcsValue = { v: number | null; moe: number | null };
export type CountyLegal = {
  fjcFy: Record<string, number>;
  fjcCoreFy: Record<string, number>;
  nos: Record<string, number>;
  window: Record<string, number>;
  byCourt: Record<string, number>;
  oshaFy: Record<string, number>;
  cfpbY: Record<string, number>;
  oshaSplitShare: number | null;
  cfpbSplitShare: number | null;
  cfpbCreditShare: number | null;
  echo: Record<string, number | null>;
  screened: string[];
  rateUnscreened: number | null;
  note: string | null;
  popMean: number | null;
};
export type CountyAnalysis = {
  fips: string;
  usps: string;
  name: string;
  state: string;
  metrics: Record<string, number | null>;
  acs: Record<string, AcsValue>;
  pep: Record<string, number>;
  lausRate: Record<string, number>;
  beaPerCapita: Record<string, number>;
  landSqmi: number | null;
  district: DistrictRef | null;
  legal: CountyLegal | null;
  stateDistributions: Record<string, Distribution>;
  stateValues: Record<string, number | null>;
  usValues: Record<string, number | null>;
  districtSummary: DistrictSummary | null;
  cities: {
    id: string;
    name: string;
    population: number | null;
    share: number | null;
    incorporated: boolean;
  }[];
};

export function parseAcs(raw: unknown): Record<string, AcsValue> {
  const out: Record<string, AcsValue> = {};
  for (const [k, v] of Object.entries(obj(raw))) {
    if (!/^[a-z0-9_]{1,64}$/.test(k)) continue;
    const o = obj(v);
    out[k] = { v: num(o["v"]), moe: num(o["moe"]) };
  }
  return out;
}

export function parseLegal(raw: unknown): CountyLegal | null {
  const l = obj(raw);
  if (!Object.keys(l).length) return null;
  const echo: Record<string, number | null> = {};
  for (const k of [
    "echo_facilities",
    "echo_active",
    "echo_inspections_5y",
    "echo_formal_actions",
    "echo_with_formal",
    "echo_snc",
    "echo_formal_per_1k",
  ])
    echo[k] = num(l[k]);
  return {
    fjcFy: parseYearSeries(l["fjc_fy"]),
    fjcCoreFy: parseYearSeries(l["fjc_core_fy"]),
    nos: parseCounts(l["fjc_nos"]),
    window: parseCounts(l["fjc_window"]),
    byCourt: Object.fromEntries(
      Object.entries(parseCounts(l["fjc_by_court"])).filter(([k]) => COURT.test(k)),
    ),
    oshaFy: parseYearSeries(l["osha_fy"]),
    cfpbY: parseYearSeries(l["cfpb_y"]),
    oshaSplitShare: num(l["osha_split_share"]),
    cfpbSplitShare: num(l["cfpb_split_share"]),
    cfpbCreditShare: num(l["cfpb_credit_share"]),
    echo,
    screened: strings(l["fjc_flag"], 4, 600),
    rateUnscreened: num(l["fjc_rate_unscreened"]),
    note: str(l["note"], 600) || null,
    popMean: num(l["pop_mean_2021_2025"]),
  };
}

type CityRow = { id: string; p: unknown; pop: unknown };

/** Cities whose ACS population parts include this county, largest first (pure; exported for tests). */
export function citiesInCounty(rows: CityRow[], fips: string) {
  return rows
    .flatMap((r) => {
      const p = obj(r.p);
      const part = (Array.isArray(p["counties"]) ? p["counties"] : [])
        .map(obj)
        .find((c) => c["fips"] === fips);
      if (!/^\d{7}$/.test(r.id) || !part) return [];
      return [
        {
          id: r.id,
          name: str(p["name"], 120),
          population: num(r.pop),
          share: num(part["share"]),
          incorporated: p["funcstat"] !== "S",
        },
      ];
    })
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    .slice(0, 60);
}

/** One county: full profile, legal activity, the state's distributions for comparison, its district and its cities. */
export const getCountyAnalysis = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ fips: z.string().regex(/^\d{5}$/) }).parse(d))
  .handler(async ({ data }): Promise<CountyAnalysis | null> => {
    const [profile, legal] = await Promise.all([
      restGet<{ p: unknown; m: unknown; st: string }[]>(
        `corpus_records?select=p:item->profile,m:item->metrics,st:state&dataset=eq.county_profiles&id=eq.${data.fips}&limit=1`,
      ),
      restGet<{ l: unknown; m: unknown }[]>(
        `corpus_records?select=l:item->legal,m:item->metrics&dataset=eq.county_legal_activity&id=eq.${data.fips}&limit=1`,
      ),
    ]);
    const row = profile.rows[0];
    if (!row || !/^[A-Z]{2}$/.test(row.st)) return null;
    const p = obj(row.p);
    const usps = row.st;
    const district = parseDistrictRef(p["district"]);
    const [stateRow, districtRow, cityRows] = await Promise.all([
      restGet<{ d: unknown; v: unknown; us: unknown }[]>(
        `corpus_records?select=d:item->profile->distributions,v:item->profile->values,us:item->profile->us&dataset=eq.state_cross_analysis&id=eq.state:${usps}&limit=1`,
      ),
      district
        ? restGet<{ p: unknown }[]>(
            `corpus_records?select=p:item->profile&dataset=eq.state_cross_analysis&id=eq.district:${district.courtId}&limit=1`,
          )
        : Promise.resolve({ rows: [] as { p: unknown }[], total: null }),
      restGet<CityRow[]>(
        `corpus_records?select=id,p:item->place,pop:item->metrics->pop_acs&dataset=eq.city_profiles&state=eq.${usps}&item->place->counties=cs.${encodeURIComponent(JSON.stringify([{ fips: data.fips }]))}&limit=200`,
      ),
    ]);
    const s = stateRow.rows[0];
    return {
      fips: data.fips,
      usps,
      name: str(p["name"], 120),
      state: str(p["state"], 60),
      metrics: { ...parseMetrics(row.m), ...parseMetrics(legal.rows[0]?.m) },
      acs: parseAcs(p["acs"]),
      pep: parseYearSeries(p["pep"]),
      lausRate: parseYearSeries(p["laus_rate"]),
      beaPerCapita: parseYearSeries(p["bea_per_capita"]),
      landSqmi: num(p["land_sqmi"]),
      district,
      legal: legal.rows[0] ? parseLegal(legal.rows[0].l) : null,
      stateDistributions: s ? parseDistributions(s.d) : {},
      stateValues: s ? parseMetrics(s.v) : {},
      usValues: s ? parseMetrics(s.us) : {},
      districtSummary: districtRow.rows[0] ? parseDistrict(districtRow.rows[0].p) : null,
      cities: citiesInCounty(cityRows.rows, data.fips),
    };
  });
