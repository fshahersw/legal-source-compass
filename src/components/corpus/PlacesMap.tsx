import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  BookOpen,
  Clock3,
  ExternalLink,
  Landmark,
  MapPin,
  Search,
  UsersRound,
} from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
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

const DESTINATIONS = [
  { id: "overview" as const, label: "State overview", icon: MapPin },
  { id: "courts" as const, label: "Courts", icon: Landmark },
  { id: "judges" as const, label: "Judges", icon: UsersRound },
];
const RANKED = STATES.map((s) => s.fips);

/**
 * The national map. On "/" it is the Overview (its briefing is passed as `after`); on /places it is the Places
 * section's Map tab. Both keep the same metric selector, layers, readout and data table.
 */
export function PlacesMap({ home, after }: { home?: boolean | undefined; after?: ReactNode }) {
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

  return (
    <AppShell
      breadcrumbs={[]}
      title={home ? "Overview" : "Places"}
      description={
        home
          ? "The national map of courts, litigation, law, enforcement and Census figures, with a briefing across the platform below it."
          : "States, counties and cities: shade the map by a metric, then open a state for its courts, law, litigation and figures."
      }
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Shade the map by
            <select
              value={metricKey}
              onChange={(e) => setSearch({ metric: e.target.value })}
              aria-label="Map metric"
              data-testid="map-metric"
              className="h-9 w-72 max-w-full rounded-md border border-input bg-surface px-2 text-xs text-foreground"
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
          <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            <span id="map-layer-label">Layer</span>
            <div
              role="group"
              aria-labelledby="map-layer-label"
              className="flex rounded-md border border-border bg-surface p-0.5"
            >
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
                  className={`h-8 rounded px-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${l.on ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface p-1"
          role="group"
          aria-label="Open selected state in"
        >
          {DESTINATIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors ${tab === id ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
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
            <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-md border border-border bg-surface text-sm text-muted-foreground">
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
            <div role="alert" className="rounded-md border border-border bg-surface p-3 text-xs">
              {def.label} could not be loaded
              {failedParts.length ? ` (${failedParts.join(", ")} unavailable)` : ""}. States are
              shown as Not recorded.
              <button
                type="button"
                className="ml-2 text-primary underline"
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
            <div role="alert" className="rounded-md border border-border bg-surface p-3 text-xs">
              County values could not be loaded.
              <button
                type="button"
                className="ml-2 text-primary underline"
                onClick={() => void layer.refetch()}
              >
                Retry
              </button>
            </div>
          ) : null}
          <div
            className="rounded-md border border-border bg-surface px-3 py-2.5 text-xs leading-5"
            data-testid="map-about"
          >
            <h2 className="text-[13px] font-semibold">{def.label}</h2>
            <p className="m-0 mt-0.5 text-muted-foreground">{def.help}</p>
            {countyMode && def.countyNote ? (
              <p className="m-0 mt-1 text-muted-foreground">{def.countyNote}</p>
            ) : null}
            {metric ? (
              <p className="m-0 mt-1 text-muted-foreground">
                Period: {countyMode && layer.data ? layer.data.yearLabel : metric.yearLabel}.
                Source:{" "}
                <a
                  href={externalHref(
                    countyMode && layer.data ? layer.data.sourceUrl : metric.sourceUrl,
                  )}
                  {...((countyMode && layer.data
                    ? layer.data.sourceUrl
                    : metric.sourceUrl
                  ).startsWith("/")
                    ? {}
                    : { target: "_blank", rel: "noreferrer" })}
                  className="inline-flex items-center gap-0.5 text-primary underline"
                >
                  {countyMode && layer.data ? layer.data.sourceName : metric.sourceName}
                  {(countyMode && layer.data ? layer.data.sourceUrl : metric.sourceUrl).startsWith(
                    "/",
                  ) ? null : (
                    <ExternalLink className="size-3" aria-hidden />
                  )}
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
                      className="text-primary underline"
                    >
                      Census Bureau
                    </a>
                    ).
                  </>
                ) : null}{" "}
                Ranks cover the 50 states and DC. Shading is by quantile class; darker is higher.
              </p>
            ) : null}
          </div>
          <details className="rounded-md border border-border bg-surface" data-testid="map-data">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium hover:bg-muted/40">
              Show data for the states
            </summary>
            <div className="max-h-80 overflow-auto border-t border-border">
              <table className="w-full text-xs">
                <caption className="sr-only">
                  {def.label}, {metric?.yearLabel ?? ""}, by state
                </caption>
                <thead className="sticky top-0 bg-muted/60 text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-1.5 font-medium">
                      Rank
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-medium">
                      State
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">
                      {def.unit}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.id} className="border-t border-border/60">
                      <td className="px-3 py-1 tabular-nums text-muted-foreground">
                        {r.rank ?? "—"}
                      </td>
                      <td className="px-3 py-1">
                        <Link
                          to="/places/$state"
                          params={{ state: stateByFips.get(r.id)?.usps ?? r.id }}
                          search={{ tab }}
                          className="text-primary hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-3 py-1 text-right font-mono tabular-nums">
                        {formatMapValue(r.value, def.format)}
                      </td>
                    </tr>
                  ))}
                  {!tableRows.length ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">
                        {NOT_RECORDED}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </details>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to="/law"
              className="group flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5 transition-colors hover:border-primary/25"
            >
              <span className="rounded-md bg-[var(--blue-tint)] p-2 text-primary">
                <BookOpen className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Federal law & agencies</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Statutes, rules and regulatory sources.
                </span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              to="/limitations"
              className="group flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5 transition-colors hover:border-primary/25"
            >
              <span className="rounded-md bg-[var(--blue-tint)] p-2 text-primary">
                <Clock3 className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Deadline assessment</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Cited rules with a guided review.
                </span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>
        <aside className="overflow-hidden rounded-md border border-border bg-surface">
          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Choose a state</h2>
              <span className="text-[11px] text-muted-foreground">{filtered.length} shown</span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Find a state"
                placeholder="Name or abbreviation"
                className="h-9 pl-8 text-xs"
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="truncate" title={`${def.short}, ${metric?.yearLabel ?? ""}`}>
                {def.short}
              </span>
              <span className="flex gap-1" role="group" aria-label="Sort states">
                {(["name", "value"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={sortBy === s}
                    onClick={() => setSortBy(s)}
                    className={`rounded px-1.5 py-0.5 ${sortBy === s ? "bg-muted font-medium text-foreground" : "hover:bg-muted/60"}`}
                  >
                    {s === "name" ? "A to Z" : "By value"}
                  </button>
                ))}
              </span>
            </div>
          </div>
          <ul className="max-h-[29rem] divide-y divide-border/60 overflow-y-auto">
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
                    className={`flex items-center gap-2.5 px-3 py-2 transition-colors ${hover === state.usps ? "bg-muted" : "hover:bg-muted/50"}`}
                  >
                    <StateMark state={state.usps} className="size-7 rounded-md p-1" />
                    <span className="min-w-0 flex-1 text-[13px] font-medium">{state.name}</span>
                    <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                      {loadingMetric ||
                      (def.key === "directory_sources" && atlas.status === "loading")
                        ? "…"
                        : value == null
                          ? "—"
                          : formatMapValue(value, def.format)}
                      {rank ? <span className="block text-[10px]">#{rank.rank}</span> : null}
                    </span>
                    <ArrowRight className="size-3 text-muted-foreground/50" />
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
      {after ? <div className="mt-6">{after}</div> : null}
    </AppShell>
  );
}
