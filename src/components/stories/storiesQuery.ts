import { getDefendantNetwork, getMdlDocket } from "@/lib/external/stories.functions";

export const mdlDocketQuery = {
  queryKey: ["stories", "mdl-docket"] as const,
  queryFn: () => getMdlDocket(),
  staleTime: 10 * 60_000,
};

export const defendantNetworkQuery = {
  queryKey: ["stories", "defendant-network"] as const,
  queryFn: () => getDefendantNetwork(),
  staleTime: 10 * 60_000,
};
