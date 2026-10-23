/**
 * /insights/rankings: any metric for any period as a map (states, counties), ranked bars against the national value
 * and the median, the spread of values, the movers between two periods (slope chart) and every entity's history as a
 * heatmap. Ranks are competition ranks among the entities that record a value; the rest are listed as not recorded.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EntityType, Fact, MetricDef } from "@/lib/insights/contract";
import {
  ChartFrame,
  Choropleth,
  DistributionStrip,
  Heatmap,
  RankedBars,
  SlopeChart,
  metricFormatter,
  periodLabel,
  rankItems,
  type RankedItem,
} from "@/components/charts";
import { median } from "@/components/charts/stats";
import {
  CatalogNotice,
  ENTITY_LABEL,
  Field,
  FixtureBanner,
  MetricSelect,
  controlClass,
  metricNotes,
} from "./controls";
import {
  catalogQuery,
  fixturesOn,
  labelsQuery,
  periodsQuery,
  seriesQuery,
  snapshotQuery,
} from "./data";

export type RankingsSearch = {
  type?: EntityType | undefined;
  metric?: string | undefined;
  period?: string | undefined;
  compare?: string | undefined;
  sel?: string | undefined;
};

const valueOf = (facts: readonly Fact[] | undefined) =>
  new Map((facts ?? []).map((f) => [f.entityId, f.value] as const));

export function RankingsView({
  search,
  set,
}: {
  search: RankingsSearch;
  set: (p: Partial<RankingsSearch>) => void;
}) {
  const catalog = useQuery(catalogQuery);
  const type: EntityType = search.type ?? "state";
  const types = useMemo(() => {
    const s = new Set<EntityType>();
    for (const m of catalog.data?.metrics ?? [])
      for (const t of m.entityTypes) if (t !== "nation") s.add(t);
    return [...s];
  }, [catalog.data]);
  const metrics = useMemo(
    () => (catalog.data?.metrics ?? []).filter((m) => m.entityTypes.includes(type)),
    [catalog.data, type],
  );
  const metric: MetricDef | undefined =
    metrics.find((m) => m.id === search.metric) ??
    metrics.find((m) => m.format === "rate_per_100k") ??
    metrics[0];
  const periodsQ = useQuery(periodsQuery(metric, type));
  const periods = useMemo(() => periodsQ.data?.periods ?? [], [periodsQ.data]);
  const period =
    search.period && periods.includes(search.period)
      ? search.period
      : (periodsQ.data?.fallback ?? null);
  const pi = period ? periods.indexOf(period) : -1;
  const compare =
    search.compare && periods.includes(search.compare) && search.compare !== period
      ? search.compare
      : pi > 0
        ? periods[Math.max(0, pi - 5)]!
        : null;
  const snap = useQuery(snapshotQuery(metric, type, period));
  const snapB = useQuery(snapshotQuery(metric, type, compare));
  const nation = useQuery({
    ...snapshotQuery(metric, "nation", period),
    enabled: !!metric && !!period && metric.entityTypes.includes("nation"),
  });
  const ids = useMemo(() => [...new Set((snap.data ?? []).map((f) => f.entityId))], [snap.data]);
  const labels = useQuery(labelsQuery(type, ids));
  const labelOf = (id: string) => labels.data?.get(id)?.label ?? id;
  const span = useMemo(
    () => (pi >= 0 ? periods.slice(Math.max(0, pi - 11), pi + 1) : []),
    [periods, pi],
  );
  const history = useQuery(
    seriesQuery(metric, type, ids, span[0] ?? null, span[span.length - 1] ?? null),
  );
  const historyValue = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const f of history.data ?? []) m.set(`${f.entityId}|${f.period}`, f.value);
    return (row: string, col: string) => m.get(`${row}|${col}`) ?? null;
  }, [history.data]);
  const fmt = metricFormatter(metric?.format ?? "count");
  const plabel = (p: string) => (metric ? periodLabel(p, metric.periodType) : p);
  const words = ENTITY_LABEL[type];

  const items: RankedItem[] = useMemo(
    () =>
      (snap.data ?? []).map((f) => ({
        id: f.entityId,
        label: labelOf(f.entityId),
        value: f.value,
        note:
          f.value === null
            ? (f.notRecordedReason ?? undefined)
            : f.partial
              ? "Partial period"
              : undefined,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap.data, labels.data],
  );
  const usValue = nation.data?.find((f) => f.entityId === "US")?.value ?? null;
  const med = median(items.flatMap((i) => (typeof i.value === "number" ? [i.value] : [])));
  const references = [
    ...(usValue !== null ? [{ label: "United States", value: usValue }] : []),
    ...(med !== null ? [{ label: `Median of ${words.many}`, value: med }] : []),
  ];
  const partial = (snap.data ?? []).some((f) => f.partial);
  const ranked = rankItems(items);
  const before = valueOf(snapB.data);
  const status =
    catalog.isPending || periodsQ.isPending || snap.isPending
      ? { kind: "loading" as const }
      : catalog.isError || periodsQ.isError || snap.isError
        ? {
            kind: "error" as const,
            onRetry: () => void (snap.isError ? snap.refetch() : catalog.refetch()),
          }
        : !metric
          ? { kind: "empty" as const, reason: `No metric is published for ${words.many} yet.` }
          : ranked.ranked.length === 0
            ? {
                kind: "empty" as const,
                reason: `No ${words.one} records a value for ${period ? plabel(period) : "this period"}.`,
              }
            : { kind: "ready" as const };
  const notes = metric ? metricNotes(metric) : [];
  const sources = metric?.sourceLinks ?? [];
  const title = metric ? `${metric.label}, by ${words.one}` : "Rankings";
  const periodText = period ? `${plabel(period)}${partial ? "*" : ""}` : undefined;
  const table = metric
    ? {
        caption: `${metric.label}, ${periodText ?? ""}`,
        columns: [
          { label: words.one[0]!.toUpperCase() + words.one.slice(1) },
          { label: "Rank", align: "right" as const },
          { label: plabel(period ?? ""), align: "right" as const },
          ...(compare ? [{ label: plabel(compare), align: "right" as const }] : []),
        ],
        rows: [
          ...ranked.ranked.map((r) => ({
            key: r.id,
            cells: [
              r.label,
              String(r.rank),
              fmt.full(r.value),
              ...(compare ? [fmt.full(before.get(r.id) ?? null)] : []),
            ],
          })),
          ...ranked.missing.map((m) => ({
            key: m.id,
            muted: true,
            cells: [
              m.label,
              "—",
              "Not recorded",
              ...(compare ? [fmt.full(before.get(m.id) ?? null)] : []),
            ],
          })),
        ],
      }
    : undefined;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-md border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[10rem_minmax(0,1fr)_10rem_10rem]">
        <Field label="Rank">
          <select
            className={controlClass}
            value={type}
            onChange={(e) =>
              set({
                type: e.target.value as EntityType,
                metric: undefined,
                period: undefined,
                compare: undefined,
                sel: undefined,
              })
            }
          >
            {(types.length ? types : ["state" as EntityType]).map((t) => (
              <option key={t} value={t}>
                {ENTITY_LABEL[t].many[0]!.toUpperCase() + ENTITY_LABEL[t].many.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <MetricSelect
          label="Metric"
          metrics={metrics}
          value={metric?.id}
          onChange={(id) => set({ metric: id, period: undefined, compare: undefined })}
        />
        <Field label="Period">
          <select
            className={controlClass}
            value={period ?? ""}
            onChange={(e) => set({ period: e.target.value })}
            disabled={!periods.length}
          >
            {[...periods].reverse().map((p) => (
              <option key={p} value={p}>
                {plabel(p)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Compare with">
          <select
            className={controlClass}
            value={compare ?? ""}
            onChange={(e) => set({ compare: e.target.value })}
            disabled={periods.length < 2}
          >
            {[...periods]
              .reverse()
              .filter((p) => p !== period)
              .map((p) => (
                <option key={p} value={p}>
                  {plabel(p)}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <FixtureBanner on={fixturesOn && catalog.data?.origin[metric?.id ?? ""] === "fixture"} />
      <CatalogNotice catalog={catalog.data} />
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {type === "state" || type === "county" ? (
          <ChartFrame
            title={`${title}: map`}
            unit={metric?.unit}
            period={periodText}
            sources={sources}
            status={status}
            notes={notes}
            table={table}
            minHeight={320}
            headingLevel="h2"
            footnotes={
              partial ? ["* Partial period: the values cover part of the period only."] : undefined
            }
          >
            {metric ? (
              <Choropleth
                level={type}
                title={metric.label}
                values={valueOf(snap.data)}
                format={metric.format}
                unit={metric.unit}
                periodLabel={periodText ?? ""}
                selected={search.sel ?? null}
                onSelect={(id) => set({ sel: id === search.sel ? undefined : id })}
              />
            ) : null}
          </ChartFrame>
        ) : null}
        <ChartFrame
          title={`${title}: ranked`}
          unit={metric?.unit}
          period={periodText}
          sources={sources}
          status={status}
          notes={notes}
          table={table}
          headingLevel="h2"
          footnotes={[
            "Ranks: 1 = highest value; tied values share a rank.",
            ...(usValue !== null
              ? ["United States: the metric's national value for the same period."]
              : []),
          ]}
        >
          <RankedBars
            items={items}
            formatter={fmt}
            unit={metric?.unit}
            ariaLabel={`${title}, ${periodText ?? ""}, ranked`}
            references={references}
            highlight={search.sel ?? null}
            limit={type === "state" ? undefined : 25}
            onSelect={(id) => set({ sel: id === search.sel ? undefined : id })}
          />
        </ChartFrame>
      </div>
      <ChartFrame
        title={`${title}: spread`}
        unit={metric?.unit}
        period={periodText}
        sources={sources}
        status={status}
        headingLevel="h2"
        notes={[
          "Each dot is one entity; the box spans the middle half of the values and the line inside it is the median. Whiskers reach the most extreme values within 1.5 times the box's width.",
        ]}
      >
        <DistributionStrip
          items={items}
          formatter={fmt}
          unit={metric?.unit}
          ariaLabel={`${title}: spread of values`}
          references={references.slice(0, 1)}
          selected={search.sel ?? null}
          height={130}
          zero={metric?.format !== "percent"}
        />
      </ChartFrame>
      <div className="grid items-start gap-3 xl:grid-cols-2">
        <ChartFrame
          title={`${title}: ${compare ? `${plabel(compare)} to ${plabel(period ?? "")}` : "change between two periods"}`}
          unit={metric?.unit}
          period={compare && period ? `${plabel(compare)} and ${plabel(period)}` : undefined}
          sources={sources}
          status={
            !compare
              ? { kind: "empty", reason: "Only one period is published, so nothing moved." }
              : snapB.isPending
                ? { kind: "loading" }
                : status
          }
          headingLevel="h2"
          notes={[
            "Grey lines: every entity. Coloured lines: the five largest moves (blue rose, orange fell) and any selected entity, labelled at both ends.",
            "An entity missing a value in either period has no line.",
          ]}
        >
          {compare && period ? (
            <SlopeChart
              items={items.map((i) => ({
                id: i.id,
                label: i.label,
                values: { [compare]: before.get(i.id) ?? null, [period]: i.value },
              }))}
              periods={[compare, period]}
              periodLabel={plabel}
              formatter={fmt}
              unit={metric?.unit}
              ariaLabel={`${title}, ${plabel(compare)} to ${plabel(period)}`}
              selected={search.sel ?? null}
              height={360}
            />
          ) : null}
        </ChartFrame>
        <ChartFrame
          title={`${title}: every period`}
          unit={metric?.unit}
          period={span.length ? `${plabel(span[0]!)}–${plabel(span[span.length - 1]!)}` : undefined}
          sources={sources}
          status={
            history.isPending
              ? { kind: "loading" }
              : history.isError
                ? { kind: "error", onRetry: () => void history.refetch() }
                : status
          }
          headingLevel="h2"
          notes={[
            "Rows are ordered by the selected period's value. Shade follows one scale across every cell; hatched cells are not recorded.",
          ]}
        >
          {history.data && metric ? (
            <Heatmap
              rows={ranked.ranked.slice(0, 51).map((r) => ({ id: r.id, label: r.label }))}
              columns={span.map((p) => ({
                id: p,
                label:
                  metric.periodType === "year" ? p : plabel(p).replace(/^12 months ending /, ""),
              }))}
              value={historyValue}
              formatter={fmt}
              ariaLabel={`${title} by period`}
              cellHeight={14}
            />
          ) : null}
        </ChartFrame>
      </div>
    </div>
  );
}
