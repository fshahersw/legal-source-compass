import { createFileRoute, Link, Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, BookOpen, Clock3, Landmark, MapPin, UsersRound } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { UsMap } from "@/components/corpus/UsMap";
import { FullCodeEntry } from "@/components/corpus/FullCodeEntry";
import { StateMark } from "@/components/corpus/EntityArtwork";
import { CourtArtwork } from "@/components/corpus/CourtArtwork";
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
import { isJudicialCourtRecord } from "@/lib/corpus/courtDirectoryKind";
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
    staleTime: 300_000,
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
        ? `Laws, courts and research resources for ${state.name}.`
        : "Choose a recognized state.",
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
  const state = canonicalState(rawState),
    usps = state?.usps ?? "";
  const countyMatch = useMatch({ from: "/places/$state/$county", shouldThrow: false });
  const tab: StateHubTab = countyMatch ? "counties" : (search.tab ?? "overview");
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
  const courtPreview = useMemo(
    () =>
      (courts.data ?? [])
        .filter(isJudicialCourtRecord)
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, 6),
    [courts.data],
  );
  const openTab = (next: StateHubTab) =>
    navigate({ to: "/places/$state", params: { state: usps }, search: { tab: next } });
  const filter = (change: Partial<StateHubSearch>) =>
    navigate({
      to: "/places/$state",
      params: { state: usps },
      search: parseStateHubSearch({ ...search, ...change }),
      replace: true,
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
        breadcrumbs={[{ label: "State atlas", to: "/" }, { label: rawState }]}
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
      emblem={<StateMark state={usps} className="size-10" />}
      description="Statutes, court rules, judicial profiles and research resources."
      actions={
        <select
          value={usps}
          aria-label="Switch state"
          onChange={(e) =>
            navigate({ to: "/places/$state", params: { state: e.target.value }, search: { tab } })
          }
          className="h-9 max-w-56 rounded-md border border-input bg-surface px-3 text-xs"
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
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-3">
            <FullCodeEntry state={usps} />
            <StateSourcePanel
              key={usps}
              compact
              rows={sources}
              state={usps}
              loading={sourceLoading}
              error={sourceError}
              onRetry={retrySources}
            />
          </div>
          <aside className="min-w-0 space-y-3" aria-label={`${state.name} quick access`}>
            <section className="resource-panel">
              <div className="research-band">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Landmark className="size-4" aria-hidden />
                  Courts
                </h2>
                {courts.data ? (
                  <span className="text-xs text-[var(--navy-muted)]">
                    {courts.data.filter(isJudicialCourtRecord).length}
                  </span>
                ) : null}
              </div>
              {courts.isPending ? (
                <p role="status" className="px-3 py-6 text-xs text-muted-foreground">
                  Loading courts…
                </p>
              ) : courts.error ? (
                <div role="alert" className="p-3 text-xs">
                  Courts could not load.
                  <button className="ml-2 underline" onClick={() => void courts.refetch()}>
                    Retry
                  </button>
                </div>
              ) : courtPreview.length ? (
                <ul className="divide-y divide-border/70">
                  {courtPreview.map((court) => (
                    <li key={court.id} className="flex items-center gap-2.5 p-3">
                      <CourtArtwork
                        courtId={court.id}
                        title={court.title}
                        system={court.system}
                        type={court.type}
                        compact
                      />
                      <Link
                        to="/courts/$id"
                        params={{ id: court.id }}
                        className="min-w-0 flex-1 text-xs font-medium hover:underline"
                      >
                        <span className="line-clamp-2">{court.title}</span>
                        <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                          {court.type}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-3 text-xs text-muted-foreground">No courts are listed yet.</p>
              )}
              <button
                type="button"
                onClick={() => void openTab("courts")}
                className="flex w-full items-center justify-between border-t border-border bg-muted/30 px-3 py-2.5 text-xs font-medium text-primary hover:bg-muted"
              >
                Browse all courts
                <ArrowRight className="size-3.5" />
              </button>
            </section>
            <section className="resource-panel">
              <button
                type="button"
                onClick={() => void openTab("judges")}
                className="resource-row w-full text-left"
              >
                <span className="resource-icon">
                  <UsersRound className="size-4" />
                </span>
                <span className="flex-1">
                  <span className="block text-[13px] font-semibold">Find a judge</span>
                  <span className="text-[11px] text-muted-foreground">
                    Search by name and court
                  </span>
                </span>
                <ArrowRight className="size-3.5" />
              </button>
              <Link
                to="/limitations"
                search={{ state: usps }}
                className="resource-row border-t border-border"
              >
                <span className="resource-icon">
                  <Clock3 className="size-4" />
                </span>
                <span className="flex-1">
                  <span className="block text-[13px] font-semibold">Assess a deadline</span>
                  <span className="text-[11px] text-muted-foreground">
                    Claim, timeline and exceptions
                  </span>
                </span>
                <ArrowRight className="size-3.5" />
              </Link>
            </section>
            {corpus.geo ? (
              <UsMap
                compact
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
              <p className="p-3 text-xs text-muted-foreground">
                {corpus.error ? "Map unavailable; resources remain accessible." : "Loading map…"}
              </p>
            )}
          </aside>
        </div>
      ) : null}
      {tab === "courts" ? (
        <StateCourtDirectory key={usps} state={usps} search={search} onSearch={filter} />
      ) : null}
      {tab === "judges" ? (
        <StateJudgeDirectory key={usps} state={usps} search={search} onSearch={filter} />
      ) : null}
      {tab === "sources" ? (
        <div className="space-y-3">
          <FullCodeEntry state={usps} />
          <StateSourcePanel
            key={usps}
            rows={sources}
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
              Choose a county to see its available resources.
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
            <p className="text-xs text-muted-foreground">Map unavailable.</p>
          )}
          <Outlet />
        </section>
      ) : null}
    </AppShell>
  );
}
