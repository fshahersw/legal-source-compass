import { getLimitationsLegislativeWatch } from "@/lib/limitations/legislativeWatch.functions";

export const legislativeWatchQuery = {
  queryKey: ["limitations-legislative-watch-1"],
  queryFn: () => getLimitationsLegislativeWatch(),
  staleTime: 10 * 60 * 1000,
} as const;
