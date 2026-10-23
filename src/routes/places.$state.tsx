import { createFileRoute, Link, Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarChart3, BookOpen, Landmark, MapPin, UsersRound } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { UsMap } from "@/components/corpus/UsMap";
import { FullCodeEntry } from "@/components/corpus/FullCodeEntry";
import { StateMark } from "@/components/corpus/EntityArtwork";
import { StateCourtDirectory, StateJudgeDirectory } from "@/components/corpus/StateDirectories";
import { StateSourcePanel } from "@/components/corpus/StateSourcePanel";
import { StateAnalysisView } from "@/components/places/StateAnalysisView";
import { DEFAULT_METRIC } from "@/components/places/placeMetrics";
import {
  directorySearch,
  parsePlaceHubSearch,
  type PlaceHubSearch,
  type PlaceHubTab,
} from "@/components/places/placeSearch";
import { AreaList } from "@/components/places/state/AreaList";
import { partitionStateSources } from "@/components/places/state/resourceFacts";
import { hostKey } from "@/components/places/state/resourceFilter";
import { StateOverviewTab } from "@/components/places/state/StateOverviewTab";
import { Button } from "@/components/ui/button";
import { useAtlas } from "@/lib/atlas/store";
import { useCorpus } from "@/lib/corpus/store";
import { sourcesForState } from "@/lib/corpus/join";
import { STATES, stateByUsps } from "@/lib/corpus/geo";
import { canonicalState, PUERTO_RICO, type StateHubSearch } from "@/lib/corpus/stateHub";
import { pageHead } from "@/lib/corpus/head";
import { getStateCountyRecords } from "@/lib/external/corpus.functions";
import { lookupGovernmentDomains } from "@/lib/external/govDomains.functions";
import { registryStateByHost } from "@/lib/external/govDomainsModel";
import { useStateCourtDirectory } from "@/lib/external/useStateDirectory";
import { loadRegistryJurisdiction } from "@/lib/atlas/registryV22";
import { loadCatalogIndex, loadCatalogJurisdiction } from "@/lib/atlas/catalog";
import { mergeStateSources } from "@/lib/atlas/stateSources";

export function useStateCounty(stateName: string | undefined) {
  const fn = useServerFn(getStateCountyRecords);
  return useQuery({
    queryKey: ["state-county", stateName],
    enabled: !!stateName,
    staleTime: 300_000,
    queryFn: () => fn({ data: { stateName: stateName! } }),
  });
}
export const Route = createFileRoute("/places/$state")({
  validateSearch: (search: Record<string, unknown>): PlaceHubSearch => parsePlaceHubSearch(search),
  head: ({ params }) => {
    const state = canonicalState(params.state);
    return pageHead(
      state?.name ?? "Unknown state",
      state
        ? `Courts, law, litigation, Census figures and research resources for ${state.name}.`
        : "Choose a recognized state.",
    );
  },
  component: StatePage,
});
/**
 * The Overview tab carries courts, law, litigation and demographics in one page; "Laws & sources" is renamed "Law &
 * resources" because the overview now has its own Law section, and this tab holds the full code browser and the
 * complete, searchable resource directory.
 */
