import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { RankingsView, type RankingsSearch } from "@/components/insights/RankingsView";
import { urlEntityType, urlToken } from "@/components/insights/searchParams";
import { pageHead } from "@/lib/corpus/head";

function parseRankingsSearch(input: Record<string, unknown>): RankingsSearch {
  return {
    type: urlEntityType(input["type"]),
    metric: urlToken(input["metric"]),
    period: urlToken(input["period"], 20),
    compare: urlToken(input["compare"], 20),
    sel: urlToken(input["sel"], 40),
  };
}

export const Route = createFileRoute("/insights/rankings")({
  validateSearch: parseRankingsSearch,
  head: () =>
    pageHead(
      "Rankings and maps",
      "Rank and map any metric for any period: states and MDLs ranked against the national value and the median, the spread of values, the movers between two periods and every period at a glance.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/insights/rankings" });
  const set = (patch: Partial<RankingsSearch>) =>
    void navigate({
      search: (prev: RankingsSearch) => parseRankingsSearch({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    });
  return (
    <AppShell
      title="Rankings and maps"
      description="Any metric for any period: map, ranks against the national value, spread, movers and history."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Insights", to: "/insights" },
        { label: "Rankings and maps" },
      ]}
    >
      <RankingsView search={search} set={set} />
    </AppShell>
  );
}
