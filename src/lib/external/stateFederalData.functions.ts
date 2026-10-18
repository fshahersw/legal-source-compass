/**
 * Headline figures from the published federal enrichment datasets for one state's page: CFPB consumer complaints
 * (cfpb_complaints_states), EPA ECHO enforcement cases (epa_echo_case_series) and ECHO-regulated facilities
 * (epa_echo_state_programs), OSHA inspections (osha_inspections_states) and NPDB malpractice payment reports
 * (npdb_malpractice_states). Keys are exact (`cfpb-state:<USPS>`, `epa-echo-series:state:<USPS>:all`,
 * `epa-echo-programs:<USPS>`, `osha-state:<USPS>`, `npdb-mmpr:<USPS>:all`); a missing row stays missing, never
 * filled from another state.
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
  /** OSHA inspections for the latest complete fiscal year (federal OSHA and State Plan offices combined). */
  osha: {
    recordId: string;
    fy: number;
    inspections: number;
    /** Computed sum of recorded current penalties; null when the row does not state it. */
    currentPenalty: number | null;
    plan: string | null;
  } | null;
  /** NPDB medical malpractice payment reports, all years 1990 onward (aggregate only). */
  npdb: {
    recordId: string;
    reports: number;
    totalPaid: number | null;
    medianPayment: number | null;
    perMillion: number | null;
  } | null;
};

export function parseStateFederalData(
  usps: string,
  input: {
    cfpb: unknown;
    ranking: unknown;
    epa: unknown;
    programs: unknown;
    osha?: unknown;
    npdb?: unknown;
  },
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
  const osha = obj(input.osha);
  const oshaFy = num(osha?.["fy"]);
  const oshaInspections = num(osha?.["inspections"]);
  const npdb = obj(input.npdb);
  const npdbReports = num(npdb?.["reports"]);
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
    osha:
      osha && oshaFy != null && oshaInspections != null
        ? {
            recordId: `osha-state:${usps}`,
            fy: oshaFy,
            inspections: oshaInspections,
            currentPenalty: num(osha["current_penalty"]),
            plan: typeof osha["plan"] === "string" ? osha["plan"] : null,
          }
        : null,
    npdb:
      npdb && npdbReports != null
        ? {
            recordId: `npdb-mmpr:${usps}:all`,
            reports: npdbReports,
            totalPaid: num(npdb["total_paid"]),
            medianPayment: num(npdb["median_payment"]),
            perMillion: num(npdb["per_million"]),
          }
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
    const [cfpb, ranking, epa, programs, osha, npdb] = await Promise.all([
      read("cfpb_complaints_states", `cfpb-state:${u}`),
      restGet<{ r: unknown }[]>(
        "corpus_records?select=r:item->rankings&dataset=eq.cfpb_complaints_states&id=eq.cfpb-states:analytics&limit=1",
      ),
      read("epa_echo_case_series", `epa-echo-series:state:${u}:all`),
      read("epa_echo_state_programs", `epa-echo-programs:${u}`),
      read("osha_inspections_states", `osha-state:${u}`),
      read("npdb_malpractice_states", `npdb-mmpr:${u}:all`),
    ]);
    return parseStateFederalData(u, {
      cfpb: cfpb.rows[0]?.c,
      ranking: ranking.rows[0]?.r,
      epa: epa.rows[0]?.c,
      programs: programs.rows[0]?.c,
      osha: osha.rows[0]?.c,
      npdb: npdb.rows[0]?.c,
    });
  });
