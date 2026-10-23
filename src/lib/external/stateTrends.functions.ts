/**
 * Yearly CFPB complaint and OSHA inspection series for one state's page (datasets cfpb_complaints_states and
 * osha_inspections_states; record keys `cfpb-state:<USPS>` and `osha-state:<USPS>`). Read-only, exact keys; a record that
 * is missing stays missing and a part that fails to load is named in `unavailable`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { num, obj, str } from "./placeAnalysisParse";
import { parseCfpbYears, parseOshaYears, type CfpbYear, type OshaYear } from "./stateTrendsModel";
import { restGet } from "./rest.server";

export type StateTrends = {
  usps: string;
  cfpb: { recordId: string; sourceUrl: string | null; years: CfpbYear[] } | null;
  osha: {
    recordId: string;
    sourceUrl: string | null;
    latestFy: number;
    years: OshaYear[];
    plan: string | null;
    /** Inspections per 100,000 covered jobs for the latest complete fiscal year, with its denominator. */
    rate: { value: number; denominator: string; year: number } | null;
  } | null;
  unavailable: ("cfpb" | "osha")[];
};

const official = (v: unknown): string | null => {
  const s = str(v, 600);
  return /^https?:\/\/[^\s]+$/.test(s) ? s : null;
};

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: StateTrends }>();

export const getStateTrends = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<StateTrends> => {
    const hit = cache.get(data.usps);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const u = data.usps;
    const [cfpb, osha] = await Promise.allSettled([
      restGet<{ id: string; u: unknown; y: unknown }[]>(
        `corpus_records?select=id,u:source_url,y:item->state_profile->years&dataset=eq.cfpb_complaints_states&id=eq.cfpb-state:${u}&limit=1`,
      ),
      restGet<{ id: string; u: unknown; y: unknown; l: unknown; p: unknown; r: unknown }[]>(
        `corpus_records?select=id,u:source_url,y:item->profile->years,l:item->profile->latest_complete_fy,p:item->profile->plan_status,r:item->profile->rate&dataset=eq.osha_inspections_states&id=eq.osha-state:${u}&limit=1`,
      ),
    ]);
    const unavailable: StateTrends["unavailable"] = [];
    if (cfpb.status === "rejected") unavailable.push("cfpb");
    if (osha.status === "rejected") unavailable.push("osha");
    const c = cfpb.status === "fulfilled" ? cfpb.value.rows[0] : undefined;
    const o = osha.status === "fulfilled" ? osha.value.rows[0] : undefined;
    const latestFy = o ? num(o.l) : null;
    const rate = o ? obj(o.r) : {};
    const rateValue = num(rate["inspections_per_100k_covered_jobs"]);
    const cfpbYears = c ? parseCfpbYears(c.y) : [];
    const oshaYears = o && latestFy != null ? parseOshaYears(o.y, latestFy) : [];
    const value: StateTrends = {
      usps: u,
      cfpb:
        c && cfpbYears.length
          ? { recordId: c.id, sourceUrl: official(c.u), years: cfpbYears }
          : null,
      osha:
        o && latestFy != null && oshaYears.length
          ? {
              recordId: o.id,
              sourceUrl: official(o.u),
              latestFy,
              years: oshaYears,
              plan: str(o.p, 120) || null,
              rate:
                rateValue != null &&
                num(rate["denominator_year"]) != null &&
                num(rate["fy"]) === latestFy
                  ? {
                      value: rateValue,
                      denominator: str(rate["denominator"], 160),
                      year: num(rate["denominator_year"])!,
                    }
                  : null,
            }
          : null,
      unavailable,
    };
    if (!unavailable.length) cache.set(u, { at: Date.now(), value });
    return value;
  });
