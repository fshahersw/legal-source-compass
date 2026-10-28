/**
 * /insights as one page (owner feedback 2026-10-24 evening: one scrollable page with a section index instead of a row
 * of tabs). It opens with the answer: four headline KPIs, then "What moved most" as a chart (the six largest changes,
 * with every change behind "View data"), then each topic's figures (three shown, the rest behind "Show all"), today's
 * insight, and the tools, which stay their own views. Each tile loads and fails on its own; nothing is estimated.
 */
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  Clapperboard,
  LibrarySquare,
  LineChart,
  Map as MapIcon,
  ScatterChart,
} from "lucide-react";
import type { MetricDef } from "@/lib/insights/contract";
import { analyticsBlockQuery } from "@/components/analytics/hub/blockQuery";
import { BarList } from "@/components/kit/BarList";
import { SourceFooter } from "@/components/kit/Card";
import { ChartCard } from "@/components/kit/ChartCard";
import { EmptyState } from "@/components/kit/EmptyState";
import { formatSignedPercent, splitChangeText } from "@/components/kit/format";
import { InfoPopover } from "@/components/kit/InfoPopover";
import { InsightCallout } from "@/components/kit/InsightCallout";
import { KpiGrid } from "@/components/kit/KpiCard";
import { LinkTile, ListRow } from "@/components/kit/LinkTile";
import { Section } from "@/components/kit/Section";
import { SectionIndex } from "@/components/kit/SectionIndex";
import { ShowMore } from "@/components/kit/ShowMore";
import { CardSkeleton } from "@/components/kit/Skeletons";
import { Button } from "@/components/ui/button";
import { AiSummary } from "@/components/kit/ai/AiSummary";
import { AskAiButton } from "@/components/kit/ai/AskAiButton";
import { CatalogNotice, FixtureBanner } from "./controls";
import { catalogQuery, fixturesOn, seriesQuery } from "./data";
import { HEADLINE_BLOCKS, hubTileState, tileKey, tileTopic, type TileState } from "./hubTiles";
import { allDailyInsightsQuery, formatDayKey } from "./insightQueries";
import { KpiTile } from "./KpiTile";
import { HEADLINE_QUESTIONS, kpiContext } from "./kpiContext";
import {
  BRIDGE_KPI_METRICS,
  HUB_BLOCK_TOPIC,
  MOVEMENT_RULE,
  TOPIC_LABEL,
  TOPIC_ORDER,
  kpiFromFacts,
  repeatedTileIds,
  notableMovements,
  type Kpi,
} from "./kpis";
import { changeRows, movementTakeaway } from "./movements";

const HUB_IDS = Object.keys(HUB_BLOCK_TOPIC);
const HEADLINE_IDS = new Set<string>(HEADLINE_BLOCKS.map((id) => `hub:${id}`));
const isHeadline = (s: TileState) =>
  s.kind === "ok"
    ? HEADLINE_IDS.has(s.kpi.id)
    : (HEADLINE_BLOCKS as readonly string[]).includes(s.id);

