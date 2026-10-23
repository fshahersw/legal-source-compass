import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { ExploreWorkbench, type ExploreSearch } from "@/components/insights/ExploreWorkbench";
import { urlChoice, urlEntityType, urlToken } from "@/components/insights/searchParams";
import { pageHead } from "@/lib/corpus/head";

function parseExploreSearch(input: Record<string, unknown>): ExploreSearch {
  return {
    type: urlEntityType(input["type"]),
    x: urlToken(input["x"]),
    y: urlToken(input["y"]),
    px: urlToken(input["px"], 20),
    py: urlToken(input["py"], 20),
    log: urlChoice(input["log"], ["x", "y", "xy"] as const),
    sel: urlToken(input["sel"], 40),
  };
}

export const Route = createFileRoute("/insights/explore")({
  validateSearch: parseExploreSearch,
  head: () =>
    pageHead(
      "Explore",
      "Compare any two metrics across states or MDLs: scatter with the fitted line, Pearson and Spearman coefficients with confidence intervals and p-values, distances from the line, a screen against every metric and multiple-comparison control.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/insights/explore" });
  const set = (patch: Partial<ExploreSearch>) =>
    void navigate({
      search: (prev: ExploreSearch) => parseExploreSearch({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    });
  return (
    <AppShell
      title="Explore"
      description="Two metrics side by side across states or MDLs, with the statistics to read them honestly."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Insights", to: "/insights" },
        { label: "Explore" },
      ]}
    >
      <ExploreWorkbench search={search} set={set} />
    </AppShell>
  );
}
