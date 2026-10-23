import { getAnalyticsBlock } from "@/lib/analytics/overview.functions";

/** One block of the Analytics overview, fetched on its own so a slow or failing source never holds back the others. */
export const analyticsBlockQuery = (id: string) => ({
  queryKey: ["analytics-block", id] as const,
  queryFn: () => getAnalyticsBlock({ data: { id } }),
  staleTime: 10 * 60 * 1000,
  retry: 1,
});
