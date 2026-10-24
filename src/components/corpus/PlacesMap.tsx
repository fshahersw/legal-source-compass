import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BookOpen,
  ChevronRight,
  Clock3,
  ExternalLink,
  Landmark,
  MapPin,
  Search,
  UsersRound,
} from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { SourceFooter } from "@/components/kit/Card";
import { LinkTile } from "@/components/kit/LinkTile";
import { MetricMap, type MapArea } from "@/components/places/MetricMap";
import { dataRows } from "@/components/places/mapView";
import { parseMapSearch, resolveMapSelection } from "@/components/places/mapSearch";
import { StateMark } from "./EntityArtwork";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAtlas } from "@/lib/atlas/store";
import { useCorpus } from "@/lib/corpus/store";
import { joinByState } from "@/lib/corpus/join";
import { stateByFips, STATES } from "@/lib/corpus/geo";
import type { StateHubTab } from "@/lib/corpus/stateHub";
import { getCountyMapLayer, getStateMapMetrics } from "@/lib/external/mapMetrics.functions";
import {
  competitionRank,
  COUNTY_LAYER_FORMAT,
  countyLayerUnit,
  formatMapValue,
  MAP_GROUPS,
  NOT_RECORDED,
  STATE_METRIC_BY_KEY,
  STATE_METRICS,
  type StateMapMetric,
} from "@/lib/external/mapMetricsModel";
import { externalHref } from "@/lib/external/href";
import { cn } from "@/lib/utils";

const DESTINATIONS = [
  { id: "overview" as const, label: "State overview", icon: MapPin },
  { id: "courts" as const, label: "Courts", icon: Landmark },
  { id: "judges" as const, label: "Judges", icon: UsersRound },
];
const RANKED = STATES.map((s) => s.fips);

/** Segmented control (soft pill on a muted track) shared by the map's toggles. */
const SEGMENTED = "flex rounded-lg border border-border bg-muted p-[3px]";
const segment = (on: boolean) =>
  cn(
    "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-ring",
    on
      ? "bg-surface font-medium text-foreground shadow-xs"
      : "text-muted-foreground hover:text-foreground",
  );

/**
 * The national map. On "/" it is the Overview (its briefing is passed as `before` and its section links as `after`);
 * on /places it is the Places section's Map tab. Both keep the same metric selector, layers, readout and data table.
 */
