import { getJudgeCrossAnalytics } from "@/lib/external/judgeCross.functions";

export const judgeCrossQuery = {
  queryKey: ["judge-cross-analytics"],
  queryFn: () => getJudgeCrossAnalytics(),
  staleTime: 10 * 60 * 1000,
};
