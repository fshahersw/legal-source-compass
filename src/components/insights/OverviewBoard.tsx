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
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  ExternalLink,
  LibrarySquare,
  LineChart,
  Map as MapIcon,
  Minus,
  RefreshCw,
  ScatterChart,
} from "lucide-react";
import type { MetricDef, Topic } from "@/lib/insights/contract";
import { blockDef } from "@/lib/analytics/registry";
import { analyticsBlockQuery } from "@/components/analytics/hub/blockQuery";
import { Sparkline } from "@/components/charts/Sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CatalogNotice, FixtureBanner } from "./controls";
import { catalogQuery, fixturesOn, seriesQuery } from "./data";
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
        "inline-flex items-center gap-1 rounded text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      Open chart
      <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}

function ChangeLine({ kpi }: { kpi: Kpi }) {
  if (!kpi.changeText)
    return <p className="text-[11px] leading-4 text-muted-foreground">{kpi.changeNote}</p>;
  const Arrow = kpi.direction === "up" ? ArrowUp : kpi.direction === "down" ? ArrowDown : Minus;
  return (
    <p className="flex items-center gap-1 text-[11px] leading-4 text-muted-foreground">
      <Arrow className="size-3 shrink-0" aria-hidden />
      <span>{kpi.changeText}</span>
    </p>
  );
}

export function KpiTile({ state }: { state: TileState }) {
  if (state.kind !== "ok")
    return (
      <li
        className="flex min-h-36 min-w-0 flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2.5"
        {...(state.kind === "loading" ? { "aria-busy": true } : {})}
      >
        <p className="text-xs font-medium leading-4">{state.title}</p>
        {state.kind === "loading" ? (
          <div role="status" aria-label={`Loading ${state.title}`} className="space-y-1.5">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : state.kind === "error" ? (
          <div role="alert" className="space-y-1 text-[11px] text-destructive">
            <p>Could not be read just now. The other tiles are unaffected.</p>
            <button
              type="button"
              onClick={state.retry}
              className="inline-flex items-center gap-1 rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <RefreshCw className="size-3" aria-hidden />
              Retry
            </button>
          </div>
        ) : (
          <p role="status" className="text-[11px] text-muted-foreground">
            {state.reason}
          </p>
        )}
      </li>
    );
  const k = state.kpi;
  return (
    <li className="flex min-w-0 flex-col rounded-md border border-border bg-surface px-3 py-2.5">
      <p className="text-xs font-medium leading-4">{k.title}</p>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          {k.value ? (
            <p className="flex flex-wrap items-baseline gap-x-1">
              <span className="text-xl font-semibold leading-7">{k.value}</span>
              {/^[\d,.]+$/.test(k.value) ? (
                <span className="text-[11px] text-muted-foreground">{k.unit}</span>
              ) : null}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Not recorded</p>
          )}
          <p className="text-[11px] leading-4 text-muted-foreground">
            {[k.seriesLabel, k.periodText].filter(Boolean).join(", ")}
          </p>
        </div>
        {k.spark ? (
          <Sparkline series={k.spark.series} keys={k.spark.keys} width={96} height={30} />
        ) : null}
      </div>
      <ChangeLine kpi={k} />
      {k.partialNote ? (
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">* {k.partialNote}</p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 pt-2 text-[11px] leading-4">
        <a
          href={k.source.url}
          target={k.source.url.startsWith("/") ? undefined : "_blank"}
          rel={k.source.url.startsWith("/") ? undefined : "noreferrer"}
          className="inline-flex min-w-0 items-center gap-0.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          title={k.source.label}
        >
          <span className="truncate">Source: {k.source.label}</span>
          {k.source.url.startsWith("/") ? null : (
            <ExternalLink className="size-3 shrink-0" aria-hidden />
          )}
        </a>
        <KpiLink kpi={k} />
      </div>
    </li>
  );
}

function Movements({ tiles, pending }: { tiles: Kpi[]; pending: number }) {
  const moves = notableMovements(tiles);
  return (
    <section aria-labelledby="moves-title" className="rounded-md border border-border bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-3 py-2">
        <h2 id="moves-title" className="text-sm font-semibold">
          Notable movements
        </h2>
        <p className="text-[11px] text-muted-foreground">
          {pending
            ? `${pending} tile${pending === 1 ? "" : "s"} still loading`
            : `${tiles.length} tiles compared`}
        </p>
      </header>
      {moves.length ? (
        <ol className="divide-y divide-border/60">
          {moves.map((k, i) => (
            <li
              key={k.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5 text-xs"
            >
              <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 font-medium">{k.title}</span>
              <span className="tabular-nums text-muted-foreground">{k.changeText}</span>
              <KpiLink kpi={k} />
            </li>
          ))}
        </ol>
      ) : (
        <p role="status" className="px-3 py-3 text-xs text-muted-foreground">
          {pending
            ? "Waiting for the tiles to load."
            : "No tile has enough complete periods for a comparison."}
        </p>
      )}
      <details className="border-t border-border/70 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
        <summary className="cursor-pointer select-none text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          How these are chosen
        </summary>
        <p className="mt-1">
          {MOVEMENT_RULE.text} A change is a difference between two published figures, not a finding
          that anything caused it; several tiles compare a month with the same month a year earlier,
          as their text says.
        </p>
      </details>
    </section>
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
    const layer = all.filter(
      (m) => catalog.data?.origin[m.id] !== "bridge" && m.entityTypes.includes("nation"),
    );
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
    <div className="space-y-4">
      <FixtureBanner on={fixturesOn} />
      <p className="max-w-4xl text-xs leading-5 text-muted-foreground">
        Each tile shows the latest complete period the source records and the change against the
        period before it (or the same month a year earlier, where the tile says so), with links to
        the full chart, its data table and the source. Partial periods are never the latest value; a
        period the source does not record is a gap, not zero; nothing is estimated or projected.
      </p>
      <CatalogNotice catalog={catalog.data} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Movements tiles={loaded} pending={pending} />
        <nav aria-label="Insights tools" className="rounded-md border border-border bg-surface">
          <h2 className="border-b border-border/70 px-3 py-2 text-sm font-semibold">Analyse</h2>
          <ul className="divide-y divide-border/60">
            {ENTRIES.map((e) => (
              <li key={e.to}>
                <Link
                  to={e.to as never}
                  className="flex items-start gap-2.5 px-3 py-2 hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <e.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">{e.label}</span>
                    <span className="block text-[11px] leading-4 text-muted-foreground">
                      {e.text}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      {TOPIC_ORDER.map((t) => {
        const tiles = states.filter((s) => topicOf(s) === t);
        if (!tiles.length) return null;
        return (
          <section
            key={t}
            id={`topic-${t}`}
            aria-labelledby={`topic-${t}-title`}
            className="scroll-mt-4"
          >
            <h2 id={`topic-${t}-title`} className="mb-2 text-sm font-semibold">
              {TOPIC_LABEL[t]}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tiles.map((s) => (
                <KpiTile key={keyOf(s)} state={s} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
