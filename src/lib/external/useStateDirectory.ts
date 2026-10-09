import { useQuery } from "@tanstack/react-query";
import { canonicalState } from "@/lib/corpus/stateHub";
import { listStateCourtDirectory, listStateJudgeDirectory } from "./stateDirectory.functions";
export function useStateCourtDirectory(state: string, enabled = true) {
  const code = canonicalState(state)?.usps;
  return useQuery({
    queryKey: ["state-directory", "courts", code],
    queryFn: () => listStateCourtDirectory(code!),
    enabled: enabled && !!code,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
export function useStateJudgeDirectory(state: string, enabled = true) {
  const code = canonicalState(state)?.usps;
  return useQuery({
    queryKey: ["state-directory", "judges", code],
    queryFn: () => listStateJudgeDirectory(code!),
    enabled: enabled && !!code,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
