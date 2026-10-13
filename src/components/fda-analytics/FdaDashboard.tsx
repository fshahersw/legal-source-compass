import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Database, Download, Info, RefreshCw } from "lucide-react";
import { getFdaAnalyticsSnapshot } from "@/lib/external/fda-analytics.functions";
import { aggregateSeries, comparePeriods, facetBreakdown } from "@/lib/fda-analytics/analysis";
import type {
  FdaAnalyticsDataset,
  FdaAnalyticsFacet,
  FdaAnalyticsSnapshot,
  FdaDateRange,
  FdaGranularity,
} from "@/lib/fda-analytics/types";
import type { MonitoringSearch } from "@/components/regulatory/monitoringView";
import { actionClass, fieldClass, LoadError } from "@/components/regulatory/RegulatoryPrimitives";
import {
  ChartCard,
  ChartUnavailable,
  DistributionChart,
  GroupedDistributionChart,
  Sparkline,
  TimelineChart,
} from "./FdaCharts";
import { FDA_COLORS, numberLabel, type ChartSeries } from "./chartView";
import {
  analyticsDatasetRanges,
  datasetAt,
  domainDatasets,
  FDA_DOMAINS,
  FDA_DOMAIN_LABELS,
  FDA_PERIODS,
  facetScopeLabel,
  findFacet,
  granularityLabel,
  isInventory,
  percentChangeLabel,
  selectedAnalyticsRange,
  snapshotAgeLabel,
} from "./analyticsView";
import { FdaCoverageSheet } from "./FdaCoverageSheet";
import { FdaCsvDownload } from "./FdaCsvDownload";
import { exportFdaChartCsv } from "./exportData";

type Props = { search: MonitoringSearch; onSearch: (next: MonitoringSearch) => void };
const KPI_ENDPOINTS = [
  ["drug/enforcement", "Drug recalls"],
  ["device/enforcement", "Device recalls"],
  ["food/enforcement", "Food recalls"],
  ["drug/event", "Drug adverse reports"],
  ["device/event", "Device adverse reports"],
  ["food/event", "Food adverse reports"],
  ["device/510k", "510(k) decisions"],
  ["device/pma", "PMA decisions"],
] as const;

