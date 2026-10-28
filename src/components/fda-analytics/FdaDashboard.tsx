import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Database, Download, Info, RefreshCw } from "lucide-react";
import { getFdaAnalyticsSnapshot } from "@/lib/external/fda-analytics.functions";
import type {
  FdaAnalyticsDataset,
  FdaAnalyticsSnapshot,
  FdaDateRange,
  FdaGranularity,
} from "@/lib/fda-analytics/types";
import type { MonitoringSearch } from "@/components/regulatory/monitoringView";
import { actionClass, fieldClass, LoadError } from "@/components/regulatory/RegulatoryPrimitives";
import { KpiCard, KpiGrid } from "@/components/kit/KpiCard";
import type { FigureInput } from "@/components/kit/ai";
import { ChartUnavailable } from "./FdaCharts";
import { numberLabel } from "./chartView";
import {
  analyticsDatasetRanges,
  datasetAt,
  domainDatasets,
  FDA_DOMAINS,
  FDA_DOMAIN_LABELS,
  FDA_PERIODS,
  isInventory,
  selectedAnalyticsRange,
  snapshotAgeLabel,
  type FdaDashboardDomain,
} from "./analyticsView";
import {
  CategoryCard,
  ClassMixCard,
  DatasetTiles,
  FdaKpis,
  FindingsCard,
  MoversCard,
  TrendCard,
  type DatasetRef,
} from "./FdaVisuals";
import { dayText, fdaFindings, fdaMovers, signedPercent } from "./insights";
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
          <h2 className="text-heading font-semibold text-foreground">
            No verified FDA snapshot is published
          </h2>
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
          onDomain={(analyticsDomain) => set({ analyticsDomain })}
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

const FAMILY_TAB: Partial<Record<FdaAnalyticsDataset["productFamily"], FdaDashboardDomain>> = {
  device: "devices",
  drug: "drugs",
  food: "food",
  cosmetic: "cosmetics",
  animal_veterinary: "veterinary",
  tobacco: "tobacco",
  transparency: "transparency",
};
const familyName = (dataset: FdaAnalyticsDataset) =>
  dataset.productFamily === "animal_veterinary"
    ? "Veterinary"
    : dataset.productFamily[0]!.toUpperCase() + dataset.productFamily.slice(1);
const isEnforcement = (dataset: FdaAnalyticsDataset) =>
  /\/enforcement(?:\.json)?$/.test(dataset.endpoint);
const isReport = (dataset: FdaAnalyticsDataset) =>
  /\/(?:event|problem)(?:\.json)?$/.test(dataset.endpoint);
const rangeWords = (range: FdaDateRange) => `${dayText(range.from)} – ${dayText(range.to)}`;

/** One facet per recorded field: the capture for the exact window, else the field's fixed-scope capture. */
function facetsFor(dataset: FdaAnalyticsDataset, range: FdaDateRange, pattern?: RegExp) {
  const fields = [...new Set(dataset.facets.map((facet) => facet.field))].filter(
    (field) => !pattern || pattern.test(field),
  );
  return fields.flatMap((field) => {
    const candidates = dataset.facets.filter((facet) => facet.field === field);
    const facet =
      candidates.find(
        (item) =>
          item.scope.kind === "window" &&
          item.scope.from === range.from &&
          item.scope.to === range.to,
      ) ??
      candidates.find((item) => item.scope.kind !== "window") ??
      candidates[0];
    return facet ? [facet] : [];
  });
}

