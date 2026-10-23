import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getStateGovDomains } from "@/lib/external/govDomains.functions";

/** The state's registered government domains; the state section and the county section share this one cached read. */
export function useGovStateQuery(usps: string, enabled: boolean) {
  const fn = useServerFn(getStateGovDomains);
  return useQuery({
    queryKey: ["gov-domains-state", usps],
    queryFn: () => fn({ data: { usps } }),
    enabled,
    staleTime: 10 * 60_000,
  });
}
