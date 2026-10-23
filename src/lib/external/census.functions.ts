/**
 * Census figures for one state or county page (datasets census_acs_states, census_acs1_states, census_pop_estimates,
 * census_cbp_states, census_acs_counties, census_cbp_counties; built by scripts/enrichment/census). Read-only, one
 * bounded PostgREST read per dataset; a dataset that fails to load is named in `unavailable` and the rest is still
 * returned. Rows are matched by exact geography id (state FIPS, five-digit county FIPS, `US`) and never filled from
 * another area.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { canonicalState } from "@/lib/corpus/stateHub";
import {
  parseCbp,
  parseCensusGeo,
  parsePep,
  type CbpGeo,
  type CensusGeo,
  type PepGeo,
} from "./censusModel";
import { restGet } from "./rest.server";

export type CensusPart = "acs5" | "acs1" | "pep" | "cbp";
export type AreaCensus = {
  /** ACS 5-year for the area, its state (counties) and the nation. */
  area: CensusGeo | null;
  state: CensusGeo | null;
  us: CensusGeo | null;
  /** ACS 1-year for states. */
  area1: CensusGeo | null;
  us1: CensusGeo | null;
  pep: PepGeo | null;
  statePep: PepGeo | null;
  usPep: PepGeo | null;
  cbp: CbpGeo | null;
  usCbp: CbpGeo | null;
  /** Parts that failed to load (not parts that simply have no row). */
  unavailable: CensusPart[];
};

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: AreaCensus }>();

async function readCensus(dataset: string, id: string): Promise<unknown | null> {
  const { rows } = await restGet<{ c: unknown }[]>(
    `corpus_records?select=c:item->census&dataset=eq.${dataset}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0]?.c ?? null;
}

type Reads = Record<string, Promise<unknown | null>>;

/** Resolve named reads independently; a rejected read becomes null and its part is reported unavailable. */
async function settle(reads: Reads, parts: Record<string, CensusPart>) {
  const names = Object.keys(reads);
  const results = await Promise.allSettled(names.map((n) => reads[n]!));
  const out: Record<string, unknown | null> = {};
  const unavailable = new Set<CensusPart>();
  results.forEach((r, i) => {
    const name = names[i]!;
    if (r.status === "fulfilled") out[name] = r.value;
    else {
      out[name] = null;
      unavailable.add(parts[name]!);
    }
  });
  return { out, unavailable: [...unavailable] };
}

/** Pure assembly of the stored payloads (exported for tests). */
export function assembleAreaCensus(
  out: Record<string, unknown | null>,
  unavailable: CensusPart[],
): AreaCensus {
  return {
    area: parseCensusGeo(out["area"]),
    state: parseCensusGeo(out["state"]),
    us: parseCensusGeo(out["us"]),
    area1: parseCensusGeo(out["area1"]),
    us1: parseCensusGeo(out["us1"]),
    pep: parsePep(out["pep"]),
    statePep: parsePep(out["statePep"]),
    usPep: parsePep(out["usPep"]),
    cbp: parseCbp(out["cbp"]),
    usCbp: parseCbp(out["usCbp"]),
    unavailable,
  };
}

const PARTS: Record<string, CensusPart> = {
  area: "acs5",
  state: "acs5",
  us: "acs5",
  area1: "acs1",
  us1: "acs1",
  pep: "pep",
  statePep: "pep",
  usPep: "pep",
  cbp: "cbp",
  usCbp: "cbp",
};

/** Census figures for a state: ACS 5-year and 1-year with the national comparison, Population Estimates, County Business Patterns. */
export const getStateCensus = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<AreaCensus> => {
    const hit = cache.get(`s:${data.usps}`);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const fips = canonicalState(data.usps)?.fips;
    if (!fips) return assembleAreaCensus({}, []);
    const { out, unavailable } = await settle(
      {
        area: readCensus("census_acs_states", fips),
        us: readCensus("census_acs_states", "US"),
        area1: readCensus("census_acs1_states", fips),
        us1: readCensus("census_acs1_states", "US"),
        pep: readCensus("census_pop_estimates", fips),
        usPep: readCensus("census_pop_estimates", "US"),
        cbp: readCensus("census_cbp_states", fips),
        usCbp: readCensus("census_cbp_states", "US"),
      },
      PARTS,
    );
    const value = assembleAreaCensus(out, unavailable);
    if (!unavailable.length) cache.set(`s:${data.usps}`, { at: Date.now(), value });
    return value;
  });

/** Census figures for a county: ACS 5-year beside its state and the nation, Population Estimates, County Business Patterns. */
export const getCountyCensus = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ fips: z.string().regex(/^\d{5}$/) }).parse(d))
  .handler(async ({ data }): Promise<AreaCensus> => {
    const hit = cache.get(`c:${data.fips}`);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const stateFips = data.fips.slice(0, 2);
    const { out, unavailable } = await settle(
      {
        area: readCensus("census_acs_counties", data.fips),
        state: readCensus("census_acs_states", stateFips),
        us: readCensus("census_acs_states", "US"),
        pep: readCensus("census_pop_estimates", data.fips),
        statePep: readCensus("census_pop_estimates", stateFips),
        usPep: readCensus("census_pop_estimates", "US"),
        cbp: readCensus("census_cbp_counties", data.fips),
        usCbp: readCensus("census_cbp_states", "US"),
      },
      PARTS,
    );
    const value = assembleAreaCensus(out, unavailable);
    if (!unavailable.length) cache.set(`c:${data.fips}`, { at: Date.now(), value });
    return value;
  });
