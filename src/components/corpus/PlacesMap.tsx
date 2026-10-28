import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, Clock3, ExternalLink, Landmark, MapPin, UsersRound } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { BarList } from "@/components/kit/BarList";
import { SourceFooter } from "@/components/kit/Card";
import { ChartCard } from "@/components/kit/ChartCard";
import { LinkTile } from "@/components/kit/LinkTile";
import { MetricMap, type MapArea } from "@/components/places/MetricMap";
import { DivergingDots } from "@/components/charts/d3/charts";
import { PlacesMetricAi } from "./PlacesMetricAi";
import { median } from "d3-array";
import { parseMapSearch, resolveMapSelection } from "@/components/places/mapSearch";
import { mapRows, mapTakeaway } from "./placesMapModel";
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
/** States shown as bars in the ranked panel; every state is in its "View data" table. */
const TOP = 10;

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
  const [tab, setTab] = useState<StateHubTab>("overview");
  const [hover, setHover] = useState<string | null>(null);

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
  const rankRows = useMemo(
    () => mapRows(STATES, metric?.values ?? {}, metric?.rank ?? {}),
    [metric],
  );
  const withValue = rankRows.filter((r) => r.value !== null).length;
  const topRows = rankRows.filter((r) => r.value !== null).slice(0, TOP);
  const takeaway = mapTakeaway(rankRows, (v) => formatMapValue(v, def.format), def.unit);
  const loadingMetric = def.key !== "directory_sources" && metrics.isPending;
  const metricFailed = def.key !== "directory_sources" && !metrics.isPending && !metric;
  const failedParts = metrics.data?.unavailable ?? [];
  const rankingLoading =
    loadingMetric || (def.key === "directory_sources" && atlas.status === "loading");

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
            <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card shadow-xs text-sm text-muted-foreground shadow-xs">
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
          {!countyMode && withValue >= 6
            ? (() => {
                const ranked = rankRows.filter((r) => r.value !== null);
                const mid = median(ranked.map((r) => r.value as number)) ?? 0;
                const picks = [...ranked.slice(0, 5), ...ranked.slice(-5)];
                return (
                  <section
                    aria-label="Highest and lowest states against the median"
                    className="rounded-xl border border-border bg-card shadow-xs p-3"
                  >
                    <h3 className="text-label font-semibold text-foreground">
                      Highest and lowest 5 states against the median
                    </h3>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {/* The unit is printed once: many labels already end with it. */}
                      {def.label} · {metric?.yearLabel ?? ""}
                      {def.unit && !def.label.toLowerCase().includes(def.unit.toLowerCase())
                        ? ` · ${def.unit}`
                        : ""}{" "}
                      · {withValue} states with a value
                    </p>
                    <DivergingDots
                      items={picks.map((r) => ({ label: r.name, value: r.value }))}
                      baseline={mid}
                      baselineLabel="Median"
                      format={(v) => formatMapValue(v, def.format)}
                    />
                    <PlacesMetricAi
                      label={def.label}
                      unit={def.unit}
                      period={shownPeriod}
                      source={shownSourceName}
                      median={mid}
                      ranked={ranked.map((r) => ({ name: r.name, value: r.value as number }))}
                      format={(v) => formatMapValue(v, def.format)}
                      total={rankRows.length}
                    />
                  </section>
                );
              })()
            : null}
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
            className="rounded-xl border border-border bg-card shadow-xs px-4 py-2.5 shadow-xs"
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
          {!home ? (
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
          ) : null}
        </section>
        {/* the ranked panel: the top ten as bars, every state (and the search) behind "View data" */}
        <ChartCard
          id="map-ranking"
          title={takeaway ?? `${def.short}: highest states`}
          subtitle={`${def.label}${metric && shownPeriod ? `, ${shownPeriod}` : ""}. Top ${Math.min(TOP, withValue)} of ${withValue} states with a value.`}
          state={
            rankingLoading ? "loading" : metricFailed ? "error" : withValue ? "ready" : "empty"
          }
          onRetry={() => void metrics.refetch()}
          height={360}
          emptyText={NOT_RECORDED}
          data={{
            title: `${def.label}, by state`,
            description: `${metric && shownPeriod ? `${shownPeriod}. ` : ""}Ranks cover the 50 states and DC; a state without a value is listed as Not recorded.`,
            filename: `${def.short} by state ${metric?.yearLabel ?? ""}`,
            rows: rankRows,
            rowKey: (r) => r.id,
            searchable: true,
            searchLabel: "Find a state",
            columns: [
              {
                key: "rank",
                label: "Rank",
                align: "right",
                value: (r) => r.rank,
                render: (r) => r.rank ?? "—",
              },
              {
                key: "state",
                label: "State",
                value: (r) => r.name,
                render: (r) => (
                  <Link
                    to="/places/$state"
                    params={{ state: r.usps }}
                    search={{ tab }}
                    className="font-medium text-foreground underline-offset-2 hover:text-brand hover:underline"
                  >
                    {r.name}
                  </Link>
                ),
              },
              {
                key: "value",
                label: def.unit.charAt(0).toUpperCase() + def.unit.slice(1),
                align: "right",
                value: (r) => r.value,
                render: (r) => formatMapValue(r.value, def.format),
              },
            ],
            source: { source: sourceLink, period: metric ? shownPeriod : undefined },
          }}
        >
          <BarList
            ariaLabel={`States with the highest ${def.short.toLowerCase()}`}
            highlight={hover && topRows.some((r) => r.usps === hover) ? hover : null}
            items={topRows.map((r) => ({
              id: r.usps,
              label: r.name,
              note: r.rank ? `#${r.rank}` : undefined,
              value: r.value,
              display: formatMapValue(r.value, def.format),
              to: `/places/${r.usps}`,
              search: { tab },
            }))}
          />
        </ChartCard>
      </div>
      {after ? <div className="mt-8">{after}</div> : null}
    </AppShell>
  );
}
