/**
 * /insights: the KPI board across the eight topics (latest complete value, change against the period before it,
 * sparkline, source), the notable movements computed from those tiles by a stated rule, and the entry points into the
 * workbench. Each tile loads and fails on its own.
 */
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  LibrarySquare,
  LineChart,
  Map as MapIcon,
  ScatterChart,
} from "lucide-react";
import type { MetricDef, Topic } from "@/lib/insights/contract";
import { blockDef } from "@/lib/analytics/registry";
import { analyticsBlockQuery } from "@/components/analytics/hub/blockQuery";
import { Sparkline } from "@/components/charts/Sparkline";
import { Card, CardHeader } from "@/components/kit/Card";
import { InfoPopover } from "@/components/kit/InfoPopover";
import { DeltaPill, KpiCard, KpiGrid } from "@/components/kit/KpiCard";
import { ListRow } from "@/components/kit/LinkTile";
import { Section } from "@/components/kit/Section";
import { cn } from "@/lib/utils";
import { CatalogNotice, FixtureBanner } from "./controls";
import { catalogQuery, fixturesOn, seriesQuery } from "./data";
import { kpiDelta } from "./kpiDelta";
import {
  BRIDGE_KPI_METRICS,
  HUB_BLOCK_TOPIC,
  MOVEMENT_RULE,
  TOPIC_LABEL,
  TOPIC_ORDER,
  kpiFromBlock,
  kpiFromFacts,
  notableMovements,
  type Kpi,
} from "./kpis";

type TileState =
  | { kind: "loading"; id: string; topic: Topic; title: string }
  | { kind: "error"; id: string; topic: Topic; title: string; retry: () => void }
  | { kind: "empty"; id: string; topic: Topic; title: string; reason: string }
  | { kind: "ok"; kpi: Kpi };

const HUB_IDS = Object.keys(HUB_BLOCK_TOPIC);

