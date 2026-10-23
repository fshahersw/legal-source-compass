/** React Query descriptors for the enforcement_extra panels (routes may prefetch them in their loaders). */
import {
  getDistrictProsecutions,
  getDistrictSentencing,
  getExclusionsOverview,
} from "@/lib/external/enforcementExtra.functions";

const STALE = 10 * 60 * 1000;

export const exclusionsOverviewQuery = {
  queryKey: ["exclusions-overview"],
  queryFn: () => getExclusionsOverview(),
  staleTime: STALE,
};

export const districtSentencingQuery = (courtId: string) => ({
  queryKey: ["ussc-district-sentencing", courtId],
  queryFn: () => getDistrictSentencing({ data: { id: courtId } }),
  staleTime: STALE,
});

export const districtProsecutionsQuery = (courtId: string) => ({
  queryKey: ["eousa-district-prosecutions", courtId],
  queryFn: () => getDistrictProsecutions({ data: { id: courtId } }),
  staleTime: STALE,
});
