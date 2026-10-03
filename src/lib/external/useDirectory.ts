import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { listCourtDirectory, listJudgeDirectory } from "./directory.functions";
import { makeJudgeMatcher } from "./directoryTree";

export function useCourtDirectory() {
  return useQuery({
    queryKey: ["dir", "courts"],
    queryFn: () => listCourtDirectory(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useJudgeDirectory(enabled = true) {
  // Version the compact row shape so a cached scalar-only directory is not reused.
  return useQuery({
    queryKey: ["dir", "judges", "profile-associations-v2"],
    queryFn: () => listJudgeDirectory(),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled,
  });
}

export function useJudgeMatcher() {
  const q = useJudgeDirectory();
  return useMemo(() => (q.data ? makeJudgeMatcher(q.data) : null), [q.data]);
}
