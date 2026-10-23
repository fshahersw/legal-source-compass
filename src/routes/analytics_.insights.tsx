import { createFileRoute, redirect } from "@tanstack/react-router";

/** Insights of the day moved to Insights › Today. */
export const Route = createFileRoute("/analytics_/insights")({
  beforeLoad: () => {
    throw redirect({ to: "/insights/today", replace: true });
  },
});
