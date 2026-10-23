/**
 * /insights/trends: compare up to six entities on one metric over time (lines and small multiples), with a per-capita
 * toggle only where the metric has a stated per-capita counterpart; and every national series by topic (the former
 * Analytics hub, its enforcement and safety depth pages, the FTC consumer section and SEC registrations).
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { EntityType, MetricDef } from "@/lib/insights/contract";
import { BLOCK_GROUPS, blocksInGroup } from "@/lib/analytics/registry";
import { TrendCard } from "@/components/analytics/hub/TrendCard";
import { FtcConsumerSection } from "@/components/analytics/hub/FtcConsumerSection";
import { SecRegistrationTrends } from "@/components/enforcement/regulatory/SecRegistrationTrends";
import {
  ChartFrame,
  ChartLegend,
  LineTrend,
  SmallMultiples,
  metricFormatter,
  seriesVar,
  tableRows,
} from "@/components/charts";
import { chartTokens } from "@/components/charts/palette";
import {
  CatalogNotice,
  ENTITY_LABEL,
  Field,
  FixtureBanner,
  MetricSelect,
  Segmented,
  controlClass,
  metricNotes,
} from "./controls";
import {
  MAX_COMPARE,
  axisFor,
  parseIds,
  perCapitaPair,
  seriesFrom,
  type TrendsSearch,
} from "./trendsModel";
import {
  catalogQuery,
  fixturesOn,
  labelsQuery,
  periodsQuery,
  seriesQuery,
  snapshotQuery,
  loadEntityIds,
} from "./data";

function CompareTrends({
  search,
  set,
}: {
  search: TrendsSearch;
  set: (p: Partial<TrendsSearch>) => void;
}) {
  const catalog = useQuery(catalogQuery);
  const type: EntityType = search.type ?? "state";
  const metrics = useMemo(
    () => (catalog.data?.metrics ?? []).filter((m) => m.entityTypes.includes(type)),
    [catalog.data, type],
  );
  const types = useMemo(() => {
    const set = new Set<EntityType>();
    for (const m of catalog.data?.metrics ?? [])
      for (const t of m.entityTypes) if (t !== "nation") set.add(t);
    // a metric published for the nation only is compared as the national line alone
    if (type === "nation") set.add("nation");
    return [...set];
  }, [catalog.data, type]);
  const chosen = metrics.find((m) => m.id === search.metric) ?? metrics[0];
  const pair = chosen ? perCapitaPair(catalog.data?.metrics ?? [], chosen.id) : null;
  const metric = pair ? (search.pc === "1" ? pair.rate : pair.count) : chosen;
  const periods = useQuery(periodsQuery(metric, type));
  const fallback = periods.data?.fallback ?? null;
  const snapshot = useQuery(snapshotQuery(metric, type, fallback));
  const explicit = parseIds(search.ids);
  const defaultIds = useMemo(() => {
    const rows = (snapshot.data ?? []).filter((f) => f.value !== null);
    return rows
      .sort(
        (a, b) => (b.value as number) - (a.value as number) || a.entityId.localeCompare(b.entityId),
      )
      .slice(0, MAX_COMPARE)
      .map((f) => f.entityId);
  }, [snapshot.data]);
  const ids = explicit.length ? explicit : defaultIds;
  const withUs =
    search.us !== "0" && !!metric?.entityTypes.includes("nation") && ids.length < MAX_COMPARE;
  const series = useQuery(seriesQuery(metric, type, ids));
  const nation = useQuery({
    ...seriesQuery(metric, "nation", ["US"]),
    enabled: !!metric && withUs,
  });
  const allIds = useQuery({
    queryKey: ["insights", "entity-ids", metric?.id ?? "", type],
    queryFn: () => loadEntityIds(metric!, type),
    enabled: !!metric,
    staleTime: 10 * 60 * 1000,
  });
  const labels = useQuery(labelsQuery(type, [...new Set([...(allIds.data ?? []), ...ids])]));
  const labelOf = (id: string) => labels.data?.get(id)?.label ?? id;
  const fmt = metric ? metricFormatter(metric.format) : metricFormatter("count");

  const drawn = useMemo(() => {
    if (!metric || !series.data) return null;
    const s = seriesFrom(series.data, ids, labelOf);
    const us =
      withUs && nation.data?.length ? seriesFrom(nation.data, ["US"], () => "United States") : [];
    const all = [...s, ...us];
    const axis = axisFor(metric, [...series.data, ...(us.length ? (nation.data ?? []) : [])]);
    return { series: all, entitySeries: s, axis };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, series.data, nation.data, ids.join(","), withUs, labels.data]);

  const entityWord = ENTITY_LABEL[type];
  const status =
    catalog.isPending || (metric && (series.isPending || (!explicit.length && snapshot.isPending)))
      ? { kind: "loading" as const }
      : catalog.isError || series.isError
        ? {
            kind: "error" as const,
            onRetry: () => void (catalog.isError ? catalog.refetch() : series.refetch()),
          }
        : !metric
          ? { kind: "empty" as const, reason: `No metric is published for ${entityWord.many} yet.` }
          : !drawn || drawn.series.every((s) => s.points.every((p) => p.value === null))
            ? {
                kind: "empty" as const,
                reason: `No value is recorded for the chosen ${entityWord.many}.`,
              }
            : { kind: "ready" as const };

  const addable = (allIds.data ?? []).filter((id) => !ids.includes(id));
  const hasPartial = drawn?.series.some((s) => s.points.some((p) => p.partial)) ?? false;
  const gaps = drawn
    ? drawn.entitySeries.reduce(
        (n, s) =>
          n +
          drawn.axis.keys.filter((k) => !s.points.some((p) => p.key === k && p.value !== null))
            .length,
        0,
      )
    : 0;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-md border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[10rem_minmax(0,1fr)_auto]">
        <Field label="Compare">
          <select
            className={controlClass}
            value={type}
            onChange={(e) =>
              set({
                type: e.target.value as EntityType,
                ids: undefined,
                metric: undefined,
                pc: undefined,
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
          metrics={metrics.filter((m) => !pair || m.id !== pair.rate.id || m.id === chosen?.id)}
          value={chosen?.id}
          onChange={(id) => set({ metric: id, pc: undefined })}
        />
        <div className="flex flex-wrap items-end gap-2">
          {pair ? (
            <Segmented
              label="Count or per capita"
              value={search.pc === "1" ? "rate" : "count"}
              onChange={(v) => set({ pc: v === "rate" ? "1" : undefined })}
              options={[
                { id: "count", label: "Count" },
                { id: "rate", label: "Per capita", title: pair.rate.denominator ?? undefined },
              ]}
            />
          ) : null}
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">
            {entityWord.many[0]!.toUpperCase() + entityWord.many.slice(1)} compared ({ids.length} of{" "}
            {MAX_COMPARE})
            {!explicit.length && ids.length
              ? " · default: the largest values in the latest complete period"
              : ""}
          </p>
          <ul className="flex flex-wrap items-center gap-1.5" style={chartTokens}>
            {ids.map((id, i) => (
              <li
                key={id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pl-2 pr-1 text-xs"
              >
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-3 rounded-full"
                  style={{ background: seriesVar(i) }}
                />
                {labelOf(id)}
                <button
                  type="button"
                  aria-label={`Remove ${labelOf(id)}`}
                  onClick={() => set({ ids: ids.filter((x) => x !== id).join(",") || undefined })}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
            {ids.length < MAX_COMPARE && addable.length ? (
              <li>
                <select
                  aria-label={`Add a ${entityWord.one}`}
                  className={`${controlClass} h-7 w-44`}
                  value=""
                  onChange={(e) =>
                    e.target.value && set({ ids: [...ids, e.target.value].join(",") })
                  }
                >
                  <option value="">Add a {entityWord.one}…</option>
                  {addable
                    .map((id) => ({ id, label: labelOf(id) }))
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                </select>
              </li>
            ) : null}
          </ul>
        </div>
      </div>
      <FixtureBanner on={fixturesOn && catalog.data?.origin[metric?.id ?? ""] === "fixture"} />
      <CatalogNotice catalog={catalog.data} />
      <ChartFrame
        title={metric ? `${metric.label}, ${entityWord.many} compared` : "Compare over time"}
        unit={metric?.unit}
        period={
          drawn?.axis.keys.length
            ? `${drawn.axis.label(drawn.axis.keys[0]!)}–${drawn.axis.label(drawn.axis.keys[drawn.axis.keys.length - 1]!)}${hasPartial ? "*" : ""}`
            : undefined
        }
        sources={metric?.sourceLinks ?? []}
        status={status}
        notes={metric ? metricNotes(metric) : undefined}
        footnotes={[
          ...(hasPartial ? ["* Partial period: drawn dashed, never the latest value."] : []),
          ...(gaps
            ? [
                `${gaps} entity-period${gaps === 1 ? "" : "s"} not recorded, left as gaps (not zero).`,
              ]
            : []),
          ...(withUs && nation.data?.length
            ? ["United States: the metric's national value, as the source states its basis."]
            : []),
        ]}
        table={
          drawn
            ? {
                caption: `${metric?.label ?? ""} by period`,
                columns: [
                  { label: "Period" },
                  ...drawn.series.map((s) => ({ label: s.label, align: "right" as const })),
                ],
                rows: tableRows(drawn.series, drawn.axis, (v) => fmt.full(v)).map((r) => ({
                  key: r.key,
                  cells: [r.period, ...r.cells],
                })),
              }
            : undefined
        }
        minHeight={300}
        headingLevel="h2"
      >
        {drawn ? (
          <>
            <ChartLegend
              items={drawn.series.map((s, i) => ({
                id: s.id,
                label: s.label,
                color: seriesVar(i),
              }))}
            />
            <LineTrend
              series={drawn.series}
              axis={drawn.axis}
              formatter={fmt}
              unit={metric?.unit}
              ariaLabel={`${metric?.label}: ${drawn.series.map((s) => s.label).join(", ")}`}
              height={300}
              zero={metric?.format !== "percent"}
            />
          </>
        ) : null}
      </ChartFrame>
      {drawn && drawn.entitySeries.length > 1 ? (
        <section
          aria-labelledby="small-multiples-title"
          className="rounded-md border border-border bg-surface p-3"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="small-multiples-title" className="text-sm font-semibold">
              One panel per {entityWord.one}
            </h2>
            <Segmented
              label="Value scale"
              value={search.scale === "own" ? "own" : "shared"}
              onChange={(v) => set({ scale: v === "own" ? "own" : undefined })}
              options={[
                { id: "shared", label: "Shared scale" },
                { id: "own", label: "Own scales" },
              ]}
            />
          </div>
          <SmallMultiples
            series={drawn.entitySeries}
            axis={drawn.axis}
            formatter={fmt}
            unit={metric?.unit}
            shared={search.scale !== "own"}
            zero={metric?.format !== "percent"}
          />
        </section>
      ) : null}
    </div>
  );
}

const TOPIC_ANCHOR: Record<string, string> = {
  enforcement: "group-enforcement",
  safety: "group-safety",
  courts: "group-courts",
  consumer: "group-consumer",
};

function NationalTrends({ topic }: { topic: string | undefined }) {
  useEffect(() => {
    const anchor = topic ? TOPIC_ANCHOR[topic] : undefined;
    if (!anchor) return;
    const t = window.setTimeout(
      () => document.getElementById(anchor)?.scrollIntoView({ block: "start" }),
      50,
    );
    return () => window.clearTimeout(t);
  }, [topic]);
  return (
    <div className="space-y-5">
      <p className="max-w-4xl text-xs leading-5 text-muted-foreground">
        Every national series on the platform, by topic. Each block counts one thing and states its
        unit, period and source. A period still in progress is marked * and drawn dashed or hatched,
        and is never the latest value. A period a source does not record is a gap, never zero.
        Nothing is estimated or projected.
      </p>
      <nav
        aria-label="Topics on this page"
        className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-x-4 gap-y-1 rounded bg-background/95 px-1 py-1.5 text-xs backdrop-blur"
      >
        {BLOCK_GROUPS.map((g) => (
          <a
            key={g.id}
            href={`#group-${g.id}`}
            className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {g.title}
          </a>
        ))}
        <a
          href="#group-ftc-consumer"
          className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          FTC consumer protection
        </a>
      </nav>
      {BLOCK_GROUPS.map((g) => (
        <section
          key={g.id}
          id={`group-${g.id}`}
          aria-labelledby={`group-${g.id}-title`}
          className="scroll-mt-10"
        >
          <h2 id={`group-${g.id}-title`} className="text-sm font-semibold">
            {g.title}
          </h2>
          <p className="mb-2 max-w-4xl text-xs leading-5 text-muted-foreground">{g.lede}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {blocksInGroup(g.id).map((def) => (
              <TrendCard key={def.id} def={def} />
            ))}
          </div>
        </section>
      ))}
      <FtcConsumerSection />
      <SecRegistrationTrends />
    </div>
  );
}

export function TrendsView({
  search,
  set,
}: {
  search: TrendsSearch;
  set: (p: Partial<TrendsSearch>) => void;
}) {
  const view = search.view ?? "compare";
  return (
    <div className="space-y-3">
      <Segmented
        label="Trends view"
        value={view}
        onChange={(v) => set({ view: v === "compare" ? undefined : v })}
        options={[
          { id: "compare", label: "Compare over time" },
          { id: "national", label: "National series by topic" },
        ]}
      />
      {view === "national" ? (
        <NationalTrends topic={search.topic} />
      ) : (
        <CompareTrends search={search} set={set} />
      )}
    </div>
  );
}
