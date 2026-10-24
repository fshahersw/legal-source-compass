/**
 * Whether AI is configured on this server (one cheap probe, shared by every AI entry on the page). "unknown" while the
 * probe runs or if it fails: the entries stay usable and the call itself reports the state.
 */
import { useQuery } from "@tanstack/react-query";
import { getAiStatus } from "@/lib/assistant/summarize.functions";

export type AiStatus = "unknown" | "configured" | "unconfigured";

export const aiStatusQuery = {
  queryKey: ["ai-status"],
  queryFn: () => getAiStatus(),
  staleTime: 10 * 60 * 1000,
  retry: false,
} as const;

export function useAiStatus(): AiStatus {
  const q = useQuery(aiStatusQuery);
  if (!q.data) return "unknown";
  return q.data.configured ? "configured" : "unconfigured";
}