export function PlacesMap({
  home,
  before,
  after,
}: {
  home?: boolean | undefined;
  /** Rendered above the map (the Overview's KPI row). */
  before?: ReactNode;
  after?: ReactNode;
}) {
  const atlas = useAtlas();
  const corpus = useCorpus();
  const navigate = useNavigate();
  const search = parseMapSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const { metric: metricKey, counties: countyMode } = resolveMapSelection(search);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<StateHubTab>("overview");
  const [hover, setHover] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "value">("name");

  const metricsFn = useServerFn(getStateMapMetrics);
  const layerFn = useServerFn(getCountyMapLayer);
  const metrics = useQuery({
    queryKey: ["map-state-metrics"],
    queryFn: () => metricsFn(),
    staleTime: 10 * 60_000,
  });
  const def = STATE_METRIC_BY_KEY.get(metricKey)!;
  const layerKey = countyMode ? def.county : null;
  const layer = useQuery({
    queryKey: ["map-county-layer", layerKey],
    enabled: !!layerKey,
    queryFn: () => layerFn({ data: { layer: layerKey! } }),
    staleTime: 10 * 60_000,
  });

  const report = useMemo(() => joinByState(atlas.bundle?.sources ?? [], null), [atlas.bundle]);
  const states = useMemo(
    () => [...report.byState.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [report],
  );
  const directory: StateMapMetric | null = useMemo(() => {
    if (atlas.status !== "ready") return null;
    const values = Object.fromEntries(states.map((s) => [s.fips, s.sources]));
    return {
      key: "directory_sources",
      yearLabel: "current directory",
      values,
      detail: {},
      rank: competitionRank(values, RANKED),
      sourceName: "Legal Source Atlas directory",
      sourceUrl: "/sources/library",
      denominator: null,
    };
  }, [states, atlas.status]);
  const metric: StateMapMetric | null =
    metricKey === "directory_sources"
      ? directory
      : (metrics.data?.metrics.find((m) => m.key === metricKey) ?? null);

  /** Change the metric and/or layer; `layer: null` returns to the state layer. */
  const setSearch = (patch: { metric?: string; layer?: "counties" | null }) => {
    const layer =
      patch.layer === undefined
        ? countyMode
          ? "counties"
          : undefined
        : (patch.layer ?? undefined);
    const next = parseMapSearch({ metric: patch.metric ?? metricKey, layer });
    void navigate({ to: home ? "/" : "/places", search: next, replace: true, resetScroll: false });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = states.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || s.usps.toLowerCase() === q,
    );
    if (sortBy === "value" && metric)
      return [...list].sort(
        (a, b) =>
          (metric.values[b.fips] ?? Number.NEGATIVE_INFINITY) -
            (metric.values[a.fips] ?? Number.NEGATIVE_INFINITY) || a.name.localeCompare(b.name),
      );
    return list;
  }, [states, query, sortBy, metric]);

  const stateArea: MapArea = {
    values: metric?.values ?? {},
    detail: metric?.detail ?? {},
    format: def.format,
    unit: def.unit,
    yearLabel: metric?.yearLabel ?? "",
  };
  const countyArea: MapArea | null =
    countyMode && layer.data
      ? {
          values: layer.data.values,
          format: COUNTY_LAYER_FORMAT[layerKey!] ?? def.format,
          unit: countyLayerUnit(def),
          yearLabel: layer.data.yearLabel,
        }
      : null;
  const countyNames = useMemo(
    () =>
      new Map(
        (corpus.geo?.counties ?? []).map((c) => [
          c.id,
          `${c.name}, ${stateByFips.get(c.stateFips)?.usps ?? ""}`,
        ]),
      ),
    [corpus.geo],
  );
  const stateNames = useMemo(() => new Map(STATES.map((s) => [s.fips, s.name])), []);
  const tableRows = useMemo(
    () => (metric ? dataRows(stateNames, metric.values, RANKED) : []),
    [metric, stateNames],
  );
  const loadingMetric = def.key !== "directory_sources" && metrics.isPending;
  const metricFailed = def.key !== "directory_sources" && !metrics.isPending && !metric;
  const failedParts = metrics.data?.unavailable ?? [];

  const shownSourceUrl = countyMode && layer.data ? layer.data.sourceUrl : metric?.sourceUrl;
  const shownSourceName = countyMode && layer.data ? layer.data.sourceName : metric?.sourceName;
  const shownPeriod = countyMode && layer.data ? layer.data.yearLabel : metric?.yearLabel;
  const sourceLink =
    metric && shownSourceUrl ? (
      <a
        href={externalHref(shownSourceUrl)}
        {...(shownSourceUrl.startsWith("/") ? {} : { target: "_blank", rel: "noreferrer" })}
        title={shownSourceName}
        className="inline-flex min-w-0 items-center gap-0.5 underline-offset-2 hover:text-foreground hover:underline"
      >
        <span className="truncate">{shownSourceName}</span>
        {shownSourceUrl.startsWith("/") ? null : (
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        )}
      </a>
    ) : null;

  return (
    <AppShell
      breadcrumbs={[]}
      title={home ? "Overview" : "Places"}
      description={
        home
          ? "The national map of courts, litigation, law, enforcement and Census figures, with a briefing across the platform."
          : "States, counties and cities: shade the map by a metric, then open a state for its courts, law, litigation and figures."
      }
    >
      {before ? <div className="mb-6">{before}</div> : null}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-meta font-medium text-muted-foreground">
            Shade the map by
            <select
              value={metricKey}
              onChange={(e) => setSearch({ metric: e.target.value })}
              aria-label="Map metric"
              data-testid="map-metric"
              className="h-9 w-72 max-w-full cursor-pointer rounded-md border border-input bg-surface px-2.5 text-[13px] font-normal text-foreground shadow-xs transition-[border-color,box-shadow] hover:border-border-strong focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
            >
              {MAP_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {STATE_METRICS.filter((m) => m.group === group).map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.short}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1.5 text-meta font-medium text-muted-foreground">
            <span id="map-layer-label">Layer</span>
            <div role="group" aria-labelledby="map-layer-label" className={SEGMENTED}>
              {(
                [
                  { id: "states", label: "States", on: !countyMode, enabled: true },
                  { id: "counties", label: "Counties", on: countyMode, enabled: !!def.county },
                ] as const
              ).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={l.on}
                  disabled={!l.enabled}
                  title={l.enabled ? undefined : "No county data exists for this metric"}
                  onClick={() => setSearch({ layer: l.id === "counties" ? "counties" : null })}
                  className={segment(l.on)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 text-meta font-medium text-muted-foreground">
          <span id="map-destination-label">Open a state in</span>
          <div
            className={cn(SEGMENTED, "flex-wrap")}
            role="group"
            aria-labelledby="map-destination-label"
          >
            {DESTINATIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
                className={segment(tab === id)}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <section aria-label="Explore jurisdictions on a map" className="min-w-0 space-y-3">
          {corpus.geo ? (
            <MetricMap
              geo={corpus.geo}
              title={countyMode ? `${def.short}, by county` : def.label}
              states={stateArea}
              counties={countyArea}
              countyNames={countyNames}
              selectedState={filtered.length === 1 ? filtered[0]?.usps : undefined}
              onHoverState={setHover}
              onState={(fips) => {
                const state = stateByFips.get(fips);
                if (state)
                  void navigate({
                    to: "/places/$state",
                    params: { state: state.usps },
                    search: { tab },
                  });
              }}
              onCounty={(id) => {
                const state = stateByFips.get(id.slice(0, 2));
                if (state)
                  void navigate({
                    to: "/places/$state/$county",
                    params: { state: state.usps, county: id },
                    search: { tab: "counties" },
                  });
              }}
            />
          ) : (
            <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card text-sm text-muted-foreground shadow-xs">
              <MapPin className="size-8 opacity-50" />
              <p role="status">
                {corpus.error ? "The map is temporarily unavailable." : "Preparing the state map…"}
              </p>
              <p className="text-xs">All states remain accessible in the list.</p>
              {corpus.error ? (
                <Button variant="outline" size="sm" onClick={corpus.retry}>
                  Retry map
                </Button>
              ) : null}
            </div>
          )}
          {loadingMetric ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading {def.short.toLowerCase()}…
            </p>
          ) : null}
          {metricFailed ? (
            <div
              role="alert"
              className="rounded-lg border border-status-critical-ring bg-status-critical-soft px-3 py-2.5 text-xs text-status-critical-ink"
            >
              {def.label} could not be loaded
              {failedParts.length ? ` (${failedParts.join(", ")} unavailable)` : ""}. States are
              shown as Not recorded.
              <button
                type="button"
                className="ml-2 font-medium text-foreground underline"
                onClick={() => void metrics.refetch()}
              >
                Retry
              </button>
            </div>
          ) : null}
          {countyMode && layer.isPending ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading county values…
            </p>
          ) : null}
          {countyMode && layer.isError ? (
            <div
              role="alert"
              className="rounded-lg border border-status-critical-ring bg-status-critical-soft px-3 py-2.5 text-xs text-status-critical-ink"
            >
              County values could not be loaded.
              <button
                type="button"
                className="ml-2 font-medium text-foreground underline"
                onClick={() => void layer.refetch()}
              >
                Retry
              </button>
            </div>
          ) : null}
          <div
            className="rounded-xl border border-border bg-card px-4 py-2.5 shadow-xs"
            data-testid="map-about"
          >
            <SourceFooter
              source={sourceLink}
              period={metric ? shownPeriod : undefined}
              aboutTitle={def.label}
              about={
                <>
                  <p>{def.help}</p>
                  {countyMode && def.countyNote ? <p>{def.countyNote}</p> : null}
                  {metric ? (
                    <p>
                      Period: {shownPeriod}. Source:{" "}
                      <a
                        href={externalHref(shownSourceUrl!)}
                        {...(shownSourceUrl!.startsWith("/")
                          ? {}
                          : { target: "_blank", rel: "noreferrer" })}
                      >
                        {shownSourceName}
                      </a>
                      .
                      {metric.denominator && !countyMode ? (
                        <>
                          {" "}
                          Denominator: {metric.denominator.label}, {metric.denominator.year} (
                          <a
                            href={externalHref(metric.denominator.url)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Census Bureau
                          </a>
                          ).
                        </>
                      ) : null}{" "}
                      Ranks cover the 50 states and DC. Shading is by quantile class; a stronger
                      shade is a higher value.
                    </p>
                  ) : null}
                </>
              }
            >
              {!metric ? <span className="flex-1 truncate">{def.label}</span> : null}
            </SourceFooter>
          </div>
          <details
            className="group rounded-xl border border-border bg-card shadow-xs"
            data-testid="map-data"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
                aria-hidden
              />
              Show data for the states
            </summary>
            <div className="max-h-80 overflow-auto border-t border-border">
              <table className="w-full text-xs">
                <caption className="sr-only">
                  {def.label}, {metric?.yearLabel ?? ""}, by state
                </caption>
                <thead className="sticky top-0 bg-muted text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Rank
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      State
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      {def.unit}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.id} className="border-t border-border/70">
                      <td className="px-4 py-1.5 tabular-nums text-muted-foreground">
                        {r.rank ?? "—"}
                      </td>
                      <td className="px-4 py-1.5">
                        <Link
                          to="/places/$state"
                          params={{ state: stateByFips.get(r.id)?.usps ?? r.id }}
                          search={{ tab }}
                          className="font-medium text-foreground underline-offset-2 hover:text-brand hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-4 py-1.5 text-right tabular-nums">
                        {formatMapValue(r.value, def.format)}
                      </td>
                    </tr>
                  ))}
                  {!tableRows.length ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-4 text-center text-muted-foreground">
                        {NOT_RECORDED}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </details>
          <div className="grid gap-3 sm:grid-cols-2">
            <LinkTile
              to="/law"
              icon={BookOpen}
              title="Federal law & agencies"
              description="Statutes, rules and regulatory sources."
            />
            <LinkTile
              to="/limitations"
              icon={Clock3}
              title="Deadline assessment"
              description="Cited rules with a guided review."
            />
          </div>
        </section>
        <aside className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <div className="border-b border-border p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-label font-semibold">Choose a state</h2>
              <span className="text-meta tabular-nums text-muted-foreground">
                {filtered.length} shown
              </span>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Find a state"
                placeholder="Name or abbreviation"
                className="h-9 pl-8 text-[13px] md:h-9"
              />
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2 text-meta text-muted-foreground">
              <span className="truncate" title={`${def.short}, ${metric?.yearLabel ?? ""}`}>
                {def.short}
              </span>
              <span
                className={cn(SEGMENTED, "shrink-0 p-0.5")}
                role="group"
                aria-label="Sort states"
              >
                {(["name", "value"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={sortBy === s}
                    onClick={() => setSortBy(s)}
                    className={cn(segment(sortBy === s), "h-6 px-2 text-[11px]")}
                  >
                    {s === "name" ? "A to Z" : "By value"}
                  </button>
                ))}
              </span>
            </div>
          </div>
          <ul className="max-h-[29rem] divide-y divide-border/70 overflow-y-auto">
            {filtered.map((state) => {
              const value = metric?.values[state.fips];
              const rank = metric?.rank[state.fips];
              return (
                <li key={state.usps}>
                  <Link
                    to="/places/$state"
                    params={{ state: state.usps }}
                    search={{ tab }}
                    onMouseEnter={() => setHover(state.usps)}
                    onMouseLeave={() => setHover(null)}
                    className={`group flex items-center gap-2.5 px-4 py-2 transition-colors ${hover === state.usps ? "bg-accent" : "hover:bg-accent"}`}
                  >
                    <StateMark state={state.usps} className="size-7 rounded-md p-1" />
                    <span className="min-w-0 flex-1 text-[13px] font-medium">{state.name}</span>
                    <span className="text-right text-[12px] tabular-nums text-foreground/80">
                      {loadingMetric ||
                      (def.key === "directory_sources" && atlas.status === "loading")
                        ? "…"
                        : value == null
                          ? "—"
                          : formatMapValue(value, def.format)}
                      {rank ? (
                        <span className="block text-[10.5px] text-muted-foreground">
                          #{rank.rank}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight className="size-3.5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {!filtered.length ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              No state matches. Try its full name or two-letter abbreviation.
            </p>
          ) : null}
          {atlas.status === "error" && def.key === "directory_sources" ? (
            <div role="alert" className="border-t border-border p-3 text-xs text-muted-foreground">
              Source counts unavailable.
              <button type="button" className="ml-2 underline" onClick={atlas.retryLoad}>
                Retry
              </button>
            </div>
          ) : null}
        </aside>
      </div>
      {after ? <div className="mt-8">{after}</div> : null}
    </AppShell>
  );
}
