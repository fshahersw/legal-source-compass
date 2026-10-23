import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lookupGovernmentDomains } from "@/lib/external/govDomains.functions";
import type { GovLookupResult } from "@/lib/external/govDomainsModel";

const MAX_LOOKUPS = 60;

/**
 * Registry evidence for a list of source addresses: which of them are registered or listed government domains, from the
 * CISA .gov registry and the GSA list. Asks once for the distinct addresses (at most 60); a failed or slow lookup simply
 * leaves the addresses without a label. The map is keyed by the address as given.
 */
export function useGovEvidence(
  urls: readonly string[],
  enabled = true,
): ReadonlyMap<string, GovLookupResult> {
  const inputs = useMemo(
    () => [...new Set(urls.filter(Boolean))].sort().slice(0, MAX_LOOKUPS),
    [urls],
  );
  const lookup = useServerFn(lookupGovernmentDomains);
  const q = useQuery({
    queryKey: ["gov-evidence", inputs.join("|")],
    enabled: enabled && inputs.length > 0,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => (await lookup({ data: { inputs } })).results,
  });
  return useMemo(() => new Map((q.data ?? []).map((r) => [r.input, r] as const)), [q.data]);
}
