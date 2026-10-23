import { createFileRoute, redirect } from "@tanstack/react-router";

/** Safety trends now sit in Insights › Trends › National series, Products and safety topic. */
export const Route = createFileRoute("/analytics_/safety")({
  beforeLoad: () => {
    throw redirect({
      to: "/insights/trends",
      search: { view: "national", topic: "safety" },
      replace: true,
    });
  },
});