const tabs: { id: PlaceHubTab; label: string; icon: typeof Landmark }[] = [
  { id: "overview", label: "Overview", icon: MapPin },
  { id: "analysis", label: "Analysis", icon: BarChart3 },
  { id: "courts", label: "Courts", icon: Landmark },
  { id: "judges", label: "Judges", icon: UsersRound },
  { id: "sources", label: "Law & resources", icon: BookOpen },
  { id: "counties", label: "Counties", icon: MapPin },
];
/** The 50 states and DC, plus Puerto Rico (which has pages but no place in state rankings). */
const SWITCHER = [
  ...STATES.map((s) => ({ usps: s.usps, name: s.name })),
  { usps: PUERTO_RICO.usps, name: PUERTO_RICO.name },
].sort((a, b) => a.name.localeCompare(b.name));
function StatePage() {
  const { state: rawState } = Route.useParams();
  const search = Route.useSearch();
  const state = canonicalState(rawState),
    usps = state?.usps ?? "";
  const countyMatch = useMatch({ from: "/places/$state/$county", shouldThrow: false });
  const tab: PlaceHubTab = countyMatch ? "counties" : (search.tab ?? "overview");
  const atlas = useAtlas(),
    corpus = useCorpus(),
    navigate = useNavigate();
  const courts = useStateCourtDirectory(usps, !!state && tab === "overview");
  const loadSources = !!state && (tab === "sources" || tab === "overview");
  const registry = useQuery({
    queryKey: ["reg22", usps],
    queryFn: () => loadRegistryJurisdiction(usps),
    enabled: loadSources,
    staleTime: 300_000,
  });
  const catalog = useQuery({
    queryKey: ["catalog-index"],
    queryFn: loadCatalogIndex,
    enabled: loadSources,
    staleTime: 300_000,
  });
  const listed = !!catalog.data?.jurisdictions.some((j) => j.jurisdiction === usps.toLowerCase());
  const catalogState = useQuery({
    queryKey: ["catalog-state", usps],
    queryFn: () => loadCatalogJurisdiction(usps.toLowerCase()),
    enabled: loadSources && listed,
    staleTime: 300_000,
  });
  const directorySources = useMemo(
    () => (state ? sourcesForState(atlas.bundle?.sources ?? [], usps) : []),
    [atlas.bundle, state, usps],
  );
  const merged = useMemo(
    () => mergeStateSources(directorySources, catalogState.data ?? [], registry.data ?? []),
    [directorySources, catalogState.data, registry.data],
  );
  // Commercial publishers and resources whose host belongs to another state are withheld, with the reason shown.
  const base = useMemo(() => partitionStateSources(merged, usps), [merged, usps]);
  // A host the name guess places in another state is checked against the government domain registries: one they register
  // to this state is shown. Not being listed changes nothing, and a failed check leaves the list as it was.
  const otherStateHosts = useMemo(
    () =>
      [
        ...new Set(
          base.hidden
            .filter((h) => h.reason === "other_state")
            .map((h) => hostKey(h.row.domain || h.row.url))
            .filter(Boolean),
        ),
      ]
        .sort()
        .slice(0, 60),
    [base.hidden],
  );
  const lookupHosts = useServerFn(lookupGovernmentDomains);
  const govEvidence = useQuery({
    queryKey: ["gov-registry-hosts", usps, otherStateHosts.join("|")],
    enabled: loadSources && otherStateHosts.length > 0,
    staleTime: 10 * 60_000,
    // a plain object, so the cached result serialises
    queryFn: async () =>
      Object.fromEntries(
        registryStateByHost((await lookupHosts({ data: { inputs: otherStateHosts } })).results),
      ),
  });
  const { shown: sources, hidden: hiddenSources } = useMemo(() => {
    const registered = new Map(Object.entries(govEvidence.data ?? {}));
    return registered.size ? partitionStateSources(merged, usps, registered) : base;
  }, [merged, usps, govEvidence.data, base]);
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
  const openTab = (next: PlaceHubTab) =>
    navigate({ to: "/places/$state", params: { state: usps }, search: { tab: next } });
  const filter = (change: Partial<StateHubSearch>) =>
    navigate({
      to: "/places/$state",
      params: { state: usps },
      search: parsePlaceHubSearch({ ...search, ...change }),
      replace: true,
    });
  const analysisChange = (patch: Partial<PlaceHubSearch>) =>
    navigate({
      to: "/places/$state",
      params: { state: usps },
      search: parsePlaceHubSearch({ ...search, tab: "analysis", ...patch }),
      replace: true,
      resetScroll: false,
    });
  const retrySources = () => {
    atlas.retryLoad();
    void registry.refetch();
    void catalog.refetch();
    if (listed) void catalogState.refetch();
  };
  if (!state)
    return (
      <AppShell
        breadcrumbs={[{ label: "States & courts", to: "/" }, { label: rawState }]}
        title="State not found"
        description="This URL does not identify a U.S. state, the District of Columbia or Puerto Rico."
      >
        <Link to="/" className="text-sm underline">
          Choose a state from the map
        </Link>
      </AppShell>
    );
  return (
    <AppShell
      breadcrumbs={[{ label: "States & courts", to: "/" }, { label: state.name }]}
      title={state.name}
      emblem={<StateMark state={usps} className="size-10" />}
      description="Courts, law, litigation and enforcement, Census figures and research resources."
      actions={
        <select
          value={usps}
          aria-label="Switch state"
          onChange={(e) =>
            navigate({ to: "/places/$state", params: { state: e.target.value }, search: { tab } })
          }
          className="h-9 max-w-56 rounded-md border border-input bg-surface px-3 text-xs"
        >
          {SWITCHER.map((s) => (
            <option key={s.usps} value={s.usps}>
              {s.name}
            </option>
          ))}
        </select>
      }
    >
      <nav aria-label={`${state.name} research`} className="workspace-tabs">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => void openTab(id)}
            className={`flex items-center gap-2 rounded-md px-3 text-xs transition-colors ${tab === id ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </nav>
      {tab === "overview" ? (
        <StateOverviewTab
          key={usps}
          usps={usps}
          stateName={state.name}
          courts={courts.data}
          courtsLoading={courts.isPending}
          courtsError={!!courts.error}
          onRetryCourts={() => void courts.refetch()}
          sources={sources}
          hiddenSources={hiddenSources}
          sourcesLoading={sourceLoading}
          sourcesError={sourceError}
          onRetrySources={retrySources}
          onOpenTab={(next) => void openTab(next)}
        />
      ) : null}
      {tab === "analysis" ? (
        <StateAnalysisView
          key={`analysis-${usps}`}
          usps={usps}
          stateName={state.name}
          view={search.view ?? "map"}
          metric={search.metric ?? DEFAULT_METRIC}
          onChange={(patch) => void analysisChange(patch)}
          onCounty={(c) =>
            void navigate({
              to: "/places/$state/$county",
              params: { state: usps, county: c },
              search: { tab: "counties" },
            })
          }
        />
      ) : null}
      {tab === "courts" ? (
        <StateCourtDirectory
          key={usps}
          state={usps}
          search={directorySearch(search)}
          onSearch={filter}
        />
      ) : null}
      {tab === "judges" ? (
        <StateJudgeDirectory
          key={usps}
          state={usps}
          search={directorySearch(search)}
          onSearch={filter}
        />
      ) : null}
      {tab === "sources" ? (
        <div className="space-y-3">
          <FullCodeEntry state={usps} />
          <StateSourcePanel
            key={usps}
            rows={sources}
            hidden={hiddenSources}
            state={usps}
            loading={sourceLoading}
            error={sourceError}
            onRetry={retrySources}
          />
        </div>
      ) : null}
      {tab === "counties" ? (
        <section className="space-y-3">
          <div className="resource-panel">
            <div className="research-band">
              <h2 className="text-sm font-semibold">County resources</h2>
              <span className="text-xs text-[var(--navy-muted)]">{state.name}</span>
            </div>
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Choose a county to see its Census figures and available resources.
            </p>
          </div>
          {county.error ? (
            <div role="alert" className="resource-panel p-3 text-xs">
              County records could not load.
              <Button variant="link" onClick={() => void county.refetch()}>
                Retry counties
              </Button>
            </div>
          ) : null}
          {county.data?.truncated ? (
            <p role="status" className="text-xs text-muted-foreground">
              Counts are partial: the response is limited to 5,000 records.
            </p>
          ) : null}
          {!stateByUsps.has(usps) ? (
            countyMatch ? (
              <details className="resource-panel">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium hover:bg-muted/40">
                  Choose another area of {state.name}
                </summary>
                <AreaList usps={usps} stateName={state.name} />
              </details>
            ) : (
              <AreaList usps={usps} stateName={state.name} />
            )
          ) : corpus.geo ? (
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
            <p className="text-xs text-muted-foreground">Map unavailable.</p>
          )}
          <Outlet />
        </section>
      ) : null}
    </AppShell>
  );
}
