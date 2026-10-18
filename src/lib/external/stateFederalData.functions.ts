/**
 * Headline figures from the published federal enrichment datasets for one state's page: CFPB consumer complaints
 * (cfpb_complaints_states), EPA ECHO enforcement cases (epa_echo_case_series) and ECHO-regulated facilities
 * (epa_echo_state_programs). Keys are exact (`cfpb-state:<USPS>`, `epa-echo-series:state:<USPS>:all`,
 * `epa-echo-programs:<USPS>`); a missing row stays missing, never filled from another state.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);

export type StateFederalData = {
  cfpb: {
    recordId: string;
    complaints: number;
    per100k2025: number | null;
    /** Rank among the 50 states and DC by complaints per 100,000 residents in 2025 (1 = highest). */
    rank: number | null;
    rateChangePct: number | null;
  } | null;
  epa: {
    recordId: string;
    opened: number;
    concluded: number;
    fedPenalty: number;
  } | null;
  facilities: {
    recordId: string;
    facilities: number;
    formal5y: number;
    sncNow: number;
  } | null;
};

export function parseStateFederalData(
  usps: string,
  input: { cfpb: unknown; ranking: unknown; epa: unknown; programs: unknown },
): StateFederalData {
  const cfpb = obj(input.cfpb);
  const complaints = num(cfpb?.["complaints"]);
  const ranked = arr(obj(input.ranking)?.["per_100k_2025"]).find((r) => obj(r)?.["code"] === usps);
  const epa = obj(input.epa);
  const opened = num(epa?.["opened"]);
  const concluded = num(epa?.["concluded"]);
  const fed = num(epa?.["fed_penalty"]);
  const programs = obj(input.programs);
  const facilities = num(programs?.["facilities"]);
  const formal = num(programs?.["formal_5y"]);
  const snc = num(programs?.["snc_now"]);
  return {
    cfpb:
      cfpb && complaints != null
        ? {
            recordId: `cfpb-state:${usps}`,
            complaints,
            per100k2025: num(cfpb["per_100k_2025"]),
            rank: num(obj(ranked)?.["rank"]),
            rateChangePct: num(cfpb["rate_change_pct"]),
          }
        : null,
    epa:
      epa && opened != null && concluded != null && fed != null
        ? { recordId: `epa-echo-series:state:${usps}:all`, opened, concluded, fedPenalty: fed }
        : null,
    facilities:
      programs && facilities != null && formal != null && snc != null
        ? { recordId: `epa-echo-programs:${usps}`, facilities, formal5y: formal, sncNow: snc }
        : null,
  };
}

export const getStateFederalData = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<StateFederalData> => {
    const u = data.usps;
    const read = (dataset: string, id: string) =>
      restGet<{ c: unknown }[]>(
        `corpus_records?select=c:item->cells&dataset=eq.${dataset}&id=eq.${encodeURIComponent(id)}&limit=1`,
      );
    const [cfpb, ranking, epa, programs] = await Promise.all([
      read("cfpb_complaints_states", `cfpb-state:${u}`),
      restGet<{ r: unknown }[]>(
        "corpus_records?select=r:item->rankings&dataset=eq.cfpb_complaints_states&id=eq.cfpb-states:analytics&limit=1",
      ),
      read("epa_echo_case_series", `epa-echo-series:state:${u}:all`),
      read("epa_echo_state_programs", `epa-echo-programs:${u}`),
    ]);
    return parseStateFederalData(u, {
      cfpb: cfpb.rows[0]?.c,
      ranking: ranking.rows[0]?.r,
      epa: epa.rows[0]?.c,
      programs: programs.rows[0]?.c,
    });
  });
