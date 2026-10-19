/**
 * City and place profiles for one state (dataset city_profiles: Census ACS 2020-2024 places with at least 10,000
 * residents, or the state's 15 most populous). Read-only, bounded.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import {
  num,
  obj,
  parseCountyNames,
  parseMetrics,
  str,
  type CountyName,
} from "./placeAnalysisParse";

export type CityRow = {
  id: string;
  name: string;
  incorporated: boolean;
  landSqmi: number | null;
  density: number | null;
  counties: (CountyName & { share: number | null })[];
  metrics: Record<string, number | null>;
};

export function parseCity(row: { id: string; p: unknown; m: unknown }): CityRow | null {
  if (!/^\d{7}$/.test(row.id)) return null;
  const p = obj(row.p);
  const name = str(p["name"], 120);
  if (!name) return null;
  const shares = new Map(
    (Array.isArray(p["counties"]) ? p["counties"] : [])
      .map(obj)
      .map((c) => [str(c["fips"]), num(c["share"])]),
  );
  return {
    id: row.id,
    name,
    incorporated: p["funcstat"] !== "S",
    landSqmi: num(p["land_sqmi"]),
    density: num(p["density"]),
    counties: parseCountyNames(p["counties"], 12).map((c) => ({
      ...c,
      share: shares.get(c.fips) ?? null,
    })),
    metrics: parseMetrics(row.m),
  };
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: CityRow[] }>();

export const getStateCities = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<CityRow[]> => {
    const hit = cache.get(data.usps);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const res = await restGet<{ id: string; p: unknown; m: unknown }[]>(
      `corpus_records?select=id,p:item->place,m:item->metrics&dataset=eq.city_profiles&state=eq.${data.usps}&order=ordinal.asc&limit=1000`,
    );
    const value = res.rows
      .flatMap((r) => {
        const c = parseCity(r);
        return c ? [c] : [];
      })
      .sort((a, b) => (b.metrics["pop_acs"] ?? 0) - (a.metrics["pop_acs"] ?? 0));
    cache.set(data.usps, { at: Date.now(), value });
    return value;
  });
