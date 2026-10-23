import { createFileRoute, redirect } from "@tanstack/react-router";
import { lawsRedirectSearch } from "@/lib/atlas/legacyRoutes";

// Former federal law listing: Law & government › Federal law, with any recognised /law query kept.
export const Route = createFileRoute("/laws")({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: "/law",
      search: lawsRedirectSearch(location.search as Record<string, unknown>),
      replace: true,
    });
  },
});
