import {
  getEmergingTortRadar,
  getRadarCandidate,
} from "@/lib/external/emergingTortRadar.functions";

export const radarQuery = {
  queryKey: ["emerging-tort-radar"],
  queryFn: () => getEmergingTortRadar(),
  staleTime: 10 * 60 * 1000,
} as const;

export const radarCandidateQuery = (id: string) => ({
  queryKey: ["emerging-tort-radar", "unit", id],
  queryFn: () => getRadarCandidate({ data: { id } }),
  staleTime: 10 * 60 * 1000,
});