function DashboardCharts({
  snapshot,
  range,
  ranges,
  domain,
  interval,
  onSource,
  onDomain,
}: {
  snapshot: FdaAnalyticsSnapshot;
  range: FdaDateRange;
  ranges: Record<string, FdaDateRange>;
  domain: FdaDashboardDomain;
  interval: FdaGranularity;
  onSource: (dataset?: FdaAnalyticsDataset) => void;
  onDomain: (domain: FdaDashboardDomain) => void;
}) {
  const datasets = domainDatasets(snapshot.datasets, domain);
  const rangeOf = (dataset: FdaAnalyticsDataset) => ranges[dataset.id] ?? range;
  const ref = (dataset: FdaAnalyticsDataset, label = dataset.label): DatasetRef => ({
    dataset,
    label,
    range: rangeOf(dataset),
  });
  const inventory = datasets.filter(isInventory);
  const series = datasets.filter((dataset) => !!dataset.series && !isInventory(dataset));
  const recalls = ["drug", "device", "food"]
    .map((family) => datasetAt(datasets, `${family}/enforcement`))
    .filter((dataset): dataset is FdaAnalyticsDataset => !!dataset);
  const kpis =
    domain === "overview"
      ? KPI_ENDPOINTS.flatMap(([endpoint, label]) => {
          const dataset = datasetAt(datasets, endpoint);
          return dataset ? [ref(dataset, label)] : [];
        })
      : series.slice(0, 8).map((dataset) => ref(dataset));
  const labels = Object.fromEntries(kpis.map((item) => [item.dataset.id, item.label]));
  const findings = fdaFindings({
    datasets: kpis.map((item) => item.dataset),
    ranges,
    fallback: range,
    labels,
    interval,
  });
  const movers = fdaMovers(kpis);
  const figures: FigureInput[] = movers.flatMap((mover) => [
    {
      label: mover.label,
      value: mover.current,
      unit: mover.unit,
      period: rangeWords(mover.range),
    },
    {
      label: `${mover.label}, change vs prior window`,
      value: signedPercent(mover.percent),
      period: rangeWords(mover.range),
    },
  ]);
  const period = kpis[0]
    ? (FDA_PERIOD_WORDS[periodKey(kpis[0].range)] ?? rangeWords(kpis[0].range))
    : rangeWords(range);

  if (domain === "catalog") return <CatalogView datasets={inventory} onSource={onSource} />;
  if (!datasets.length)
    return (
      <ChartUnavailable reason="This product domain has no retained dataset in the current capture." />
    );

  const overview = domain === "overview";
  const recallLabels = recalls.map((dataset) => ref(dataset, `${familyName(dataset)} recalls`));
  const reportSets = series.filter(isReport);
  const overviewReports = reportSets.filter((dataset) =>
    ["drug", "device", "food"].includes(dataset.productFamily),
  );
  const decisions = [datasetAt(datasets, "device/510k"), datasetAt(datasets, "device/pma")].filter(
    (dataset): dataset is FdaAnalyticsDataset => !!dataset,
  );
  const shown = new Set([...recalls, ...(overview ? [...overviewReports, ...decisions] : [])]);
  const others = series.filter((dataset) => !shown.has(dataset));
  const deviceEvents = datasetAt(datasets, "device/event");
  const outcome = deviceEvents
    ? facetsFor(deviceEvents, rangeOf(deviceEvents), /event_type/)[0]
    : undefined;
  return (
    <div className="space-y-3">
      <FindingsCard
        findings={findings}
        figures={figures}
        scope={FDA_DOMAIN_LABELS[domain].toLowerCase()}
        period={period}
      />
      {kpis.length > 1 && <FdaKpis items={kpis} interval={interval} onSource={onSource} />}
      {recalls.length > 0 && (
        <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <TrendCard
            id="fda-recalls"
            items={recallLabels}
            interval={interval}
            onSource={onSource}
            height={recalls.length > 1 ? 300 : 240}
          />
          <ClassMixCard items={recallLabels} onSource={() => onSource(recalls[0])} />
        </div>
      )}
      {overview && (
        <div className="grid min-w-0 items-start gap-3 xl:grid-cols-2">
          <MoversCard movers={movers} onSource={() => onSource()} />
          {deviceEvents && outcome ? (
            <CategoryCard
              dataset={deviceEvents}
              facet={outcome}
              range={rangeOf(deviceEvents)}
              title="Device reports by event type"
              onSource={() => onSource(deviceEvents)}
            />
          ) : null}
        </div>
      )}
      {overview && overviewReports.length > 0 && (
        <section aria-labelledby="fda-reports" className="space-y-2">
          <h2 id="fda-reports" className="px-1 pt-1 text-label font-semibold text-foreground">
            Adverse event reports
          </h2>
          <div className="grid min-w-0 gap-3 xl:grid-cols-3">
            {overviewReports.map((dataset) => {
              const product = facetsFor(
                dataset,
                rangeOf(dataset),
                /brand|medicinalproduct|industry/,
              )[0];
              return (
                <div key={dataset.id} className="flex min-w-0 flex-col gap-3">
                  <TrendCard
                    items={[ref(dataset)]}
                    interval={interval}
                    onSource={onSource}
                    height={180}
                  />
                  {product ? (
                    <CategoryCard
                      dataset={dataset}
                      facet={product}
                      range={rangeOf(dataset)}
                      title={`${familyName(dataset)} reports by ${product.label.toLowerCase()}`}
                      onSource={() => onSource(dataset)}
                      limit={6}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      )}
      {overview && decisions.length > 0 && (
        <section aria-labelledby="fda-decisions" className="space-y-2">
          <h2 id="fda-decisions" className="px-1 pt-1 text-label font-semibold text-foreground">
            Device market decisions
          </h2>
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            {decisions.map((dataset) => {
              const decision = facetsFor(dataset, rangeOf(dataset), /decision_code/)[0];
              return (
                <div key={dataset.id} className="flex min-w-0 flex-col gap-3">
                  <TrendCard
                    items={[ref(dataset)]}
                    interval={interval}
                    onSource={onSource}
                    height={180}
                  />
                  {decision ? (
                    <CategoryCard
                      dataset={dataset}
                      facet={decision}
                      range={rangeOf(dataset)}
                      title={`${dataset.label} by decision`}
                      onSource={() => onSource(dataset)}
                      limit={6}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      )}
      {overview ? (
        <DatasetTiles
          heading="More FDA datasets"
          interval={interval}
          onOpen={(tab) => onDomain(tab as FdaDashboardDomain)}
          items={others.flatMap((dataset) => {
            const tab = FAMILY_TAB[dataset.productFamily];
            return tab ? [{ ...ref(dataset), tab, tabLabel: FDA_DOMAIN_LABELS[tab] }] : [];
          })}
        />
      ) : (
        others.map((dataset) => (
          <DatasetPanel
            key={dataset.id}
            dataset={dataset}
            range={rangeOf(dataset)}
            interval={interval}
            onSource={onSource}
          />
        ))
      )}
      {overview && inventory.length > 0 ? (
        <p className="px-1 text-meta text-muted-foreground">
          {inventory.length} catalog inventories (drug labels, NDC, UDI, registrations and more) are
          on the{" "}
          <button
            type="button"
            className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => onDomain("catalog")}
          >
            Catalog tab
          </button>
          .
        </p>
      ) : inventory.length > 0 ? (
        <CatalogView
          datasets={inventory}
          onSource={onSource}
          heading="Catalog and source inventories"
        />
      ) : null}
      <p className="px-1 text-meta text-muted-foreground">
        Source records and reports, not unique patients, injuries or causal findings. Different
        reporting units stay separate.
      </p>
    </div>
  );
}

const FDA_PERIOD_WORDS: Record<string, string> = {
  "30": "the last 30 days",
  "90": "the last 90 days",
  "365": "the last 12 months",
  "730": "the last 24 months",
};
const periodKey = (range: FdaDateRange) =>
  String(Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1);

/** A dataset's trend beside its category breakdowns. */
function DatasetPanel({
  dataset,
  range,
  interval,
  onSource,
}: {
  dataset: FdaAnalyticsDataset;
  range: FdaDateRange;
  interval: FdaGranularity;
  onSource: (dataset?: FdaAnalyticsDataset) => void;
}) {
  const facets = facetsFor(dataset, range).slice(0, 2);
  return (
    <section
      aria-label={dataset.label}
      className={`grid min-w-0 items-start gap-3 ${facets.length ? "xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : ""}`}
    >
      <TrendCard
        items={[{ dataset, label: dataset.label, range }]}
        interval={interval}
        onSource={onSource}
      />
      {facets.length > 0 && (
        <div className="flex min-w-0 flex-col gap-3">
          {facets.map((facet) => (
            <CategoryCard
              key={facet.id}
              dataset={dataset}
              facet={facet}
              range={range}
              title={`${dataset.label} by ${facet.label.toLowerCase()}`}
              onSource={() => onSource(dataset)}
              limit={facets.length > 1 ? 5 : 8}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Inventories: current totals and their recorded breakdowns, independent of the date selection. */
function CatalogView({
  datasets,
  onSource,
  heading = "Catalog and source inventories",
}: {
  datasets: FdaAnalyticsDataset[];
  onSource: (dataset?: FdaAnalyticsDataset) => void;
  heading?: string;
}) {
  if (!datasets.length)
    return <ChartUnavailable reason="No catalog inventory is retained in the current capture." />;
  return (
    <section className="space-y-3" aria-label="FDA catalog inventories">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pt-1">
        <h2 className="text-label font-semibold text-foreground">{heading}</h2>
        <span className="text-meta text-muted-foreground">
          Current totals · independent of the date range
        </span>
      </div>
      <KpiGrid columns={4}>
        {datasets.map((dataset) => (
          <KpiCard
            key={dataset.id}
            as="li"
            size="sm"
            label={dataset.label}
            value={dataset.total.value === null ? null : numberLabel(dataset.total.value)}
            meta={`${dataset.countUnit} · ${dataset.total.scope === "inventory" ? "current inventory" : "all records"}`}
            action={
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => onSource(dataset)}
                aria-label={`Source details for ${dataset.label}`}
              >
                <Info className="size-3.5" aria-hidden />
              </button>
            }
          />
        ))}
      </KpiGrid>
      <div className="grid min-w-0 gap-3 xl:grid-cols-3">
        {datasets.flatMap((dataset) =>
          dataset.facets
            .filter((facet) => facet.scope.kind !== "window")
            .slice(0, 1)
            .map((facet) => (
              <CategoryCard
                key={`${dataset.id}:${facet.id}`}
                dataset={dataset}
                facet={facet}
                title={`${dataset.label} by ${facet.label.toLowerCase()}`}
                onSource={() => onSource(dataset)}
                limit={6}
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
