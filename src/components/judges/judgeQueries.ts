/** Query objects for judge pages; the keys are shared with the existing panels so one read serves both. */
import { getJudgeCrossProfile } from "@/lib/external/judgeCross.functions";
import { getJudgeCourtListener } from "@/lib/external/judgeCourtListener.functions";
import { getCourtBench, getJudgeCjra } from "@/lib/external/judgeCjra.functions";
import { getJudgeExpertRulings } from "@/lib/external/judgeRulings.functions";

const STALE = 10 * 60 * 1000;

export const judgeCrossProfileQuery = (id: string) => ({
  queryKey: ["judge-cross-profile", id] as const,
  queryFn: () => getJudgeCrossProfile({ data: { id } }),
  staleTime: STALE,
});

export const judgeCourtListenerQuery = (id: string) => ({
  queryKey: ["judge-courtlistener", id] as const,
  queryFn: () => getJudgeCourtListener({ data: { id } }),
  staleTime: STALE,
});

export const judgeCjraQuery = (id: string) => ({
  queryKey: ["judge-cjra", id] as const,
  queryFn: () => getJudgeCjra({ data: { id } }),
  staleTime: STALE,
});

export const judgeRulingsQuery = (id: string) => ({
  queryKey: ["judge-expert-rulings", id] as const,
  queryFn: () => getJudgeExpertRulings({ data: { id } }),
  staleTime: STALE,
});

export const courtBenchQuery = (court: string) => ({
  queryKey: ["judge-court-bench", court] as const,
  queryFn: () => getCourtBench({ data: { court } }),
  staleTime: STALE,
});
