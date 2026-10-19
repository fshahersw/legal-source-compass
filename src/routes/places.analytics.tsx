import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BarChart3, Gavel } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { DailyInsightCard } from "@/components/insights/DailyInsightCard";
import { CrossStateLegalView } from "@/components/places/CrossStateLegalView";
import {
  StateMetricsDashboard,
  stateMetricsQuery,
} from "@/components/states/StateMetricsDashboard";
import {
  parseStateMetricsSearch,
  type StateMetricsPatch,
  type StateMetricsSearch,
} from "@/components/states/stateMetricsMath";
import { pageHead } from "@/lib/corpus/head";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/places/analytics")({
  validateSearch: (search: Record<string, unknown>): StateMetricsSearch =>
    parseStateMetricsSearch(search),
  loaderDeps: ({ search }) => ({ view: search.view }),
  loader: ({ context, deps }) =>
    deps.view === "legal" ? undefined : context.queryClient.prefetchQuery(stateMetricsQuery),
  head: () =>
    pageHead(
      "State analytics",
      "Population, GDP, income, unemployment, overdose and traffic deaths, vehicle complaints and FDA recalls for every state and DC, with federal civil filings, OSHA inspections, CFPB complaints and EPA enforcement beside demographics.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/places/analytics" });
  const legal = search.view === "legal";
  const set = (patch: StateMetricsPatch) =>
    void navigate({
      search: (prev: StateMetricsSearch) => parseStateMetricsSearch({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    });
  return (
    <AppShell
      title="State analytics"
      description={
        legal
          ? "Federal civil filings, OSHA inspections, CFPB complaints and EPA enforcement by state, beside demographics, with associations and the spread between counties."
          : "Official state-by-state series with per-capita rates, ranks, five-year trends, correlations and outlier flags."
      }
      breadcrumbs={[
        { label: "States & courts", to: "/" },
        { label: "Places", to: "/places" },
        { label: "State analytics" },
      ]}
    >
      <div
        role="tablist"
        aria-label="State analytics views"
        className="mb-3 flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1"
      >
        {(
          [
            { id: undefined, label: "Official state metrics", icon: BarChart3 },
            { id: "legal", label: "Legal activity and demographics", icon: Gavel },
          ] as const
        ).map(({ id, label, icon: Icon }) => {
          const active = (id === "legal") === legal;
          return (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => set({ view: id, measure: undefined })}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
                active
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>
      {legal ? (
        <CrossStateLegalView
          measure={search.measure}
          selected={search.state ?? null}
          onMeasure={(m) => set({ measure: m })}
          onState={(u) => set({ state: search.state === u ? undefined : u })}
        />
      ) : (
        <>
          <DailyInsightCard section="state" className="mb-3" />
          <StateMetricsDashboard search={search} onSearch={(patch) => set(patch)} />
        </>
      )}
    </AppShell>
  );
}
