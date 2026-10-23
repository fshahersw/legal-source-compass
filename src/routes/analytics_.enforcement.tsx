import { createFileRoute, redirect } from "@tanstack/react-router";

/** Enforcement trends now sit in Insights › Trends › National series, Enforcement topic. */
export const Route = createFileRoute("/analytics_/enforcement")({
  beforeLoad: () => {
    throw redirect({
      to: "/insights/trends",
      search: { view: "national", topic: "enforcement" },
      replace: true,
    });
  },
});