export function FdaDashboard({ search, onSearch }: Props) {
  const data = useQuery({
    queryKey: ["fda-analytics-snapshot"],
    queryFn: () => getFdaAnalyticsSnapshot(),
    staleTime: 60_000,
    refetchInterval: 300_000,
    retry: 1,
  });
  const snapshot = data.data?.snapshot;
  const [coverage, setCoverage] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });
  const [preparedExport, setPreparedExport] = useState<{ text: string; filename: string } | null>(
    null,
  );
  const domain = search.analyticsDomain ?? "overview";
  const interval = search.analyticsInterval ?? "week";
  const period = search.analyticsPeriod ?? "1y";
  const range = snapshot ? selectedAnalyticsRange(search, snapshot.window) : null;
  const ranges = snapshot && range ? analyticsDatasetRanges(snapshot.datasets, range, period) : {};
  const set = (patch: Partial<MonitoringSearch>) => onSearch({ ...search, ...patch });
  function source(dataset?: FdaAnalyticsDataset) {
    setCoverage({ open: true, id: dataset?.id ?? null });
  }
  return (
    <div className="space-y-2" aria-label="FDA analytics dashboard">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-border bg-surface p-2">
        <div
          className="flex max-w-full flex-wrap items-center gap-1"
          role="group"
          aria-label="Analytics date range"
        >
          {FDA_PERIODS.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() =>
                set({
                  analyticsPeriod: choice,
                  ...(choice === "custom" && range
                    ? { analyticsFrom: range.from, analyticsTo: range.to }
                    : {}),
                })
              }
              aria-pressed={period === choice}
              className={`min-h-10 rounded px-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 ${period === choice ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {choice === "custom" ? "Custom" : choice.toUpperCase()}
            </button>
          ))}
          <span className="mx-1 h-5 border-l border-border" aria-hidden />
          <label className="sr-only" htmlFor="fda-interval">
            Chart interval
          </label>
          <select
            id="fda-interval"
            className="min-h-10 rounded border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring sm:min-h-8"
            value={interval}
            onChange={(event) => set({ analyticsInterval: event.target.value as FdaGranularity })}
          >
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {snapshot && (
            <>
              <span
                title={`Snapshot captured ${snapshot.generatedAt}; source publication/release dates differ by dataset.`}
                className="inline-flex items-center gap-1.5"
              >
                <span
                  className={`size-1.5 rounded-full ${Date.now() - Date.parse(snapshot.generatedAt) > 86400000 ? "bg-amber-500" : "bg-teal-600"}`}
                  aria-hidden
                />
                {snapshotAgeLabel(snapshot.generatedAt)}
              </span>
              <span className="hidden sm:inline">·</span>
              <span>
                {snapshot.datasets.filter((dataset) => dataset.status === "ready").length}/
                {snapshot.datasets.length} datasets ready
              </span>
            </>
          )}
          <button
            type="button"
            className="flex min-h-10 items-center gap-1 rounded px-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 sm:min-h-8"
            onClick={() => void data.refetch()}
            disabled={data.isFetching}
            aria-label="Refresh protected FDA snapshot"
            title="Check for the latest collected FDA snapshot"
          >
            <RefreshCw
              aria-hidden
              className={`size-3.5 ${data.isFetching ? "animate-spin" : ""}`}
            />
            {data.isFetching ? "Refreshing" : "Refresh"}
          </button>
          <button
            type="button"
            className="flex min-h-10 items-center gap-1 rounded px-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 sm:min-h-8"
            disabled={
              !snapshot || !range || Date.parse(range.to) - Date.parse(range.from) > 729 * 86400000
            }
            onClick={() => {
              if (snapshot && range)
                setPreparedExport({
                  text: exportFdaChartCsv(
                    domainDatasets(snapshot.datasets, domain),
                    range,
                    interval,
                    ranges,
                  ),
                  filename: `fda-${domain}-${period}-${interval}-${snapshot.generatedAt.slice(0, 10)}.csv`,
                });
            }}
          >
            <Download className="size-3.5" aria-hidden />
            Export
          </button>
          <button
            type="button"
            className="flex min-h-10 items-center gap-1 rounded px-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:min-h-8"
            onClick={() => source()}
            disabled={!snapshot}
          >
            <Info className="size-3.5" aria-hidden />
            Sources
          </button>
        </div>
      </div>
      {preparedExport && (
        <div className="rounded-md border border-border p-2">
          <div className="mb-1 flex justify-between gap-2 text-xs">
            <span>Chart data prepared with source units and date scopes.</span>
            <button
              type="button"
              onClick={() => setPreparedExport(null)}
              className="min-h-8 text-primary underline"
            >
              Close export
            </button>
          </div>
          <FdaCsvDownload text={preparedExport.text} filename={preparedExport.filename} />
        </div>
      )}
      {search.analyticsPeriod === "custom" && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
          <label className="text-xs">
            From
            <input
              type="date"
              aria-label="Analytics from date"
              className={`${fieldClass} mt-1`}
              value={search.analyticsFrom ?? ""}
              onChange={(event) => set({ analyticsFrom: event.target.value })}
            />
          </label>
          <label className="text-xs">
            Through
            <input
              type="date"
              aria-label="Analytics through date"
              className={`${fieldClass} mt-1`}
              value={search.analyticsTo ?? ""}
              onChange={(event) => set({ analyticsTo: event.target.value })}
            />
          </label>
          <p className="pb-2 text-xs text-muted-foreground">
            Up to 730 days. Category charts need an exact captured window.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="FDA product domains" className="flex max-w-full flex-wrap gap-1">
          {FDA_DOMAINS.map((item) => (
            <button
              type="button"
              key={item}
              aria-current={domain === item ? "page" : undefined}
              className={`min-h-10 rounded border px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 ${domain === item ? "border-primary/30 bg-primary/10 font-semibold text-primary" : "border-transparent text-muted-foreground hover:bg-muted"}`}
              onClick={() => set({ analyticsDomain: item })}
            >
              {FDA_DOMAIN_LABELS[item]}
            </button>
          ))}
        </nav>
        {range && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {period === "custom"
              ? `${range.from} – ${range.to} · UTC`
              : "Dates vary by source · UTC"}
          </p>
        )}
      </div>
      {data.isError && (
        <LoadError retry={() => void data.refetch()}>
          {snapshot
            ? "Refresh failed. The retained snapshot below has not changed."
            : "The protected FDA snapshot could not be loaded. Counts are unavailable."}
        </LoadError>
      )}
      {data.isPending ? (
        <DashboardSkeleton />
      ) : !snapshot && !data.isError ? (
        <div className="flex min-h-60 flex-col items-center justify-center gap-2 rounded-md border border-border bg-surface p-4 text-center">
          <Database className="size-6 text-muted-foreground" aria-hidden />
          <h2 className="text-base font-semibold">No verified FDA snapshot is published</h2>
          <p className="max-w-lg text-sm text-muted-foreground">
            Charts will appear when a protected aggregate capture is available.
          </p>
          <button
            type="button"
            className={`${actionClass} mt-1`}
            onClick={() => void data.refetch()}
          >
            Check again
          </button>
        </div>
      ) : snapshot && (!range || Date.parse(range.to) - Date.parse(range.from) > 729 * 86400000) ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-md border border-amber-500/40 p-3 text-sm"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          Choose a valid start and end date covering no more than 730 days.
        </p>
      ) : snapshot && range ? (
        <DashboardCharts
          snapshot={snapshot}
          range={range}
          ranges={ranges}
          domain={domain}
          interval={interval}
          onSource={source}
        />
      ) : null}
      {snapshot && (
        <FdaCoverageSheet
          snapshot={snapshot}
          selectedId={coverage.id}
          open={coverage.open}
          onOpenChange={(open) => setCoverage((prior) => ({ ...prior, open }))}
        />
      )}
    </div>
  );
}

function DashboardCharts({
  snapshot,
  range,
  ranges,
  domain,
  interval,
  onSource,
}: {
  snapshot: FdaAnalyticsSnapshot;
  range: FdaDateRange;
  ranges: Record<string, FdaDateRange>;
  domain: NonNullable<MonitoringSearch["analyticsDomain"]>;
  interval: FdaGranularity;
  onSource: (dataset?: FdaAnalyticsDataset) => void;
}) {
  const datasets = domainDatasets(snapshot.datasets, domain);
  const recall = ["drug", "device", "food"]
    .map((family) => datasetAt(datasets, `${family}/enforcement`))
    .filter((dataset): dataset is FdaAnalyticsDataset => !!dataset);
  const events = datasets.filter(
    (dataset) =>
      /\/event(?:\.json)?$/.test(dataset.endpoint) &&
      (domain !== "overview" || ["drug", "device", "food"].includes(dataset.productFamily)),
  );
  const eventTimelines = events.filter(
    (dataset) => dataset.series && (dataset.series.complete || dataset.series.points.length > 0),
  );
  const unavailableEvents = events.filter((dataset) => !eventTimelines.includes(dataset));
  const decisions = [datasetAt(datasets, "device/510k"), datasetAt(datasets, "device/pma")].filter(
    (dataset): dataset is FdaAnalyticsDataset => !!dataset,
  );
  const inventory = datasets.filter(isInventory);
  const temporal = datasets.filter(
    (dataset) =>
      !!dataset.series &&
      !recall.includes(dataset) &&
      !/\/event(?:\.json)?$/.test(dataset.endpoint) &&
      !decisions.includes(dataset),
  );
  const cards =
    domain === "overview"
      ? KPI_ENDPOINTS.flatMap(([endpoint, label]) => {
          const dataset = datasetAt(datasets, endpoint);
          return dataset ? [{ dataset, label }] : [];
        })
      : datasets
          .filter((dataset) => (domain === "catalog" ? isInventory(dataset) : !!dataset.series))
          .slice(0, 8)
          .map((dataset) => ({ dataset, label: dataset.label }));
  const productCards = events
    .flatMap((dataset) => {
      const facet = findFacet(
        dataset,
        /brand|medicinalproduct|industry|species|tobacco_products/,
        ranges[dataset.id] ?? range,
      );
      return facet ? [{ dataset, facet }] : [];
    })
    .slice(0, domain === "overview" ? 3 : 4);
  return (
    <div className="space-y-2">
      <div
        className={`grid gap-2 ${cards.length === 1 ? "grid-cols-1" : cards.length === 2 ? "grid-cols-1 sm:grid-cols-2" : cards.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 md:grid-cols-4 xl:grid-cols-8"}`}
      >
        {cards.map(({ dataset, label }, index) => (
          <MetricCard
            key={dataset.id}
            dataset={dataset}
            label={label}
            range={ranges[dataset.id] ?? range}
            interval={interval}
            color={FDA_COLORS[index % FDA_COLORS.length]}
            onSource={() => onSource(dataset)}
            inventory={domain === "catalog"}
            horizontal={cards.length === 1}
          />
        ))}
      </div>
      {domain !== "catalog" && (
        <>
          {recall.length > 0 && (
            <div className="grid min-w-0 gap-2 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
              <DatasetTimeline
                datasets={recall}
                range={range}
                ranges={ranges}
                interval={interval}
                title="Recall enforcement activity"
                onSource={onSource}
              />
              <RecallClassification
                datasets={recall}
                range={range}
                ranges={ranges}
                onSource={() => onSource()}
              />
            </div>
          )}
          {unavailableEvents.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
              {unavailableEvents.map((dataset) => (
                <button
                  key={dataset.id}
                  type="button"
                  className="min-h-8 text-left underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                  title={dataset.statusReason ?? "No verified date series is available."}
                  onClick={() => onSource(dataset)}
                >
                  {dataset.label}: timeline unavailable · source details
                </button>
              ))}
            </div>
          )}
          {eventTimelines.length > 0 && (
            <div
              className={`grid min-w-0 gap-2 ${eventTimelines.length > 2 ? "xl:grid-cols-3" : eventTimelines.length === 2 ? "xl:grid-cols-2" : ""}`}
            >
              {eventTimelines.map((dataset) => (
                <DatasetTimeline
                  key={dataset.id}
                  datasets={[dataset]}
                  range={range}
                  ranges={ranges}
                  interval={interval}
                  title={dataset.label}
                  onSource={onSource}
                />
              ))}
            </div>
          )}
          {productCards.length > 0 && (
            <div
              className={`grid min-w-0 gap-2 ${productCards.length > 2 ? "xl:grid-cols-3" : productCards.length === 2 ? "xl:grid-cols-2" : ""}`}
            >
              {productCards.map(({ dataset, facet }) => (
                <FacetCard
                  key={`${dataset.id}:${facet.id}`}
                  dataset={dataset}
                  facet={facet}
                  range={ranges[dataset.id] ?? range}
                  title={`${dataset.productFamily === "animal_veterinary" ? "Veterinary" : dataset.productFamily[0]!.toUpperCase() + dataset.productFamily.slice(1)} · ${facet.label}`}
                  onSource={() => onSource(dataset)}
                />
              ))}
            </div>
          )}
          {events.length > 0 && (
            <div
              className={`grid min-w-0 gap-2 ${events.length > 2 ? "xl:grid-cols-3" : events.length === 2 ? "xl:grid-cols-2" : ""}`}
            >
              {events.map((dataset) => {
                const actualRange = ranges[dataset.id] ?? range;
                const facet = findFacet(
                  dataset,
                  /outcome|serious|event_type|reaction|reported_health/,
                  actualRange,
                );
                return facet ? (
                  <FacetCard
                    key={dataset.id}
                    dataset={dataset}
                    facet={facet}
                    range={actualRange}
                    title={`${dataset.productFamily === "animal_veterinary" ? "Veterinary" : dataset.productFamily[0]!.toUpperCase() + dataset.productFamily.slice(1)} · ${facet.label}`}
                    onSource={() => onSource(dataset)}
                  />
                ) : null;
              })}
            </div>
          )}
          {decisions.length > 0 && (
            <div className={`grid min-w-0 gap-2 ${decisions.length > 1 ? "xl:grid-cols-2" : ""}`}>
              {decisions.map((dataset) => (
                <DatasetTimeline
                  key={dataset.id}
                  datasets={[dataset]}
                  range={range}
                  ranges={ranges}
                  interval={interval}
                  title={dataset.label}
                  onSource={onSource}
                />
              ))}
            </div>
          )}
          {temporal.length > 0 && (
            <div className={`grid min-w-0 gap-2 ${temporal.length > 1 ? "xl:grid-cols-2" : ""}`}>
              {temporal.map((dataset) => (
                <DatasetTimeline
                  key={dataset.id}
                  datasets={[dataset]}
                  range={range}
                  ranges={ranges}
                  interval={interval}
                  title={dataset.label}
                  onSource={onSource}
                />
              ))}
            </div>
          )}
          {[...decisions, ...temporal].some((dataset) => dataset.facets.length > 0) && (
            <div className="grid min-w-0 gap-2 xl:grid-cols-3">
              {[...decisions, ...temporal].flatMap((dataset) => {
                const actualRange = ranges[dataset.id] ?? range;
                const fields = [...new Set(dataset.facets.map((facet) => facet.field))].slice(0, 2);
                return fields.flatMap((field) => {
                  const candidates = dataset.facets.filter((facet) => facet.field === field);
                  const facet =
                    candidates.find(
                      (item) =>
                        item.scope.kind === "window" &&
                        item.scope.from === actualRange.from &&
                        item.scope.to === actualRange.to,
                    ) ?? candidates[0];
                  return facet
                    ? [
                        <FacetCard
                          key={`${dataset.id}:${field}`}
                          dataset={dataset}
                          facet={facet}
                          range={actualRange}
                          title={`${dataset.label} · ${facet.label}`}
                          onSource={() => onSource(dataset)}
                        />,
                      ]
                    : [];
                });
              })}
            </div>
          )}
        </>
      )}
      {inventory.length > 0 && <InventoryPanel datasets={inventory} onSource={onSource} />}
      {!datasets.length && (
        <ChartUnavailable reason="This product domain has no retained dataset in the current capture." />
      )}
      <p className="px-1 text-xs leading-5 text-muted-foreground">
        Source records and reports · not unique patients, injuries or causal findings. Different
        reporting units stay separate.
      </p>
    </div>
  );
}