function KpiLink({ kpi, className }: { kpi: Kpi; className?: string }) {
  return (
    <Link
      to={kpi.href.to as never}
      {...(kpi.href.search ? { search: kpi.href.search as never } : {})}
      {...(kpi.href.hash ? { hash: kpi.href.hash } : {})}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[12px] font-medium text-brand hover:underline focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      Open chart
      <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}

export function KpiTile({ state }: { state: TileState }) {
  if (state.kind !== "ok")
    return (
      <KpiCard
        as="li"
        label={state.title}
        state={state.kind}
        loadingLabel={`Loading ${state.title}`}
        trend={null}
        errorText="Could not be read just now. The other tiles are unaffected."
        onRetry={state.kind === "error" ? state.retry : undefined}
        emptyText={state.kind === "empty" ? state.reason : undefined}
      />
    );
  const k = state.kpi;
  return (
    <KpiCard
      as="li"
      label={k.title}
      value={k.value}
      unit={k.value && /^[\d,.]+$/.test(k.value) ? k.unit : undefined}
      meta={[k.seriesLabel, k.periodText].filter(Boolean).join(", ") || undefined}
      delta={kpiDelta(k)}
      deltaNote={k.changeNote ?? undefined}
      partial={k.partialNote ?? undefined}
      trend={
        k.spark ? (
          <Sparkline series={k.spark.series} keys={k.spark.keys} width={128} height={36} />
        ) : undefined
      }
      action={<KpiLink kpi={k} />}
      source={{ source: { label: k.source.label, href: k.source.url } }}
    />
  );
}

function Movements({ tiles, pending }: { tiles: Kpi[]; pending: number }) {
  const moves = notableMovements(tiles);
  return (
    <Card as="section" aria-labelledby="moves-title" className="flex flex-col">
      <CardHeader
        id="moves-title"
        titleAs="h2"
        title="Notable movements"
        description={
          pending
            ? `${pending} tile${pending === 1 ? "" : "s"} still loading`
            : `${tiles.length} tiles compared`
        }
        actions={
          <InfoPopover label="How these are chosen">
            <p>
              {MOVEMENT_RULE.text} A change is a difference between two published figures, not a
              finding that anything caused it; several tiles compare a month with the same month a
              year earlier, as their text says.
            </p>
          </InfoPopover>
        }
      />
      {moves.length ? (
        <ol className="m-0 list-none divide-y divide-border border-t border-border p-0">
          {moves.map((k, i) => {
            const delta = kpiDelta(k);
            return (
              <ListRow
                key={k.id}
                leading={
                  <span className="w-4 shrink-0 text-right text-meta tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                }
                title={k.title}
                meta={
                  delta ? (
                    <span className="inline-flex items-center gap-1.5">
                      <DeltaPill delta={delta} />
                      <span className="hidden sm:inline">{delta.detail}</span>
                    </span>
                  ) : null
                }
                trailing={<KpiLink kpi={k} />}
              />
            );
          })}
        </ol>
      ) : (
        <p role="status" className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {pending
            ? "Waiting for the tiles to load."
            : "No tile has enough complete periods for a comparison."}
        </p>
      )}
    </Card>
  );
}

/** The reading guide of the board (formerly an intro paragraph), shown from the page header. */
export function BoardGuide() {
  return (
    <InfoPopover label="How to read these figures" showLabel>
      <p>
        Each tile shows the latest complete period the source records and the change against the
        period before it (or the same month a year earlier, where the tile says so), with links to
        the full chart, its data table and the source.
      </p>
      <p>
        Partial periods are never the latest value; a period the source does not record is a gap,
        not zero; nothing is estimated or projected. The change pills are neutral: a rise is not
        marked good or bad.
      </p>
    </InfoPopover>
  );
}

const ENTRIES = [
  {
    to: "/insights/explore",
    label: "Explore",
    icon: ScatterChart,
    text: "Put any two metrics side by side across states or MDLs: scatter, statistics, residuals, multiple-comparison control.",
  },
  {
    to: "/insights/trends",
    label: "Trends",
    icon: LineChart,
    text: "Compare up to six places or MDLs on one metric over time, and every national series by topic.",
  },
  {
    to: "/insights/rankings",
    label: "Rankings & maps",
    icon: MapIcon,
    text: "Rank and map any metric for any period, with the national value, the spread and the movers between two periods.",
  },
  {
    to: "/insights/signals",
    label: "Signals",
    icon: Activity,
    text: "Time to MDL termination, growth after centralization, clusters of states, origin courts and co-counsel networks.",
  },
  {
    to: "/insights/today",
    label: "Insights of the day",
    icon: CalendarDays,
    text: "One computed insight per section each day, with the figures behind it.",
  },
  {
    to: "/insights/research",
    label: "Research workbench",
    icon: LibrarySquare,
    text: "State comparisons, judge and case analysis, citation paths and the court and rules hierarchy.",
  },
] as const;

export function OverviewBoard() {
  const hub = useQueries({ queries: HUB_IDS.map((id) => analyticsBlockQuery(id)) });
  const catalog = useQuery(catalogQuery);
  const metricDefs: MetricDef[] = useMemo(() => {
    const all = catalog.data?.metrics ?? [];
    const bridge = BRIDGE_KPI_METRICS.flatMap((id) => all.filter((m) => m.id === id));
    // the data layer's national metrics, at most three per topic (catalog order), so the board stays a summary
    const perTopic = new Map<string, number>();
    const layer = all.filter((m) => {
      if (catalog.data?.origin[m.id] === "bridge" || !m.entityTypes.includes("nation"))
        return false;
      const n = perTopic.get(m.topic) ?? 0;
      perTopic.set(m.topic, n + 1);
      return n < 3;
    });
    return [...layer, ...bridge];
  }, [catalog.data]);
  const metricQs = useQueries({
    queries: metricDefs.map((m) => seriesQuery(m, "nation", ["US"])),
  });

  const states: TileState[] = [];
  HUB_IDS.forEach((id, i) => {
    const def = blockDef(id);
    const q = hub[i]!;
    const topic = HUB_BLOCK_TOPIC[id]!;
    const title = def?.title ?? id;
    if (q.isPending) states.push({ kind: "loading", id, topic, title });
    else if (q.isError)
      states.push({ kind: "error", id, topic, title, retry: () => void q.refetch() });
    else if (q.data.status === "empty")
      states.push({ kind: "empty", id, topic, title, reason: q.data.reason });
    else states.push({ kind: "ok", kpi: kpiFromBlock(q.data.data, title, topic) });
  });
  metricDefs.forEach((m, i) => {
    const q = metricQs[i]!;
    const id = `metric:${m.id}`;
    // the full chart: the metric across states (with the United States line) when states record it
    const type = m.entityTypes.includes("state")
      ? "state"
      : (m.entityTypes.find((t) => t !== "nation") ?? "nation");
    const href = { to: "/insights/trends", search: { metric: m.id, type } };
    if (q.isPending) states.push({ kind: "loading", id, topic: m.topic, title: m.label });
    else if (q.isError)
      states.push({
        kind: "error",
        id,
        topic: m.topic,
        title: m.label,
        retry: () => void q.refetch(),
      });
    else if (!q.data.length)
      states.push({
        kind: "empty",
        id,
        topic: m.topic,
        title: m.label,
        reason: "No national value is published.",
      });
    else states.push({ kind: "ok", kpi: kpiFromFacts(m, q.data, href) });
  });
  const loaded = states.flatMap((s) => (s.kind === "ok" ? [s.kpi] : []));
  const pending = states.filter((s) => s.kind === "loading").length;
  const topicOf = (s: TileState) => (s.kind === "ok" ? s.kpi.topic : s.topic);
  const keyOf = (s: TileState) => (s.kind === "ok" ? s.kpi.id : s.id);

  return (
    <div className="space-y-8">
      <FixtureBanner on={fixturesOn} />
      <CatalogNotice catalog={catalog.data} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Movements tiles={loaded} pending={pending} />
        <Card as="nav" aria-labelledby="tools-title">
          <CardHeader
            id="tools-title"
            titleAs="h2"
            title="Analyse"
            description="Compare, rank, map and explain"
          />
          <ul className="m-0 list-none divide-y divide-border border-t border-border p-0">
            {ENTRIES.map((e) => (
              <ListRow key={e.to} to={e.to} icon={e.icon} title={e.label} description={e.text} />
            ))}
          </ul>
        </Card>
      </div>
      {TOPIC_ORDER.map((t) => {
        const tiles = states.filter((s) => topicOf(s) === t);
        if (!tiles.length) return null;
        return (
          <Section key={t} id={`topic-${t}`} title={TOPIC_LABEL[t]}>
            <KpiGrid columns={2} className="xl:grid-cols-3" label={`${TOPIC_LABEL[t]} figures`}>
              {tiles.map((s) => (
                <KpiTile key={keyOf(s)} state={s} />
              ))}
            </KpiGrid>
          </Section>
        );
      })}
    </div>
  );
}
