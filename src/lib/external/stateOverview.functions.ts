/**
 * Federal district courts of one state for its overview (datasets fjc_civil_districts and judge_cross_districts) and the
 * number of judge profiles in the directory. Read-only, bounded reads; a part that fails to load is named in `unavailable`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { canonicalState } from "@/lib/corpus/stateHub";
import {
  parseDistrict,
  summarizeDistricts,
  type DistrictBase,
  type DistrictBench,
  type DistrictRow,
  type StateFederalSummary,
} from "./stateOverviewModel";
import { restGet, rpcPost } from "./rest.server";

export type StateOverview = {
  usps: string;
  districts: DistrictRow[];
  summary: StateFederalSummary;
  /** Judge profiles (federal and state) in the directory for the state; null when the count could not be read. */
  judgeProfiles: number | null;
  unavailable: ("districts" | "benches" | "judges")[];
};

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: StateOverview }>();

export const getStateOverview = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<StateOverview> => {
    const hit = cache.get(data.usps);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const identity = canonicalState(data.usps);
    const unavailable: StateOverview["unavailable"] = [];
    const judges = identity
      ? rpcPost<{ total: number | null }>("corpus_query_bounded", {
          p_q: null,
          p_dataset: "judges",
          p_filters: { state: identity.name },
          p_limit: 1,
          p_offset: 0,
          p_count_cap: 100000,
        }).then((r) => (typeof r.total === "number" ? r.total : null))
      : Promise.resolve(null);
    let bases: DistrictBase[] = [];
    try {
      bases = (
        await restGet<DistrictBase[]>(
          `corpus_records?select=id,c:item->cells,s:item->profile->series&dataset=eq.fjc_civil_districts&state=eq.${data.usps}&order=id.asc&limit=30`,
        )
      ).rows;
    } catch {
      unavailable.push("districts");
    }
    const ids = bases.map((b) => b.id).filter((id) => /^[a-z]{2,6}$/.test(id));
    let benches: DistrictBench[] = [];
    if (ids.length) {
      try {
        benches = (
          await restGet<DistrictBench[]>(
            `corpus_records?select=id,a:item->district->>active,sn:item->district->>senior,jg:item->district->>judgeships,pm:item->district->>pending_mdls,pa:item->district->>pending_actions,asof:item->district->>as_of,m:item->district->mdls&dataset=eq.judge_cross_districts&id=in.(${ids.join(",")})&limit=30`,
          )
        ).rows;
      } catch {
        unavailable.push("benches");
      }
    }
    const byId = new Map(benches.map((b) => [b.id, b]));
    const districts = bases.flatMap((b) => {
      const row = parseDistrict(b, byId.get(b.id));
      return row ? [row] : [];
    });
    let judgeProfiles: number | null = null;
    try {
      judgeProfiles = await judges;
    } catch {
      unavailable.push("judges");
    }
    const value: StateOverview = {
      usps: data.usps,
      districts,
      summary: summarizeDistricts(districts),
      judgeProfiles,
      unavailable,
    };
    if (!unavailable.length) cache.set(data.usps, { at: Date.now(), value });
    return value;
  });
