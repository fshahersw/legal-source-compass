/** FJC-based profiles for every judge in the FJC biographical directory (dataset judge_profiles_fjc). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

export type FjcService = {
  court: string;
  court_id: string | null;
  title: string;
  president: string;
  party: string;
  aba_rating: string | null;
  nomination: string | null;
  confirmation: string | null;
  vote: string | null;
  commission: string | null;
  chief_begin: string | null;
  chief_end: string | null;
  senior_status: string | null;
  termination: string | null;
  termination_date: string | null;
};
export type FjcProfile = {
  nid: string;
  name: string;
  birth_year: number | null;
  birth_place: string | null;
  services: FjcService[];
  current_court_id: string | null;
  status: string;
  education: { school: string; degree: string | null; year: string | null }[];
  career: string | null;
  other_federal_service: string[];
  years_service: number | null;
  age: number | null;
  mdls: { mdl: number; title: string; pending: number; type: string | null }[];
  court_workload: Record<string, number | null> | null;
  judge_profile_id: string | null;
  cl_person_id: string | null;
};
export type CourtJudge = {
  nid: string;
  name: string;
  status: string;
  president: string;
  party: string;
  commission: string | null;
  mdls: number;
  mdlActions: number;
  profileId: string | null;
};

type Row = { id: string; item: { profile?: FjcProfile } };
const SELECT = "id,item";

export const getJudgeFjcProfile = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(/^[a-z0-9]{8,64}$/) }).parse(d))
  .handler(async ({ data }): Promise<FjcProfile | null> => {
    const filter = encodeURIComponent(JSON.stringify({ judge_profile: [data.id] }));
    const r = await restGet<Row[]>(
      `corpus_records?select=${SELECT}&dataset=eq.judge_profiles_fjc&filters=cs.${filter}&limit=2`,
    );
    // Only a single exact link is shown; an ambiguous link shows nothing.
    return r.rows.length === 1 ? (r.rows[0]!.item.profile ?? null) : null;
  });

export const getCourtJudges = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(/^[a-z0-9_-]{1,40}$/) }).parse(d))
  .handler(async ({ data }): Promise<CourtJudge[]> => {
    const filter = encodeURIComponent(JSON.stringify({ court: [data.id] }));
    const r = await restGet<Row[]>(
      `corpus_records?select=${SELECT}&dataset=eq.judge_profiles_fjc&filters=cs.${filter}&limit=200`,
    );
    return r.rows
      .map(({ item }) => item.profile)
      .filter((p): p is FjcProfile => !!p)
      .map((p) => {
        const current = p.services.filter((s) => !s.termination).at(-1) ?? p.services.at(-1);
        return {
          nid: p.nid,
          name: p.name,
          status: p.status,
          president: current?.president ?? "",
          party: current?.party ?? "",
          commission: current?.commission ?? null,
          mdls: p.mdls.length,
          mdlActions: p.mdls.reduce((sum, m) => sum + m.pending, 0),
          profileId: p.judge_profile_id,
        };
      })
      .sort(
        (a, b) =>
          (a.status === "Senior" ? 1 : 0) - (b.status === "Senior" ? 1 : 0) ||
          (a.commission ?? "").localeCompare(b.commission ?? ""),
      );
  });
