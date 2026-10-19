import { useQuery } from "@tanstack/react-query";
import { getViewerAccess } from "./viewer.functions";

/** Server-verified viewer role; admin-only UI stays hidden while loading or on error. */
export function useViewerAccess() {
  const q = useQuery({
    queryKey: ["viewer-access"],
    queryFn: () => getViewerAccess(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  return {
    admin: q.data?.admin === true,
    signedIn: q.data?.signedIn === true,
    ready: !q.isLoading,
  };
}
