/**
 * State, district and cross-state analysis reads (dataset state_cross_analysis, built by
 * scripts/enrichment/state_analysis). Read-only; associations are Spearman correlations with Benjamini-Hochberg control.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import {
  num,
  obj,
  parseCountyNames,
  parseDistrict,
  parseDistributions,
  parseMetrics,
  parseScreened,
  parseStandouts,
  parseTests,
  parseYearSeries,
  str,
  type CountyName,
  type DistrictSummary,
  type Distribution,
  type ScreenedCounty,
  type Standout,
  type Test,
} from "./placeAnalysisParse";

export type StateAnalysis = {
  usps: string;
  name: string;
  counties: number;
  values: Record<string, number | null>;
  us: Record<string, number | null>;
  distributions: Record<string, Distribution>;
  tests: Test[];
  testsRun: number;
  testsHold: number;
  standouts: Standout[];
  fjcFy: Record<string, number>;
  fjcFyRate: Record<string, number>;
  fjcCoreFy: Record<string, number>;
  fjcCoreFyRate: Record<string, number>;
  screened: ScreenedCounty[];
  unassigned: CountyName[];
  districts: DistrictSummary[];
};

export function parseStateAnalysis(
  rows: { id: string; p: unknown }[],
  usps: string,
): StateAnalysis | null {
  const st = rows.find((r) => r.id === `state:${usps}`);
  if (!st) return null;
  const p = obj(st.p);
  return {
    usps,
    name: str(p["name"], 80),
    counties: num(p["counties"]) ?? 0,
    values: parseMetrics(p["values"]),
    us: parseMetrics(p["us"]),
    distributions: parseDistributions(p["distributions"]),
    tests: parseTests(p["tests"]),
    testsRun: num(p["tests_run"]) ?? 0,
    testsHold: num(p["tests_hold"]) ?? 0,
    standouts: parseStandouts(p["standouts"]),
    fjcFy: parseYearSeries(p["fjc_fy"]),
    fjcFyRate: parseYearSeries(p["fjc_fy_rate"]),
    fjcCoreFy: parseYearSeries(p["fjc_core_fy"]),
    fjcCoreFyRate: parseYearSeries(p["fjc_core_fy_rate"]),
    screened: parseScreened(p["screened_counties"]),
    unassigned: parseCountyNames(p["unassigned_counties"], 100),
    districts: rows
      .filter((r) => r.id.startsWith("district:"))
      .flatMap((r) => {
        const d = parseDistrict(r.p);
        return d && d.usps === usps ? [d] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: StateAnalysis | null }>();

/** One state's county associations, stand-out list, filing trend and its federal districts. */
export const getStateAnalysis = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<StateAnalysis | null> => {
    const hit = cache.get(data.usps);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const res = await restGet<{ id: string; p: unknown }[]>(
      `corpus_records?select=id,p:item->profile&dataset=eq.state_cross_analysis&state=eq.${data.usps}&order=id.asc&limit=20`,
    );
    const value = parseStateAnalysis(res.rows, data.usps);
    cache.set(data.usps, { at: Date.now(), value });
    return value;
  });

export type CrossStateAnalysis = {
  tests: Test[];
  testsRun: number;
  testsHold: number;
  states: Record<string, Record<string, number | null>>;
  us: Record<string, number | null>;
  dispersion: Record<
    string,
    { counties: number; hold: number; run: number; distributions: Record<string, Distribution> }
  >;
};

export function parseCrossState(
  overview: unknown,
  stateRows: { st: string; d: unknown; h: unknown; r: unknown; c: unknown }[],
): CrossStateAnalysis | null {
  const p = obj(overview);
  if (!Object.keys(p).length) return null;
  const states: Record<string, Record<string, number | null>> = {};
  for (const [u, v] of Object.entries(obj(p["states"])))
    if (/^[A-Z]{2}$/.test(u)) states[u] = parseMetrics(v);
  const dispersion: CrossStateAnalysis["dispersion"] = {};
  for (const s of stateRows) {
    if (!/^[A-Z]{2}$/.test(s.st)) continue;
    dispersion[s.st] = {
      counties: num(s.c) ?? 0,
      hold: num(s.h) ?? 0,
      run: num(s.r) ?? 0,
      distributions: parseDistributions(s.d),
    };
  }
  return {
    tests: parseTests(p["tests"]),
    testsRun: num(p["tests_run"]) ?? 0,
    testsHold: num(p["tests_hold"]) ?? 0,
    states,
    us: parseMetrics(p["us"]),
    dispersion,
  };
}

let crossCache: { at: number; value: CrossStateAnalysis | null } | null = null;

/** Cross-state associations, every state's legal and demographic values, and each state's county spread. */
export const getCrossStateAnalysis = createServerFn({ method: "GET" }).handler(
  async (): Promise<CrossStateAnalysis | null> => {
    if (crossCache && Date.now() - crossCache.at < CACHE_MS) return crossCache.value;
    const [ov, st] = await Promise.all([
      restGet<{ p: unknown }[]>(
        "corpus_records?select=p:item->profile&dataset=eq.state_cross_analysis&id=eq.overview:cross_state&limit=1",
      ),
      restGet<{ st: string; d: unknown; h: unknown; r: unknown; c: unknown }[]>(
        "corpus_records?select=st:state,d:item->profile->distributions,h:item->profile->tests_hold,r:item->profile->tests_run,c:item->profile->counties&dataset=eq.state_cross_analysis&id=like.state:*&limit=60",
      ),
    ]);
    const value = ov.rows[0] ? parseCrossState(ov.rows[0].p, st.rows) : null;
    crossCache = { at: Date.now(), value };
    return value;
  },
);
