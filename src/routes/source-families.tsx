import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired page: source families are a filter in the source library.
export const Route = createFileRoute("/source-families")({
  beforeLoad: () => {
    throw redirect({ to: "/sources/library" });
  },
});
