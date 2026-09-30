import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { listCourtDirectory, listJudgeDirectory } from "./directory.functions";
import { makeJudgeMatcher } from "./directoryTree";

export function useCourtDirectory() {
  const fn = useServerFn(listCourtDirectory);
  return useQuery({ queryKey: ["dir", "courts"], queryFn: () => fn(), staleTime: Infinity, gcTime: Infinity });
}

export function useJudgeDirectory(enabled = true) {
  const fn = useServerFn(listJudgeDirectory);
  return useQuery({ queryKey: ["dir", "judges"], queryFn: () => fn(), staleTime: Infinity, gcTime: Infinity, enabled });
}

export function useJudgeMatcher() {
  const q = useJudgeDirectory();
  return useMemo(() => (q.data ? makeJudgeMatcher(q.data) : null), [q.data]);
}
