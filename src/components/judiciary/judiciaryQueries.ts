import { getJudgeFjcRecord, getVacanciesOverview } from "@/lib/external/judiciary.functions";

/** Shared by the FJC service panel and the nomination panel, so a judge page fetches the FJC record once. */
export const fjcRecordQuery = (judgeId: string) => ({
  queryKey: ["judiciary-fjc-record", judgeId] as const,
  queryFn: () => getJudgeFjcRecord({ data: { id: judgeId } }),
  staleTime: 10 * 60 * 1000,
});

/** The /courts/vacancies page data; the route loader prefetches it. */
export const vacanciesOverviewQuery = {
  queryKey: ["judiciary-vacancies-overview"] as const,
  queryFn: () => getVacanciesOverview(),
  staleTime: 10 * 60 * 1000,
};
