/**
 * Reads behind the outreach profile and the occupational-exposure screen on /places/$state (datasets
 * census_acs_states, census_acs_counties, census_cbp_counties). Read-only, bounded by state, selecting only the JSON
 * paths the views need; memoized per state for 10 minutes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "@/lib/external/rest.server";
import { currentCounties, parseCbp, parseLatest, type CountyAcs, type CountyCbp, type Share } from "./stateProfileModel";

export const CBP_YEAR = "2023";

export type StatePeople = {
  usps: string;
  state: { year: number | null; pop: number | null; shares: Partial<Record<string, Share>> } | null;
  counties: CountyAcs[];
  cbp: CountyCbp[];
};

const TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: StatePeople }>();

export const getStatePeople = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<StatePeople> => {
    const hit = cache.get(data.usps);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const [st, co, cbp] = await Promise.all([
      restGet<{ l: unknown }[]>(
        `corpus_records?select=l:item->census->latest&dataset=eq.census_acs_states&state=eq.${data.usps}&limit=1`,
      ),
      restGet<{ id: string; n: unknown; l: unknown }[]>(
        `corpus_records?select=id,n:item->census->>name,l:item->census->latest&dataset=eq.census_acs_counties&state=eq.${data.usps}&order=id.asc&limit=400`,
      ),
      restGet<{ id: string; n: unknown; s: unknown }[]>(
        `corpus_records?select=id,n:item->census->>name,s:item->census->series&dataset=eq.census_cbp_counties&state=eq.${data.usps}&order=id.asc&limit=400`,
      ),
    ]).catch((e: unknown) => {
      console.error("state people", e);
      throw new Error("The Census tables could not be read just now.");
    });
    const value: StatePeople = {
      usps: data.usps,
      state: st.rows[0] ? parseLatest(st.rows[0].l) : null,
      counties: currentCounties(
        co.rows
          .filter((r) => /^\d{5}$/.test(r.id))
          .map((r) => ({ fips: r.id, name: typeof r.n === "string" ? r.n.slice(0, 120) : r.id, ...parseLatest(r.l) })),
      ),
      cbp: cbp.rows
        .filter((r) => /^\d{5}$/.test(r.id))
        .map((r) => parseCbp(r.id, typeof r.n === "string" ? r.n.slice(0, 120) : r.id, r.s, CBP_YEAR)),
    };
    cache.set(data.usps, { at: Date.now(), value });
    return value;
  });
