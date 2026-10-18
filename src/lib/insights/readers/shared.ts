/**
 * Reads used by more than one section (CFPB aggregates, EPA ECHO profiles). Each read selects only the JSON
 * paths the generators need, parses with the same validators the analytics pages use, and returns null when
 * the dataset is empty or unreadable as published, so a missing dataset produces zero candidates, never an error.
 * Server-only (restGet reads the corpus with the service credentials).
 */
import { restGet } from "@/lib/external/rest.server";
import {
  parseConsumerComplaints,
  type ConsumerComplaints,
} from "@/lib/external/consumerComplaints.functions";
import { parseProfile, type EpaProfile } from "@/lib/external/enforcement.functions";
import { memoAsync, READ_TTL_MS } from "./cache";

export const readCfpb = memoAsync<ConsumerComplaints | null>(READ_TTL_MS, async () => {
  const [national, states, ranking, companies] = await Promise.all([
    restGet<{ n: unknown }[]>(
      "corpus_records?select=n:item->national&dataset=eq.cfpb_complaints_national&id=eq.cfpb-national:all&limit=1",
    ),
    restGet<{ code: unknown; cells: unknown }[]>(
      "corpus_records?select=code:state,cells:item->cells&dataset=eq.cfpb_complaints_states&id=like.cfpb-state:*&order=ordinal.asc&limit=100",
    ),
    restGet<{ r: unknown }[]>(
      "corpus_records?select=r:item->rankings&dataset=eq.cfpb_complaints_states&id=eq.cfpb-states:analytics&limit=1",
    ),
    restGet<{ cells: unknown }[]>(
      "corpus_records?select=cells:item->cells&dataset=eq.cfpb_complaints_companies&id=like.cfpb-company:*&order=ordinal.asc&limit=25",
    ),
  ]);
  return parseConsumerComplaints({
    national: national.rows[0]?.n,
    states: states.rows,
    stateRankings: ranking.rows[0]?.r,
    companies: companies.rows,
    reports: [],
    reportCount: 0,
  });
});

export type EpaRead = {
  fileDate: string | null;
  national: EpaProfile;
  states: {
    code: string;
    name: string;
    population: number | null;
    populationYear: number | null;
    years: { fy: number; cases: number }[];
  }[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export const readEpa = memoAsync<EpaRead | null>(READ_TTL_MS, async () => {
  const [nat, states, catalog] = await Promise.all([
    restGet<{ id: string; p: unknown }[]>(
      "corpus_records?select=id,p:item->profile&dataset=eq.regulatory_epa_state_profiles&id=eq.epa-profile:US&limit=1",
    ),
    restGet<
      {
        id: string;
        kind: unknown;
        code: unknown;
        name: unknown;
        pop: unknown;
        years: unknown;
      }[]
    >(
      "corpus_records?select=id,kind:item->profile->>kind,code:item->profile->>code,name:item->profile->>name,pop:item->profile->population,years:item->profile->years&dataset=eq.regulatory_epa_state_profiles&id=neq.epa-profile:US&order=ordinal.asc&limit=200",
    ),
    restGet<{ metadata: { summary?: { file_date?: unknown } } | null }[]>(
      "corpus_datasets?select=metadata&id=eq.regulatory_epa_state_profiles&limit=1",
    ),
  ]);
  const national = nat.rows[0] ? parseProfile(nat.rows[0].id, nat.rows[0].p) : null;
  if (!national || national.kind !== "national") return null;
  const fileDate = catalog.rows[0]?.metadata?.summary?.file_date;
  return {
    fileDate: typeof fileDate === "string" ? fileDate : null,
    national,
    states: states.rows.flatMap((r) => {
      if (r.kind !== "state" || typeof r.code !== "string" || !/^[A-Z]{2}$/.test(r.code)) return [];
      const pop = obj(r.pop);
      const years = (Array.isArray(r.years) ? r.years : []).flatMap((y) => {
        const o = obj(y);
        const fy = num(o?.["fy"]);
        const cases = num(o?.["cases"]);
        return fy != null && cases != null ? [{ fy, cases }] : [];
      });
      return [
        {
          code: r.code,
          name: typeof r.name === "string" && r.name ? r.name : r.code,
          population: num(pop?.["value"]),
          populationYear: num(pop?.["year"]),
          years,
        },
      ];
    }),
  };
});