function MetricCard({
  dataset,
  label,
  range,
  interval,
  color,
  onSource,
  inventory = false,
  horizontal = false,
}: {
  dataset: FdaAnalyticsDataset;
  label: string;
  range: FdaDateRange;
  interval: FdaGranularity;
  color?: string | undefined;
  onSource: () => void;
  inventory?: boolean;
  horizontal?: boolean;
}) {
  const comparison = useMemo(
    () => (inventory ? null : comparePeriods(dataset, range)),
    [dataset, range, inventory],
  );
  const points = useMemo(
    () =>
      inventory
        ? []
        : aggregateSeries(dataset, range, interval).map((point) => ({
            date: point.start,
            value: point.value,
          })),
    [dataset, range, interval, inventory],
  );
  const delta = percentChangeLabel(comparison?.percentChange ?? null);
  const value = inventory ? dataset.total.value : comparison?.current.value;
  return (
    <section
      className={`relative min-w-0 rounded-md border border-border bg-surface px-2.5 py-2 ${horizontal ? "grid grid-cols-2 items-center gap-x-4 gap-y-1 pr-8 sm:grid-cols-[minmax(8rem,1fr)_minmax(7rem,1fr)_auto_minmax(5rem,1fr)_auto]" : ""}`}
      aria-label={label}
    >
      <div className={horizontal ? "col-span-2 sm:col-span-1" : "min-h-8 pr-4"}>
        <h3 className="min-w-0 text-xs font-medium leading-4 text-muted-foreground">{label}</h3>
        <button
          type="button"
          className="absolute right-0 top-0 flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          onClick={onSource}
          aria-label={`Source details for ${label}`}
          title={`Publisher release: ${dataset.sourceUpdatedAt ?? "Not recorded"}. Retrieved: ${dataset.retrievedAt}. ${dataset.qualification}`}
        >
          <Info className="size-3" aria-hidden />
        </button>
      </div>
      <div className="min-w-0">
        <div
          className={`font-semibold tabular-nums tracking-tight ${value === null || value === undefined ? "text-base leading-7" : "text-[clamp(1rem,1.6vw,1.5rem)] leading-7"}`}
        >
          {numberLabel(value)}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={dataset.countUnit}>
          {dataset.countUnit}
        </p>
      </div>
      {!inventory && (
        <p
          className="mt-0.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
          title={`${range.from} through ${range.to}`}
        >
          Through {range.to}
        </p>
      )}
      {!inventory && (
        <div className="min-w-0">
          <Sparkline points={points} color={color} />
        </div>
      )}
      <p
        className="mt-1 truncate text-xs leading-4"
        title={
          comparison
            ? `${comparison.reason} Prior window: ${comparison.previous.range.from} through ${comparison.previous.range.to}. Prior count: ${numberLabel(comparison.previous.value)}.`
            : "Current inventory, independent of the selected date range."
        }
      >
        {inventory ? (
          <span className="text-muted-foreground">
            {dataset.total.scope === "inventory" ? "Current inventory" : "All-time records"}
          </span>
        ) : delta ? (
          <>
            <span className="font-semibold text-primary">{delta}</span>
            <span className="text-muted-foreground"> vs prior</span>
          </>
        ) : comparison?.comparable && comparison.previous.value === 0 ? (
          <span className="text-muted-foreground">
            Prior count 0 · Δ {numberLabel(comparison.absoluteChange)}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {comparison?.current.complete ? "Prior unavailable" : "Incomplete coverage"}
          </span>
        )}
      </p>
    </section>
  );
}

