/**
 * Exposure geography reads (planned datasets exposure_partd_mdl_drugs, exposure_places_county,
 * exposure_ucmr5_pfas_states, exposure_ucmr5_pfas_systems; built by scripts/enrichment/exposure_geo). Read-only,
 * bounded PostgREST reads filtered by dataset. A dataset that is not published (or not marked ready) yields a null part
 * and the UI renders nothing for it; nothing is substituted from another source. Rows are selected by exact ids only:
 * the state's USPS code, a five-digit county FIPS or an MDL number.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import {
  EXPOSURE_DATASETS,
  parsePartd,
  parsePlaces,
  parseUcmrState,
  parseUcmrSystem,
  type PartdExposure,
  type PlacesCounty,
  type UcmrState,
  type UcmrSystem,
} from "@/components/places/exposure/exposureModel";
import { restGet } from "./rest.server";

type DatasetKey = keyof typeof EXPOSURE_DATASETS;
type Row = { id: string; e: unknown };

export type PartdPart = { state: PartdExposure[]; national: PartdExposure[] };
export type PlacesPart = { counties: PlacesCounty[]; national: PlacesCounty | null };
export type PfasPart = {
  state: UcmrState | null;
  national: UcmrState | null;
  /** Systems with at least one PFAS detected, most analytes first (at most SYSTEM_LIMIT). */
  systems: UcmrSystem[];
  systemsTruncated: boolean;
};
export type StateExposure = {
  usps: string;
  partd: PartdPart | null;
  places: PlacesPart | null;
  pfas: PfasPart | null;
  readAt: string;
};
export type CountyExposure = {
  fips: string;
  county: PlacesCounty | null;
  /** Other counties of the same state, for the state median. */
  peers: PlacesCounty[];
  national: PlacesCounty | null;
  readAt: string;
};
export type MdlExposure = {
  mdl: string;
  /** Every state and the nation for this MDL's drugs. */
  partd: PartdExposure[] | null;
  /** PFAS by state (only for the AFFF MDL 2873). */
  pfas: UcmrState[] | null;
  readAt: string;
};

const SYSTEM_LIMIT = 300;
const PFAS_MDL = "2873";
const SYSTEM_SELECT = [
  "id",
  "pwsid:item->exposure->>pwsid",
  "name:item->exposure->>name",
  "population_served:item->exposure->population_served",
  "analytes_detected:item->exposure->analytes_detected",
  "pfoa_max_ngl:item->exposure->pfoa_max_ngl",
  "pfos_max_ngl:item->exposure->pfos_max_ngl",
  "pfoa_pfos_at_or_above_4:item->exposure->pfoa_pfos_at_or_above_4",
].join(",");

/** Which exposure datasets are published and ready. */
const readReady = memoAsync(READ_TTL_MS, async (): Promise<Set<DatasetKey>> => {
  const ids = Object.values(EXPOSURE_DATASETS).join(",");
  const { rows } = await restGet<
    { id: string; ready: boolean | null; imported_records: number | null }[]
  >(`corpus_datasets?select=id,ready,imported_records&id=in.(${ids})`);
  const ready = new Set<DatasetKey>();
  for (const [key, id] of Object.entries(EXPOSURE_DATASETS) as [DatasetKey, string][]) {
    const row = rows.find((r) => r.id === id);
    if (row?.ready && (row.imported_records ?? 0) > 0) ready.add(key);
  }
  return ready;
});

const memo = new Map<string, () => Promise<unknown>>();
function keyed<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let m = memo.get(key);
  if (!m) {
    m = memoAsync(READ_TTL_MS, fn);
    memo.set(key, m);
  }
  return m() as Promise<T>;
}

const exposureRows = (dataset: string, filter: string, limit: number) =>
  restGet<Row[]>(
    `corpus_records?select=id,e:item->exposure&dataset=eq.${dataset}&${filter}&order=ordinal.asc&limit=${limit}`,
  ).then((r) => r.rows);

const cs = (obj: Record<string, string[]>) =>
  `filters=cs.${encodeURIComponent(JSON.stringify(obj))}`;

async function readPartdState(usps: string): Promise<PartdPart> {
  const ds = EXPOSURE_DATASETS.partd;
  const [state, national] = await Promise.all([
    exposureRows(ds, cs({ state: [usps] }), 200),
    exposureRows(ds, cs({ state: ["US"] }), 200),
  ]);
  const parse = (rows: Row[]) =>
    rows.map((r) => parsePartd(r.e)).filter((e): e is PartdExposure => e !== null);
  return { state: parse(state), national: parse(national) };
}

async function readPlacesState(usps: string): Promise<PlacesPart> {
  const ds = EXPOSURE_DATASETS.places;
  const [counties, national] = await Promise.all([
    exposureRows(ds, cs({ state: [usps], geo_level: ["county"] }), 400),
    exposureRows(ds, "id=eq.places:US", 1),
  ]);
  return {
    counties: counties.map((r) => parsePlaces(r.e)).filter((c): c is PlacesCounty => c !== null),
    national: parsePlaces(national[0]?.e) ?? null,
  };
}

