import { getRuleLifecycle } from "@/lib/law/ruleLifecycle.functions";
import { getRulemakingTracker } from "@/lib/law/rulemakingTracker.functions";

export const rulemakingTrackerQuery = {
  queryKey: ["law", "rulemaking-tracker"],
  queryFn: () => getRulemakingTracker(),
  staleTime: 10 * 60 * 1000,
};

export const ruleLifecycleQuery = {
  queryKey: ["law", "rule-lifecycle"],
  queryFn: () => getRuleLifecycle(),
  staleTime: 30 * 60 * 1000,
};
