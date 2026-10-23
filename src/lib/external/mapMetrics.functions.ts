/**
 * Map data: every state's value for each home-map metric, and the county layer for the metrics that have county data.
 * Read-only, bounded PostgREST reads of already published datasets (census_pop_estimates, census_acs_states,
 * census_acs_counties, fjc_civil_states, judge_cross_districts, cfpb_complaints_states, osha_inspections_states,
 * epa_echo_state_programs, county_legal_activity). A source that fails to load is named in `unavailable`; the other metrics
 * are still returned. See mapMetricsModel.ts for what each metric counts and the denominator behind every rate.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  buildStateMapMetrics,
  parseCountyValues,
  type CountyLayerPayload,
  type StateMapInputs,
  type StateMapPayload,
} from "./mapMetricsModel";
import { num } from "./placeAnalysisParse";
import { restGet } from "./rest.server";

const CACHE_MS = 10 * 60 * 1000;
let stateCache: { at: number; value: StateMapPayload } | null = null;
const layerCache = new Map<string, { at: number; value: CountyLayerPayload }>();

const rows = <T>(path: string) => restGet<T[]>(path).then((r) => r.rows);

export const getStateMapMetrics = createServerFn({ method: "GET" }).handler(
  async (): Promise<StateMapPayload> => {
    if (stateCache && Date.now() - stateCache.at < CACHE_MS) return stateCache.value;
    const reads = {
      pep: rows<StateMapInputs["pep"][number]>(
        "corpus_records?select=id,l:item->census->latest&dataset=eq.census_pop_estimates&item->census->>level=eq.state&limit=100",
      ),
      acs: rows<StateMapInputs["acs"][number]>(
        "corpus_records?select=id,l:item->census->latest&dataset=eq.census_acs_states&item->census->>level=eq.state&limit=100",
      ),
      fjc: rows<StateMapInputs["fjc"][number]>(
        "corpus_records?select=id,c:item->cells,fy:item->profile->>latest_fy&dataset=eq.fjc_civil_states&limit=100",
      ),
      districts: rows<StateMapInputs["districts"][number]>(
        "corpus_records?select=s:item->district->>state,a:item->district->>active,pa:item->district->>pending_actions,asof:item->district->>as_of&dataset=eq.judge_cross_districts&limit=200",
      ),
      cfpb: rows<StateMapInputs["cfpb"][number]>(
        "corpus_records?select=id,y:item->state_profile->years&dataset=eq.cfpb_complaints_states&id=like.cfpb-state:*&limit=100",
      ),
      osha: rows<StateMapInputs["osha"][number]>(
        "corpus_records?select=id,c:item->cells,r:item->profile->rate&dataset=eq.osha_inspections_states&id=like.osha-state:*&limit=100",
      ),
      echo: rows<StateMapInputs["echo"][number]>(
        "corpus_records?select=id,c:item->cells&dataset=eq.epa_echo_state_programs&id=like.epa-echo-programs:*&limit=100",
      ),
    };
    const names = Object.keys(reads) as (keyof typeof reads)[];
    const settled = await Promise.allSettled(names.map((n) => reads[n]));
    const input: StateMapInputs = {
      pep: [],
      acs: [],
      fjc: [],
      districts: [],
      cfpb: [],
      osha: [],
      echo: [],
    };
    const unavailable: string[] = [];
    settled.forEach((r, i) => {
      const name = names[i]!;
      if (r.status === "fulfilled") (input[name] as unknown[]) = r.value;
      else unavailable.push(name);
    });
    const value: StateMapPayload = { metrics: buildStateMapMetrics(input), unavailable };
    if (!unavailable.length) stateCache = { at: Date.now(), value };
    return value;
  },
);

/** Read every row of a query in pages of 1,000 (the PostgREST page size), in parallel after the first page. */
async function readAll<T>(path: string, maxPages = 6): Promise<T[]> {
  const first = await restGet<T[]>(path, { range: [0, 999] });
  if (first.rows.length < 1000) return first.rows;
  const rest = await Promise.all(
    Array.from({ length: maxPages - 1 }, (_, i) =>
      restGet<T[]>(path, { range: [(i + 1) * 1000, (i + 1) * 1000 + 999] }),
    ),
  );
  return [first.rows, ...rest.map((r) => r.rows)].flat();
}

const LEGAL_LAYERS: Record<string, { label: string; source: string }> = {
  fjc_core_rate: {
    label: "yearly mean FY2021-FY2025",
    source:
      "FJC Integrated Database civil cases by plaintiff's county of residence (core filings), with Census county population estimates",
  },
  cfpb_rate: {
    label: "yearly mean 2021-2025",
    source:
      "CFPB Consumer Complaint Database by consumer ZIP placed in a county, with Census county population estimates",
  },
  osha_rate: {
    label: "yearly mean FY2021-FY2025",
    source:
      "OSHA inspection data by site ZIP placed in a county, with Census county population estimates",
  },
};

export const getCountyMapLayer = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        layer: z.string().regex(/^(pop|fjc_core_rate|cfpb_rate|osha_rate|acs:[a-z0-9_]{1,40})$/),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<CountyLayerPayload> => {
    const hit = layerCache.get(data.layer);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    let value: CountyLayerPayload;
    if (data.layer === "pop") {
      const r = await readAll<{ id: string; v: unknown; y: unknown }>(
        "corpus_records?select=id,v:item->census->latest->>value,y:item->census->latest->>year&dataset=eq.census_pop_estimates&item->census->>level=eq.county&order=id.asc",
      );
      const year = num(Number(r.find((x) => x.y != null)?.y));
      value = {
        key: data.layer,
        yearLabel: year ? `July 1, ${year}` : "latest",
        values: parseCountyValues(r),
        sourceName: "Census Bureau Population Estimates (vintage 2025)",
        sourceUrl: "https://www.census.gov/programs-surveys/popest.html",
      };
    } else if (data.layer.startsWith("acs:")) {
      const key = data.layer.slice(4);
      const r = await readAll<{ id: string; v: unknown; y: unknown }>(
        `corpus_records?select=id,v:item->census->latest->${key}->>0,y:item->census->latest->${key}->>2&dataset=eq.census_acs_counties&order=id.asc`,
      );
      const years = r.map((x) => num(Number(x.y))).filter((y): y is number => y != null);
      const year = years.length ? Math.max(...years) : null;
      value = {
        key: data.layer,
        yearLabel: year ? `${year - 4}–${year}` : "latest",
        values: parseCountyValues(r.filter((x) => num(Number(x.y)) === year)),
        sourceName: "Census Bureau American Community Survey 5-year estimates",
        sourceUrl: "https://www.census.gov/data/developers/data-sets/acs-5year.html",
      };
    } else {
      const def = LEGAL_LAYERS[data.layer]!;
      const r = await readAll<{ id: string; v: unknown }>(
        `corpus_records?select=id,v:item->metrics->>${data.layer}&dataset=eq.county_legal_activity&order=id.asc`,
      );
      value = {
        key: data.layer,
        yearLabel: def.label,
        values: parseCountyValues(r),
        sourceName: def.source,
        sourceUrl: "https://www.fjc.gov/research/idb",
      };
    }
    layerCache.set(data.layer, { at: Date.now(), value });
    return value;
  });