async function readPfasState(usps: string, withSystems: boolean): Promise<PfasPart> {
  const [states, systems] = await Promise.all([
    restGet<Row[]>(
      `corpus_records?select=id,e:item->exposure&dataset=eq.${EXPOSURE_DATASETS.pfasStates}&id=in.(${encodeURIComponent(`ucmr5:state:${usps},ucmr5:state:US`)})`,
    ).then((r) => r.rows),
    withSystems
      ? restGet<Record<string, unknown>[]>(
          `corpus_records?select=${SYSTEM_SELECT}&dataset=eq.${EXPOSURE_DATASETS.pfasSystems}&${cs({ state: [usps], detected: ["yes"] })}` +
            `&order=item->exposure->analytes_detected.desc,id.asc&limit=${SYSTEM_LIMIT}`,
          { count: true },
        )
      : Promise.resolve({ rows: [] as Record<string, unknown>[], total: 0 }),
  ]);
  const byId = new Map(states.map((r) => [r.id, parseUcmrState(r.e)] as const));
  return {
    state: byId.get(`ucmr5:state:${usps}`) ?? null,
    national: byId.get("ucmr5:state:US") ?? null,
    systems: systems.rows.map(parseUcmrSystem).filter((s): s is UcmrSystem => s !== null),
    systemsTruncated: (systems.total ?? 0) > systems.rows.length,
  };
}

function fail(scope: string) {
  return (e: unknown): never => {
    console.error(`exposureGeo ${scope}`, e);
    throw new Error("Exposure figures could not be read just now.");
  };
}

export const getStateExposure = createServerFn({ method: "GET" })
  .inputValidator((d: { usps: string }) =>
    z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d),
  )
  .handler(async ({ data }): Promise<StateExposure> => {
    const { usps } = data;
    return keyed(`state:${usps}`, async () => {
      const ready = await readReady();
      const [partd, places, pfas] = await Promise.all([
        ready.has("partd") ? readPartdState(usps) : null,
        ready.has("places") ? readPlacesState(usps) : null,
        ready.has("pfasStates") ? readPfasState(usps, ready.has("pfasSystems")) : null,
      ]);
      return {
        usps,
        partd: partd && (partd.state.length || partd.national.length) ? partd : null,
        // a published dataset with no county for this state (CDC published none) stays, so the page can say so
        places: places && (places.counties.length || places.national) ? places : null,
        pfas: pfas && pfas.state ? pfas : null,
        readAt: new Date().toISOString(),
      };
    }).catch(fail(`state ${usps}`));
  });

export const getCountyExposure = createServerFn({ method: "GET" })
  .inputValidator((d: { fips: string }) => z.object({ fips: z.string().regex(/^\d{5}$/) }).parse(d))
  .handler(async ({ data }): Promise<CountyExposure | null> => {
    const { fips } = data;
    return keyed(`county:${fips}`, async () => {
      const ready = await readReady();
      if (!ready.has("places")) return null;
      const own = await exposureRows(EXPOSURE_DATASETS.places, `id=eq.places:${fips}`, 1);
      const county = parsePlaces(own[0]?.e);
      if (!county) return null;
      const part = await readPlacesState(county.usps);
      return {
        fips,
        county,
        peers: part.counties,
        national: part.national,
        readAt: new Date().toISOString(),
      };
    }).catch(fail(`county ${fips}`));
  });

export const getMdlExposure = createServerFn({ method: "GET" })
  .inputValidator((d: { mdl: string }) =>
    z.object({ mdl: z.string().regex(/^[1-9]\d{0,5}$/) }).parse(d),
  )
  .handler(async ({ data }): Promise<MdlExposure | null> => {
    const { mdl } = data;
    return keyed(`mdl:${mdl}`, async () => {
      const ready = await readReady();
      const [partdRows, pfasRows] = await Promise.all([
        ready.has("partd") ? exposureRows(EXPOSURE_DATASETS.partd, cs({ mdl: [mdl] }), 200) : null,
        ready.has("pfasStates") && mdl === PFAS_MDL
          ? exposureRows(EXPOSURE_DATASETS.pfasStates, "id=like.ucmr5:state:*", 200)
          : null,
      ]);
      const partd =
        partdRows?.map((r) => parsePartd(r.e)).filter((e): e is PartdExposure => e !== null) ?? [];
      const pfas =
        pfasRows?.map((r) => parseUcmrState(r.e)).filter((s): s is UcmrState => s !== null) ?? [];
      if (!partd.length && !pfas.length) return null;
      return {
        mdl,
        partd: partd.length ? partd : null,
        pfas: pfas.length ? pfas : null,
        readAt: new Date().toISOString(),
      };
    }).catch(fail(`mdl ${mdl}`));
  });
