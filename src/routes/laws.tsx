import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/laws")({
  beforeLoad: () => {
    throw redirect({ to: "/law", search: { scope: "federal" }, replace: true });
  },
});
