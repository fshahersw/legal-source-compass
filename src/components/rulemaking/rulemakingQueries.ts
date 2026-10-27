import { getRulemakingTracker } from "@/lib/law/rulemakingTracker.functions";

export const rulemakingTrackerQuery = {
  queryKey: ["law", "rulemaking-tracker"],
  queryFn: () => getRulemakingTracker(),
  staleTime: 10 * 60 * 1000,
};
