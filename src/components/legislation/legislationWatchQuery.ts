import { getLegislationLanding, getLegislationWatch } from "@/lib/law/legislationWatch.functions";

export const legislationWatchQuery = {
  queryKey: ["law", "legislation-watch"],
  queryFn: () => getLegislationWatch(),
  staleTime: 60 * 60 * 1000,
};

/** The /law landing's legislation KPIs only (three reads instead of the watch's fifteen). */
export const legislationLandingQuery = {
  queryKey: ["law", "legislation-landing"],
  queryFn: () => getLegislationLanding(),
  staleTime: 60 * 60 * 1000,
};