function DatasetTimeline({
  datasets,
  range,
  ranges,
  interval,
  title,
  onSource,
}: {
  datasets: FdaAnalyticsDataset[];
  range: FdaDateRange;
  ranges: Record<string, FdaDateRange>;
  interval: FdaGranularity;
  title: string;
  onSource: (dataset?: FdaAnalyticsDataset) => void;
}) {
  const series: ChartSeries[] = datasets.map((dataset) => {
    const actualRange = ranges[dataset.id] ?? range;
    return {
      id: dataset.id,
      label:
        datasets.length > 1
          ? `${dataset.productFamily[0]!.toUpperCase() + dataset.productFamily.slice(1)} · thru ${actualRange.to}`
          : dataset.label,
      points: aggregateSeries(dataset, actualRange, interval).map((point) => ({
        date: point.start,
        value: point.value,
        end: point.end,
        partial: point.partial,
      })),
    };
  });
  const sameUnit = new Set(datasets.map((dataset) => dataset.countUnit)).size === 1;
  const unit = datasets[0]?.countUnit ?? "Source records";
  const firstRange = datasets[0] ? (ranges[datasets[0].id] ?? range) : range;
  return (
    <ChartCard
      title={title}
      subtitle={`${unit} · ${granularityLabel(interval)}${datasets.length === 1 ? ` · ${firstRange.from}–${firstRange.to}` : " · source-aligned windows"}`}
      onSource={() => onSource(datasets.length === 1 ? datasets[0] : undefined)}
      footnote={`${datasets[0]?.series?.dateMeaning ?? "Date basis not recorded"}. Edge buckets may be partial; missing coverage remains a gap.`}
    >
      {sameUnit ? (
        <TimelineChart series={series} unit={unit} />
      ) : (
        <ChartUnavailable reason="These datasets have different counting units and cannot share a count axis." />
      )}
    </ChartCard>
  );
}

