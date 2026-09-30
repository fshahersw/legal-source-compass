import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/laws")({
  beforeLoad: () => {
    throw redirect({ to: "/law", search: { ds: "outline" }, replace: true });
  },
});
