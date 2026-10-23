import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The Analytics overview became the Insights overview (owner decision 2026-10-23, evening). Its trend blocks are tiles
 * on /insights and full charts in Insights › Trends › National series.
 */
export const Route = createFileRoute("/analytics")({
  beforeLoad: () => {
    throw redirect({ to: "/insights", replace: true });
  },
});
