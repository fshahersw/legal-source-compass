import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired page: endpoint candidates are a view of the source library.
export const Route = createFileRoute("/endpoint-explorer")({
  beforeLoad: () => {
    throw redirect({ to: "/sources/library", search: { view: "endpoints" } });
  },
});
