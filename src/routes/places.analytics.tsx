import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import {
  StateMetricsDashboard,
  stateMetricsQuery,
} from "@/components/states/StateMetricsDashboard";
import {
  parseStateMetricsSearch,
  type StateMetricsSearch,
} from "@/components/states/stateMetricsMath";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/places/analytics")({
  validateSearch: (search: Record<string, unknown>): StateMetricsSearch =>
    parseStateMetricsSearch(search),
  loader: ({ context }) => context.queryClient.prefetchQuery(stateMetricsQuery),
  head: () =>
    pageHead(
      "State analytics",
      "Population, GDP, income, unemployment, overdose and traffic deaths, vehicle complaints and FDA recalls for every state and DC, from Census, BEA, BLS, CDC, NHTSA and openFDA files.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/places/analytics" });
  return (
    <AppShell
      title="State analytics"
      description="Official state-by-state series with per-capita rates, ranks, five-year trends, correlations and outlier flags."
      breadcrumbs={[
        { label: "States & courts", to: "/" },
        { label: "Places", to: "/places" },
        { label: "State analytics" },
      ]}
    >
      <StateMetricsDashboard
        search={search}
        onSearch={(patch) =>
          void navigate({
            search: (prev: StateMetricsSearch) => parseStateMetricsSearch({ ...prev, ...patch }),
            replace: true,
            resetScroll: false,
          })
        }
      />
    </AppShell>
  );
}