const TOOLS = [
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
    to: "/insights/stories",
    label: "Visual stories",
    icon: Clapperboard,
    text: "The MDL docket in motion: the largest MDLs report by report as a race, the whole docket as a streamgraph, and the defendant network.",
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

/** The reading guide of the page (formerly an intro paragraph), shown from the page header. */
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

function Movements({ tiles, pending }: { tiles: Kpi[]; pending: number }) {
  const moves = notableMovements(tiles);
  const rows = changeRows(tiles);
  const takeaway = movementTakeaway(moves);
  return (
    <ChartCard
      id="moves-chart"
      title={takeaway ?? "What moved most"}
      subtitle={`Percent change between each series' latest complete period and the one before; the ${MOVEMENT_RULE.count} largest among series with at least ${MOVEMENT_RULE.minCompletePeriods} complete periods${pending ? ` (${pending} still loading)` : ""}`}
      state={moves.length ? "ready" : pending ? "loading" : "empty"}
      height={240}
      emptyText="No series has enough complete periods for a comparison."
      data={{
        title: "Change on the period before, every Insights series",
        description:
          "Each series' latest complete period against the one before, as its tile prints it.",
        filename: "insights-changes",
        rows,
        rowKey: (k) => k.id,
        searchable: true,
        searchLabel: "Filter series",
        columns: [
          { key: "series", label: "Series", value: (k) => k.title },
          {
            key: "pct",
            label: "Change (%)",
            align: "right",
            value: (k) => k.changePercent,
            render: (k) =>
              k.changePercent === null ? (
                <span className="text-muted-foreground">Not recorded</span>
              ) : (
                formatSignedPercent(k.changePercent)
              ),
          },
          {
            key: "abs",
            label: "Change",
            align: "right",
            value: (k) => (k.changeText ? splitChangeText(k.changeText).change : null),
          },
          {
            key: "vs",
            label: "Compared with",
            value: (k) => (k.changeText ? splitChangeText(k.changeText).comparison : null),
          },
          { key: "latest", label: "Latest", align: "right", value: (k) => k.value },
          { key: "period", label: "Period", value: (k) => k.periodText },
          { key: "n", label: "Complete periods", align: "right", value: (k) => k.completePeriods },
          { key: "source", label: "Source", value: (k) => k.source.label },
        ],
        source: {
          source: "each series' own publisher (Source column)",
          about: <p>{MOVEMENT_RULE.text}</p>,
          aboutLabel: "How these are chosen",
        },
      }}
      source={{
        source: "each series' own publisher (View data)",
        aboutLabel: "How these are chosen",
        about: (
          <p>
            {MOVEMENT_RULE.text} A change is a difference between two published figures, not a
            finding that anything caused it; several series compare a month with the same month a
            year earlier, as their text says.
          </p>
        ),
      }}
    >
      <BarList
        ariaLabel="The largest changes, in percent"
        diverging
        items={moves.map((k) => {
          const comparison = k.changeText ? splitChangeText(k.changeText).comparison : null;
          return {
            id: k.id,
            label: k.title,
            note: comparison ? `vs ${comparison}` : undefined,
            value: k.changePercent,
            display: k.changePercent === null ? "" : formatSignedPercent(k.changePercent),
            to: k.href.to,
            search: k.href.search,
            hash: k.href.hash,
          };
        })}
      />
    </ChartCard>
  );
}

/** Today's insight: the first section's pick as a callout, the other sections' headlines one click away. */
function Today() {
  const q = useQuery(allDailyInsightsQuery);
  if (q.isPending) return <CardSkeleton lines={4} label="Loading the insights of the day" />;
  if (q.isError || !q.data)
    return (
      <EmptyState
        tone="error"
        compact
        title="The insights of the day could not be loaded."
        action={
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            Retry
          </Button>
        }
      />
    );
  const { dayKey, sections } = q.data;
  const featured = sections.find((s) => s.pick && !s.failed);
  const others = sections.filter((s) => s !== featured && s.pick && !s.failed);
  if (!featured?.pick)
    return (
      <EmptyState
        compact
        title="No insight is available today"
        description="The data behind the insights is not published yet."
      />
    );
  const pick = featured.pick;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <InsightCallout
        eyebrow={`${featured.title} · ${formatDayKey(dayKey)} (UTC)`}
        headline={pick.headline}
        figures={pick.points.slice(0, 4).map((p) => ({
          label: p.label,
          value: p.value,
          detail: p.note,
        }))}
        footer={
          <SourceFooter
            className="flex-1"
            source={pick.sources.map((s) => ({ label: s.label, href: s.href }))}
            period={pick.dataThrough ? `Data through ${pick.dataThrough}` : undefined}
            about={
              pick.caveat || featured.partial ? (
                <>
                  {pick.caveat ? <p>Note: {pick.caveat}</p> : null}
                  {featured.partial ? (
                    <p>
                      Some data sources for this section could not be read just now; this insight is
                      chosen from the rest.
                    </p>
                  ) : null}
                </>
              ) : undefined
            }
          />
        }
      >
        {pick.summary.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </InsightCallout>
      {others.length ? (
        <nav
          aria-label="Other insights of the day"
          className="overflow-hidden rounded-xl border border-border bg-card shadow-xs shadow-xs"
        >
          <p className="m-0 border-b border-border px-4 py-3 text-label">Other sections today</p>
          <ul className="m-0 list-none divide-y divide-border p-0">
            {others.map((s) => (
              <ListRow
                key={s.section}
                to="/insights/today"
                hash={`insight-${s.section}`}
                title={s.pick!.headline}
                description={s.title}
              />
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}

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

  const states: TileState[] = HUB_IDS.map((id, i) => hubTileState(id, hub[i]!));
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
  // Say each figure once: a data-layer tile that repeats a hub tile's figure (same area, period, value, change) is
  // left out, from the area lists and from "What moved most".
  const repeats = repeatedTileIds(states.flatMap((s) => (s.kind === "ok" ? [s.kpi] : [])));
  const shownStates = states.filter((s) => s.kind !== "ok" || !repeats.has(s.kpi.id));
  const loaded = shownStates.flatMap((s) => (s.kind === "ok" ? [s.kpi] : []));
  const pending = states.filter((s) => s.kind === "loading").length;
  const headlines = HEADLINE_BLOCKS.flatMap((id) => {
    const s = states.find((t) => tileKey(t) === id || tileKey(t) === `hub:${id}`);
    return s ? [s] : [];
  });
  const headlineContext = kpiContext("Headline figures", headlines);
  const topics = TOPIC_ORDER.flatMap((t) => {
    const tiles = shownStates.filter((s) => tileTopic(s) === t && !isHeadline(s));
    return tiles.length ? [{ topic: t, tiles }] : [];
  });
  const index = [
    { id: "headlines", label: "Headlines" },
    { id: "moves", label: "What moved" },
    ...topics.map((t) => ({ id: `topic-${t.topic}`, label: TOPIC_LABEL[t.topic] })),
    { id: "today", label: "Today" },
    { id: "tools", label: "Tools" },
  ];

  return (
    <div className="space-y-8">
      <SectionIndex items={index} label="On this page" />
      <FixtureBanner on={fixturesOn} />
      <CatalogNotice catalog={catalog.data} />
      <Section
        id="headlines"
        title="Headlines"
        description="The latest complete period of one headline series per area, with the change on the period before."
      >
        <KpiGrid columns={4} label="Headline figures">
          {headlines.map((s) => (
            <KpiTile key={tileKey(s)} state={s} />
          ))}
        </KpiGrid>
        <AiSummary
          context={headlineContext}
          className="mt-3"
          actions={
            <AskAiButton
              sectionId="headlines"
              title="Headline figures"
              context={headlineContext}
              questions={HEADLINE_QUESTIONS}
            />
          }
        />
      </Section>
      <Section id="moves" title="What moved most">
        <Movements tiles={loaded} pending={pending} />
      </Section>
      {topics.map(({ topic, tiles }) => (
        <Section
          key={topic}
          id={`topic-${topic}`}
          title={TOPIC_LABEL[topic]}
          description={`${tiles.length} series`}
        >
          <ShowMore
            items={tiles}
            initial={3}
            noun={`${TOPIC_LABEL[topic].toLowerCase()} series`}
            render={(shown) => (
              <KpiGrid columns={3} label={`${TOPIC_LABEL[topic]} figures`}>
                {shown.map((s) => (
                  <KpiTile key={tileKey(s)} state={s} />
                ))}
              </KpiGrid>
            )}
          />
        </Section>
      ))}
      <Section id="today" title="Insight of the day">
        <Today />
      </Section>
      <Section
        id="tools"
        title="Tools"
        description="Each tool opens as its own view, on the same published data."
      >
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {TOOLS.map((t) => (
            <li key={t.to} className="min-w-0">
              <LinkTile to={t.to} icon={t.icon} title={t.label} description={t.text} />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