function FacetCard({
  dataset,
  facet,
  range,
  title,
  onSource,
  fixedScope = false,
}: {
  dataset: FdaAnalyticsDataset;
  facet: FdaAnalyticsFacet;
  range?: FdaDateRange;
  title: string;
  onSource: () => void;
  fixedScope?: boolean;
}) {
  const result = facetBreakdown(facet, fixedScope ? undefined : range);
  return (
    <ChartCard
      title={title}
      subtitle={`${facet.countUnit} · ${fixedScope ? facetScopeLabel(facet) : range ? `${range.from}–${range.to}` : "Date window not recorded"}`}
      onSource={onSource}
      footnote={
        result.available ? (
          <span title={`${result.reason} ${facet.qualification}`}>
            {facet.multiValued ? "Categories overlap" : "Recorded categories"} ·{" "}
            {facet.truncated || !facet.exhaustive || result.buckets.length > 8
              ? `Top ${Math.min(8, result.buckets.length)} categories; no normalized percentages`
              : "Complete category capture"}
          </span>
        ) : undefined
      }
    >
      {result.available ? (
        <DistributionChart
          bars={result.buckets.slice(0, 8).map((bucket) => ({
            label: bucket.label,
            value: bucket.count,
            percent: bucket.percent,
          }))}
          unit={facet.countUnit}
          color={
            FDA_COLORS[
              dataset.productFamily === "device" ? 0 : dataset.productFamily === "food" ? 2 : 1
            ]
          }
        />
      ) : (
        <ChartUnavailable reason={result.reason} />
      )}
    </ChartCard>
  );
}

