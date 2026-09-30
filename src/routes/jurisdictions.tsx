import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired page: jurisdictions are a filter in the source library.
export const Route = createFileRoute("/jurisdictions")({
  beforeLoad: () => {
    throw redirect({ to: "/sources/library" });
  },
});
