import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired page: the corpussite taxonomy is now the "Category" filter in the source library.
export const Route = createFileRoute("/categories")({
  beforeLoad: () => {
    throw redirect({ to: "/sources/library" });
  },
});
