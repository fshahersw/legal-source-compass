import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { TrendsView } from "@/components/insights/TrendsView";
import type { TrendsSearch } from "@/components/insights/trendsModel";
import { urlChoice, urlEntityType, urlToken } from "@/components/insights/searchParams";
import { pageHead } from "@/lib/corpus/head";

function parseTrendsSearch(input: Record<string, unknown>): TrendsSearch {
  return {
    view: urlChoice(input["view"], ["compare", "national"] as const),
    topic: urlToken(input["topic"], 40),
    type: urlEntityType(input["type"]),
    metric: urlToken(input["metric"]),
    ids: urlToken(input["ids"], 400),
    pc: input["pc"] === "1" || input["pc"] === 1 ? "1" : undefined,
    scale: urlChoice(input["scale"], ["own"] as const),
    us: input["us"] === "0" || input["us"] === 0 ? "0" : undefined,
    chg: input["chg"] === "1" || input["chg"] === 1 ? "1" : undefined,
  };
}

export const Route = createFileRoute("/insights/trends")({
  validateSearch: parseTrendsSearch,
  head: () =>
    pageHead(
      "Trends",
      "Compare up to six states or MDLs on one metric over time, and every national series on the platform by topic: courts, litigation, enforcement, recalls and adverse events, consumer complaints, rulemaking and the judiciary.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/insights/trends" });
  const set = (patch: Partial<TrendsSearch>) =>
    void navigate({
      search: (prev: TrendsSearch) => parseTrendsSearch({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    });
  return (
    <AppShell
      title="Trends"
      description="How metrics change over time: entities compared on one metric, and the national series by topic."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Insights", to: "/insights" },
        { label: "Trends" },
      ]}
    >
      <TrendsView search={search} set={set} />
    </AppShell>
  );
}
