import { createFileRoute, Link, Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, BookOpen, Clock3, Landmark, MapPin, Search, UsersRound } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { UsMap } from "@/components/corpus/UsMap";
import { FullCodeEntry } from "@/components/corpus/FullCodeEntry";
import { StateMark } from "@/components/corpus/EntityArtwork";
import { StateCourtDirectory, StateJudgeDirectory } from "@/components/corpus/StateDirectories";
import { StateSourcePanel } from "@/components/corpus/StateSourcePanel";
import { Button } from "@/components/ui/button";
import { useAtlas } from "@/lib/atlas/store";
import { useCorpus } from "@/lib/corpus/store";
import { sourcesForState } from "@/lib/corpus/join";
import { STATES } from "@/lib/corpus/geo";
import {
  canonicalState,
  parseStateHubSearch,
  type StateHubSearch,
  type StateHubTab,
} from "@/lib/corpus/stateHub";
import { pageHead } from "@/lib/corpus/head";
import { getStateCountyRecords } from "@/lib/external/corpus.functions";
import { useStateCourtDirectory } from "@/lib/external/useStateDirectory";
import { loadRegistryJurisdiction } from "@/lib/atlas/registryV22";
import { loadCatalogIndex, loadCatalogJurisdiction } from "@/lib/atlas/catalog";
import { mergeStateSources } from "@/lib/atlas/stateSources";

