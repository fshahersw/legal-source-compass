/**
 * Yearly enforcement and complaint series for a state page: CFPB consumer-finance complaints (cfpb_complaints_states,
 * complete calendar years with the per-100,000 rate and the population the dataset used) and OSHA inspections
 * (osha_inspections_states, complete federal fiscal years). Stored JSON is untrusted: malformed entries are dropped,
 * a year in progress is never drawn, and a missing value stays missing (never zero).
 */
import { num, obj, str } from "./placeAnalysisParse";

export type CfpbYear = {
  year: number;
  complaints: number;
  per100k: number | null;
  population: number | null;
  vintage: string | null;
};

const nonNeg = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
};

/** Complete calendar years of CFPB complaints, oldest first. A year the dataset flags as incomplete is dropped. */
export function parseCfpbYears(raw: unknown): CfpbYear[] {
  if (!Array.isArray(raw)) return [];
  const out: CfpbYear[] = [];
  for (const e of raw) {
    const r = obj(e);
    const year = Number(str(r["year"], 4));
    const complaints = nonNeg(r["complaints"]);
    if (
      !Number.isInteger(year) ||
      year < 1990 ||
      year > 2100 ||
      complaints == null ||
      r["complete"] !== true
    )
      continue;
    out.push({
      year,
      complaints,
      per100k: nonNeg(r["per_100k"]),
      population: nonNeg(r["population"]),
      vintage: str(r["population_vintage"], 40) || null,
    });
  }
  return out.sort((a, b) => a.year - b.year);
}

export type OshaYear = {
  fy: number;
  inspections: number;
  federal: number | null;
  statePlan: number | null;
};

/** OSHA inspections by federal fiscal year up to the latest complete year, oldest first, at most the last `max` years. */
export function parseOshaYears(raw: unknown, latestCompleteFy: unknown, max = 15): OshaYear[] {
  const last = num(latestCompleteFy);
  if (!Array.isArray(raw) || last == null) return [];
  const out: OshaYear[] = [];
  for (const e of raw) {
    const r = obj(e);
    const fy = num(r["fy"]);
    const inspections = nonNeg(r["inspections"]);
    if (fy == null || !Number.isInteger(fy) || fy > last || inspections == null) continue;
    out.push({
      fy,
      inspections,
      federal: nonNeg(r["federal"]),
      statePlan: nonNeg(r["state_plan"]),
    });
  }
  return out.sort((a, b) => a.fy - b.fy).slice(-max);
}
