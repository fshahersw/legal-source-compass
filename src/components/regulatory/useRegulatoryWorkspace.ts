import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  loadLocalRegulatoryWorkspace,
  subscribeLocalRegulatoryWorkspace,
} from "@/lib/regulatory/localWorkspace";

const workspaceKey = ["regulatory-browser-workspace"];
export function useRegulatoryWorkspace() {
  const client = useQueryClient();
  const work = useQuery({
    queryKey: workspaceKey,
    queryFn: () => loadLocalRegulatoryWorkspace(),
    enabled: typeof window !== "undefined",
    staleTime: 0,
    retry: false,
  });
  useEffect(
    () =>
      subscribeLocalRegulatoryWorkspace(() => {
        void client.invalidateQueries({ queryKey: workspaceKey });
      }),
    [client],
  );
  const data = work.isError ? null : (work.data ?? null);
  return { work, data, canWrite: !!data };
}
export type RegulatoryWorkspaceState = ReturnType<typeof useRegulatoryWorkspace>;
