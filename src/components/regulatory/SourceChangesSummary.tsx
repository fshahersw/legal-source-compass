/**
 * Answer-first header for the Source changes view: what the monitors detected in the last 30 days (KPIs and a daily
 * stacked column chart by kind of change), which sources hold the records, and one-click source-family filters.
 * Counts are stored source-version events by first-detected date, not incidents or risk.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarTrend } from "@/components/charts/BarTrend";
import { ChartCard, type TableSpec } from "@/components/charts/ChartCard";
import { metricFormatter } from "@/components/charts/format";
import { BarList } from "@/components/kit/BarList";
import { KpiStrip } from "@/components/kit/KpiCard";
import { AiSummary, buildSectionContext } from "@/components/kit/ai";
import { getRegulatoryTrends } from "@/lib/external/regulatory.functions";
import type {
  RegulatoryOverview,
  RegulatorySource,
  RegulatorySourceFamily,
  RegulatorySourceId,
  RegulatoryTrend,
} from "@/lib/regulatory/types";
import { cn } from "@/lib/utils";
import { changeMonitoringFilters, type MonitoringSearch } from "./monitoringView";
import { FAMILY_LABELS, sourceFamilyOf, trendSummary, type TrendSummary } from "./sourceChanges";

const COUNT = metricFormatter("count");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (iso: string) =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
const shortDay = (iso: string) =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${Number(iso.slice(8, 10))}`;
const n = (value: number) => value.toLocaleString("en-US");

function utcDay(offset: number, now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset))
    .toISOString()
    .slice(0, 10);
}

export function SourceChangesSummary({
  search,
  overview,
  onSearch,
}: {
  search: MonitoringSearch;
  overview: RegulatoryOverview | undefined;
  onSearch: (next: MonitoringSearch) => void;
}) {
  const span = useMemo(() => ({ from: utcDay(-29), to: utcDay(0) }), []);
  const scope = {
    ...(search.sourceFamily ? { sourceFamily: search.sourceFamily } : {}),
    ...(search.source ? { source: search.source as RegulatorySourceId } : {}),
  };
  const trends = useQuery({
    queryKey: ["regulatory-trends", span, scope],
    queryFn: () =>
      getRegulatoryTrends({ data: { ...span, dateBasis: "detected" as const, ...scope } }),
    staleTime: 60_000,
  });
  const summary = trends.data ? trendSummary(trends.data) : null;
  const sources = (overview?.sources ?? []).filter(
    (source) =>
      (!search.sourceFamily || sourceFamilyOf(source.id) === search.sourceFamily) &&
      (!search.source || source.id === search.source),
  );
  const families = familyTotals(overview?.sources ?? []);
  const scopeLabel = search.source
    ? (overview?.sources.find((source) => source.id === search.source)?.label ?? "This source")
    : search.sourceFamily
      ? FAMILY_LABELS[search.sourceFamily]
      : "All monitored sources";
  const context = useMemo(
    () =>
      summary
        ? buildSectionContext({
            title: "Source changes detected in the last 30 days",
            scope: scopeLabel,
            period: `${dayText(span.from)} – ${dayText(span.to)}`,
            source: "Stored source-version events",
            figures: [
              { label: "Events detected, last 7 days", value: summary.last7, unit: "events" },
              { label: "Events detected, last 30 days", value: summary.total, unit: "events" },
              { label: "Newly observed records", value: summary.newRecords, unit: "events" },
              { label: "First captures and backfills", value: summary.initial, unit: "events" },
              { label: "Source changes and corrections", value: summary.changes, unit: "events" },
              ...(summary.peak
                ? [
                    {
                      label: "Busiest day",
                      value: summary.peak.events,
                      unit: "events",
                      period: summary.peak.day,
                    },
                  ]
                : []),
              ...sources.slice(0, 8).map((source) => ({
                label: `${source.label} records held`,
                value: source.records,
                unit: "records",
              })),
            ],
          })
        : null,
    [summary, sources, scopeLabel, span],
  );
  return (
    <section aria-label="Source changes summary" className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Source family">
        <FamilyChip
          active={!search.sourceFamily && !search.source}
          label="All sources"
          count={families.all}
          onClick={() =>
            onSearch(
              changeMonitoringFilters(search, { sourceFamily: undefined, source: undefined }),
            )
          }
        />
        {(Object.keys(FAMILY_LABELS) as RegulatorySourceFamily[]).map((family) => (
          <FamilyChip
            key={family}
            active={search.sourceFamily === family && !search.source}
            label={FAMILY_LABELS[family]}
            count={families[family]}
            onClick={() =>
              onSearch(changeMonitoringFilters(search, { sourceFamily: family, source: undefined }))
            }
          />
        ))}
      </div>
      <KpiStrip
        label="Source changes, last 30 days"
        cellBasis="basis-[calc(50%-1px)] md:basis-[calc(20%-1px)]"
        items={[
          {
            key: "7d",
            label: "Detected, last 7 days",
            value: summary ? n(summary.last7) : undefined,
            meta: summary ? `${shortDay(utcDay(-6))} – ${shortDay(span.to)}` : undefined,
            state: trends.isPending ? "loading" : trends.isError ? "error" : "ready",
            onRetry: () => void trends.refetch(),
          },
          {
            key: "30d",
            label: "Detected, last 30 days",
            value: summary ? n(summary.total) : undefined,
            meta: summary ? `${n(summary.activeDays)} of 30 days with any detection` : undefined,
            state: trends.isPending ? "loading" : trends.isError ? "error" : "ready",
          },
          {
            key: "new",
            label: "Newly observed records",
            value: summary ? n(summary.newRecords) : undefined,
            meta: "records the monitors had not seen before",
            state: trends.isPending ? "loading" : trends.isError ? "error" : "ready",
          },
          {
            key: "changed",
            label: "Changes and corrections",
            value: summary ? n(summary.changes) : undefined,
            meta: "a stored record's text or fields changed",
            state: trends.isPending ? "loading" : trends.isError ? "error" : "ready",
          },
          {
            key: "sources",
            label: "Sources in scope",
            value: overview ? n(sources.length) : undefined,
            meta: overview
              ? `${n(sources.reduce((sum, source) => sum + source.records, 0))} records held`
              : undefined,
            state: overview ? "ready" : "loading",
          },
        ]}
      />
      <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <DailyChart
          trend={trends.data}
          summary={summary}
          scope={scopeLabel}
          state={trends.isPending ? "loading" : trends.isError ? "error" : "ready"}
          onRetry={() => void trends.refetch()}
        />
        <SourcesChart sources={sources} search={search} overviewReady={!!overview} />
      </div>
      <AiSummary context={context} />
    </section>
  );
}

function familyTotals(sources: readonly RegulatorySource[]) {
  const totals: Record<RegulatorySourceFamily | "all", number> = {
    all: 0,
    fda: 0,
    nhtsa: 0,
    cpsc: 0,
    federal_register: 0,
  };
  for (const source of sources) {
    totals.all += source.records;
    totals[sourceFamilyOf(source.id)] += source.records;
  }
  return totals;
}

function FamilyChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-surface text-foreground/80 hover:bg-muted",
      )}
    >
      {label}
      <span
        className={cn(
          "tabular-nums text-[12px]",
          active ? "text-primary-foreground/80" : "text-muted-foreground",
        )}
      >
        {count.toLocaleString("en-US")}
      </span>
    </button>
  );
}

const SERIES = [
  { id: "newRecords", label: "Newly observed" },
  { id: "changes", label: "Changed or corrected" },
  { id: "initial", label: "First capture or backfill" },
] as const;

function DailyChart({
  trend,
  summary,
  scope,
  state,
  onRetry,
}: {
  trend: RegulatoryTrend | undefined;
  summary: TrendSummary | null;
  scope: string;
  state: "loading" | "error" | "ready";
  onRetry: () => void;
}) {
  const keys = trend?.points.map((point) => point.day) ?? [];
  const series = SERIES.map((item) => ({
    id: item.id,
    label: item.label,
    points: (summary?.days ?? []).map((day) => ({ key: day.day, value: day[item.id] })),
  }));
  const title =
    summary && summary.total > 0
      ? `${n(summary.total)} source events detected in 30 days${summary.peak ? `; busiest day ${shortDay(summary.peak.day)} with ${n(summary.peak.events)}` : ""}`
      : "Source events detected per day";
  const table: TableSpec | undefined = summary
    ? {
        caption: `${title}. ${scope}. Stored source-version events by first-detected date (UTC).`,
        columns: [
          { label: "Day" },
          ...SERIES.map((item) => ({ label: item.label, align: "right" as const })),
          { label: "All events", align: "right" },
        ],
        rows: summary.days.map((day) => ({
          key: day.day,
          cells: [
            dayText(day.day),
            n(day.newRecords),
            n(day.changes),
            n(day.initial),
            n(day.events),
          ],
        })),
      }
    : undefined;
  return (
    <ChartCard
      title={title}
      subtitle={`${scope} · stored source events per day by kind · first-detected date, UTC`}
      status={
        state === "loading"
          ? { kind: "loading" }
          : state === "error"
            ? { kind: "error", message: "Daily counts could not be read just now.", onRetry }
            : summary && summary.total === 0
              ? { kind: "empty", reason: "No stored event matches in the last 30 days." }
              : undefined
      }
      table={table}
      period={keys.length ? `${dayText(keys[0]!)} – ${dayText(keys.at(-1)!)}` : undefined}
      about={
        <div className="space-y-2">
          <p>
            Each bar counts stored source-version events on the day a monitor first detected them. A
            first capture or backfill is a record seen when a monitor started or reached back in
            time, so a large first day reflects the start of collection, not a burst of activity.
          </p>
          <p>{trend?.qualification}</p>
        </div>
      }
      minHeight={220}
    >
      <BarTrend
        series={series}
        axis={{
          keys,
          label: (key) => dayText(key),
          tick: (key) => shortDay(key),
        }}
        formatter={COUNT}
        unit="events"
        stacked
        ariaLabel={`${title}. Daily stacked counts by kind of event.`}
        height={220}
      />
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-meta text-muted-foreground">
        {SERIES.map((item, index) => (
          <span key={item.id} className="inline-flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-[2px]"
              style={{ background: `var(--chart-${index + 1})` }}
              aria-hidden
            />
            {item.label}
          </span>
        ))}
      </p>
    </ChartCard>
  );
}

function SourcesChart({
  sources,
  search,
  overviewReady,
}: {
  sources: readonly RegulatorySource[];
  search: MonitoringSearch;
  overviewReady: boolean;
}) {
  const ranked = [...sources].sort((a, b) => b.records - a.records);
  const top = ranked[0];
  const total = ranked.reduce((sum, source) => sum + source.records, 0);
  const table: TableSpec = {
    caption: "Records held per monitored source, with its agency and covered dates.",
    columns: [
      { label: "Source" },
      { label: "Agency" },
      { label: "Records", align: "right" },
      { label: "Events", align: "right" },
      { label: "Covered from" },
      { label: "Covered to" },
    ],
    rows: ranked.map((source) => ({
      key: source.id,
      cells: [
        source.label,
        source.agency,
        n(source.records),
        n(source.events),
        source.coverageFrom ?? "Not recorded",
        source.coverageTo ?? "Not recorded",
      ],
    })),
  };
  return (
    <ChartCard
      title={
        top && total
          ? `${top.label} holds ${Math.round((100 * top.records) / total)}% of the ${n(total)} records`
          : "Records held by source"
      }
      subtitle="Stored source records · select a source to filter the list"
      status={
        !overviewReady
          ? { kind: "loading" }
          : !ranked.length
            ? { kind: "empty", reason: "No monitored source matches this filter." }
            : undefined
      }
      table={ranked.length ? table : undefined}
      about={
        <p>
          A record is one source document or entry as the monitor stores it; events are its captured
          versions. Coverage dates are the windows the monitor has completed, not the source&apos;s
          full history.
        </p>
      }
      minHeight={200}
    >
      <BarList
        ariaLabel="Records held by source"
        labelWidth="48%"
        items={ranked.map((source) => ({
          id: source.id,
          label: source.label,
          value: source.records,
          display: n(source.records),
          note: source.coverageFrom ? `since ${shortDay(source.coverageFrom)}` : "no capture yet",
          to: "/law/monitoring",
          search: changeMonitoringFilters(search, { source: source.id, view: "signals" }),
        }))}
      />
    </ChartCard>
  );
}
