import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/mdls")({
  beforeLoad: () => {
    throw redirect({ to: "/matters", search: { ds: "mdls" }, replace: true });
  },
});