function RecallClassification({
  datasets,
  range,
  ranges,
  onSource,
}: {
  datasets: FdaAnalyticsDataset[];
  range: FdaDateRange;
  ranges: Record<string, FdaDateRange>;
  onSource: () => void;
}) {
  const captured = datasets.flatMap((dataset) => {
    const actualRange = ranges[dataset.id] ?? range;
    const facet = findFacet(dataset, /classification/, actualRange);
    if (!facet) return [];
    const result = facetBreakdown(facet, actualRange);
    return result.available ? [{ dataset, facet, result, actualRange }] : [];
  });
  const keys = [
    ...new Set(captured.flatMap(({ result }) => result.buckets.map((bucket) => bucket.key))),
  ];
  const categories = keys.map((key, index) => ({
    id: `class${index}`,
    label:
      captured.flatMap(({ result }) => result.buckets).find((bucket) => bucket.key === key)
        ?.label ?? key,
  }));
  const groups = captured.map(({ dataset, result, actualRange }) =>
    Object.assign(
      {
        label: `${dataset.productFamily[0]!.toUpperCase() + dataset.productFamily.slice(1)} · ${actualRange.to}`,
      },
      Object.fromEntries(
        keys.map((key, index) => [
          `class${index}`,
          result.buckets.find((bucket) => bucket.key === key)?.count ?? null,
        ]),
      ),
    ),
  );
  return (
    <ChartCard
      title="Recall classifications"
      subtitle="Enforcement records · source-aligned periods"
      onSource={onSource}
      footnote={`${captured.length}/${datasets.length} product families with exact scoped captures. No normalized percentages.`}
    >
      {groups.length ? (
        <GroupedDistributionChart
          groups={groups}
          categories={categories}
          unit="Enforcement records"
        />
      ) : (
        <ChartUnavailable reason="No classification capture matches this exact date range." />
      )}
    </ChartCard>
  );
}