export function useStateCounty(stateName: string | undefined) {
  const fn = useServerFn(getStateCountyRecords);
  return useQuery({
    queryKey: ["state-county", stateName],
    enabled: !!stateName,
    staleTime: 5 * 60_000,
    queryFn: () => fn({ data: { stateName: stateName! } }),
  });
}
export const Route = createFileRoute("/places/$state")({
  validateSearch: (search: Record<string, unknown>) => parseStateHubSearch(search),
  head: ({ params }) => {
    const state = canonicalState(params.state);
    return pageHead(
      state?.name ?? "Unknown state",
      state
        ? `Laws, courts, judicial profiles and official sources for ${state.name}.`
        : "Choose a recognized state from the atlas.",
    );
  },
  component: StatePage,
});
const tabs: { id: StateHubTab; label: string; icon: typeof Landmark }[] = [
  { id: "overview", label: "Overview", icon: MapPin },
  { id: "courts", label: "Courts", icon: Landmark },
  { id: "judges", label: "Judges", icon: UsersRound },
  { id: "sources", label: "Laws & sources", icon: BookOpen },
  { id: "counties", label: "Counties", icon: MapPin },
];
function StatePage() {
  const { state: rawState } = Route.useParams();
  const search = Route.useSearch();
  const state = canonicalState(rawState);
  const usps = state?.usps ?? "";
  const countyMatch = useMatch({ from: "/places/$state/$county", shouldThrow: false });
  const tab: StateHubTab = countyMatch ? "counties" : (search.tab ?? "overview");
  const atlas = useAtlas();
  const corpus = useCorpus();
  const navigate = useNavigate();
  const courts = useStateCourtDirectory(usps, !!state && tab === "overview");
  const loadSources = !!state && (tab === "sources" || tab === "overview");
  const registry = useQuery({
    queryKey: ["reg22", usps],
    queryFn: () => loadRegistryJurisdiction(usps),
    enabled: loadSources,
    staleTime: 5 * 60_000,
  });
  const catalog = useQuery({
    queryKey: ["catalog-index"],
    queryFn: loadCatalogIndex,
    enabled: loadSources,
    staleTime: 5 * 60_000,
  });
  const listed = !!catalog.data?.jurisdictions.some((j) => j.jurisdiction === usps.toLowerCase());
  const catalogState = useQuery({
    queryKey: ["catalog-state", usps],
    queryFn: () => loadCatalogJurisdiction(usps.toLowerCase()),
    enabled: loadSources && listed,
    staleTime: 5 * 60_000,
  });
  const directorySources = useMemo(
    () => (state ? sourcesForState(atlas.bundle?.sources ?? [], usps) : []),
    [atlas.bundle, state, usps],
  );
  const sources = useMemo(
    () => mergeStateSources(directorySources, catalogState.data ?? [], registry.data ?? []),
    [directorySources, catalogState.data, registry.data],
  );
  const county = useStateCounty(tab === "counties" ? state?.name : undefined);
  const countyValues = useMemo(
    () => new Map(Object.entries(county.data?.counts ?? {})),
    [county.data],
  );
  const sourceLoading =
    atlas.status === "loading" ||
    registry.isFetching ||
    catalog.isFetching ||
    catalogState.isFetching;
  const sourceError =
    atlas.status === "error" || !!registry.error || !!catalog.error || !!catalogState.error;
  const openTab = (next: StateHubTab) =>
    navigate({ to: "/places/$state", params: { state: usps }, search: { tab: next } });
  const filter = (change: Partial<StateHubSearch>) =>
    navigate({
      to: "/places/$state",
      params: { state: usps },
      search: parseStateHubSearch({ ...search, ...change }),
      replace: true,
    });
  if (!state)
    return (
      <AppShell
        breadcrumbs={[{ label: "Atlas", to: "/" }, { label: rawState }]}
        title="State not found"
        description="This URL does not identify a U.S. state or the District of Columbia."
      >
        <Link to="/" className="text-sm underline">
          Choose a state from the map
        </Link>
      </AppShell>
    );
  return (
    <AppShell
      breadcrumbs={[{ label: "State atlas", to: "/" }, { label: state.name }]}
      title={state.name}
      emblem={<StateMark state={usps} className="size-12" />}
      description="One place for this state’s law, courts and judicial profiles."
      actions={
        <select
          value={usps}
          aria-label="Switch state"
          onChange={(e) =>
            navigate({ to: "/places/$state", params: { state: e.target.value }, search: { tab } })
          }
          className="h-9 max-w-56 rounded-lg border border-input bg-surface px-3 text-xs"
        >
          {[...STATES]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => (
              <option key={s.usps} value={s.usps}>
                {s.name}
              </option>
            ))}
        </select>
      }
    >
      <nav
        aria-label={`${state.name} research`}
        className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-2"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => void openTab(id)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] transition-colors ${tab === id ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </nav>
      {tab === "overview" ? (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.8fr)]">
            <div className="space-y-4">
              <FullCodeEntry state={usps} />
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    id: "courts" as const,
                    label: "Explore courts",
                    text: "Find a court by system or type.",
                    icon: Landmark,
                    count: courts.data?.length,
                  },
                  {
                    id: "judges" as const,
                    label: "Find a judge",
                    text: "Search recorded judicial profiles.",
                    icon: UsersRound,
                    count: undefined,
                  },
                ].map(({ id, label, text, icon: Icon, count }) => (
                  <button
                    type="button"
                    key={id}
                    onClick={() => void openTab(id)}
                    className="group rounded-xl border border-border bg-surface p-5 text-left transition-colors hover:border-primary/30"
                  >
                    <span className="flex items-center justify-between">
                      <span className="rounded-lg bg-[#eef3ef] p-2 text-[#536e61]">
                        <Icon className="size-5" />
                      </span>
                      <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                    </span>
                    <span className="mt-4 block text-sm font-semibold">
                      {label}
                      {count != null ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {count.toLocaleString()}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {text}
                    </span>
                  </button>
                ))}
              </div>
              <Link
                to="/limitations"
                search={{ state: usps }}
                className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-4"
              >
                <span className="rounded-lg bg-amber-50 p-2 text-amber-800">
                  <Clock3 className="size-5" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold">Assess a filing timeline</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Cited baseline rules, exceptions and reviewed scenarios.
                  </span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </Link>
            </div>
            <aside className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Explore the state</h2>
                <span className="text-[11px] text-muted-foreground">{usps}</span>
              </div>
              {corpus.geo ? (
                <UsMap
                  geo={corpus.geo}
                  values={new Map()}
                  valueLabel="records"
                  stateFips={state.fips}
                  onCounty={(c) =>
                    navigate({
                      to: "/places/$state/$county",
                      params: { state: usps, county: c },
                      search: { tab: "counties" },
                    })
                  }
                />
              ) : (
                <p role="status" className="p-6 text-xs text-muted-foreground">
                  {corpus.error
                    ? "Map unavailable. Courts and sources remain available."
                    : "Loading geography…"}
                </p>
              )}
              <button
                type="button"
                onClick={() => void openTab("counties")}
                className="mt-3 text-xs font-medium text-primary hover:underline"
              >
                Browse county sources <span aria-hidden>→</span>
              </button>
            </aside>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4">
            <span className="flex items-center gap-3">
              <Search className="size-5 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Official and research sources</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {sourceLoading
                    ? "Loading source collections…"
                    : sourceError
                      ? "Some collections could not load."
                      : `${sources.length.toLocaleString()} consolidated sources naming ${state.name}.`}
                </span>
              </span>
            </span>
            <Button variant="outline" size="sm" onClick={() => void openTab("sources")}>
              Browse sources
              <ArrowRight className="ml-2 size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
      {tab === "courts" ? (
        <StateCourtDirectory key={usps} state={usps} search={search} onSearch={filter} />
      ) : null}
      {tab === "judges" ? (
        <StateJudgeDirectory key={usps} state={usps} search={search} onSearch={filter} />
      ) : null}
      {tab === "sources" ? (
        <div className="space-y-5">
          <FullCodeEntry state={usps} />
          <StateSourcePanel
            key={usps}
            rows={sources}
            state={usps}
            loading={sourceLoading}
            error={sourceError}
            onRetry={() => {
              atlas.retryLoad();
              void registry.refetch();
              void catalog.refetch();
              if (listed) void catalogState.refetch();
            }}
          />
        </div>
      ) : null}
      {tab === "counties" ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-display text-xl">County sources</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose a county within {state.name}. Counts describe tagged records, not population or
              caseload.
            </p>
          </div>
          {county.error ? (
            <div role="alert" className="rounded-lg border border-warning/30 p-3 text-sm">
              County records could not load.
              <Button variant="link" onClick={() => void county.refetch()}>
                Retry counties
              </Button>
            </div>
          ) : null}
          {county.data?.truncated ? (
            <p className="text-xs text-muted-foreground">
              The source response is limited to its first 5,000 records; counts are partial.
            </p>
          ) : null}
          {corpus.geo ? (
            <UsMap
              geo={corpus.geo}
              values={countyValues}
              valueLabel="tagged records"
              stateFips={state.fips}
              selectedCounty={countyMatch?.params.county}
              onCounty={(c) =>
                navigate({
                  to: "/places/$state/$county",
                  params: { state: usps, county: c },
                  search: { tab: "counties" },
                })
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">Map unavailable.</p>
          )}
          <Outlet />
        </section>
      ) : null}
    </AppShell>
  );
}
