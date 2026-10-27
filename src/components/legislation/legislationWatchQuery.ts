import { getLegislationWatch } from "@/lib/law/legislationWatch.functions";

export const legislationWatchQuery = {
  queryKey: ["law", "legislation-watch"],
  queryFn: () => getLegislationWatch(),
  staleTime: 60 * 60 * 1000,
};