function InventoryPanel({
  datasets,
  onSource,
}: {
  datasets: FdaAnalyticsDataset[];
  onSource: (dataset?: FdaAnalyticsDataset) => void;
}) {
  return (
    <section className="space-y-2" aria-label="FDA catalog inventories">
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <h2 className="font-sans text-sm font-semibold">Catalog & source inventories</h2>
        <span className="text-xs text-muted-foreground">
          Snapshot scope · independent of date selection
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {datasets.map((dataset) => (
          <button
            key={dataset.id}
            type="button"
            onClick={() => onSource(dataset)}
            className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-left hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="block text-xs text-muted-foreground">{dataset.label}</span>
            <span className="mt-1 block text-xl font-semibold tabular-nums">
              {numberLabel(dataset.total.value)}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {dataset.countUnit} · {dataset.total.scope === "inventory" ? "inventory" : "all time"}
            </span>
          </button>
        ))}
      </div>
      <div className="grid gap-2 xl:grid-cols-3">
        {datasets.flatMap((dataset) =>
          dataset.facets
            .filter((facet) => facet.scope.kind !== "window")
            .slice(0, 1)
            .map((facet) => (
              <FacetCard
                key={`${dataset.id}:${facet.id}`}
                dataset={dataset}
                facet={facet}
                title={`${dataset.label} · ${facet.label}`}
                onSource={() => onSource(dataset)}
                fixedScope
              />
            )),
        )}
      </div>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading FDA aggregate charts" className="space-y-2">
      <span className="sr-only">Loading verified FDA aggregate charts…</span>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-md border border-border bg-muted/40"
          />
        ))}
      </div>
      <div className="grid gap-2 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <div className="h-[310px] animate-pulse rounded-md border border-border bg-muted/30" />
        <div className="h-[310px] animate-pulse rounded-md border border-border bg-muted/30" />
      </div>
    </div>
  );
}
