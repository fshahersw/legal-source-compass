/**
 * /prototypes/kit: the page kit for review, in a light panel and a dark panel. Every figure on this page is live
 * (catalog record counts, the Insights tiles and today's insight); the remaining examples carry navigation text and
 * state labels only, never an invented number.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import {
  Activity,
  CalendarDays,
  Download,
  LibrarySquare,
  LineChart,
  Map as MapIcon,
  MessageCircle,
  ScatterChart,
  Search,
  SearchX,
} from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { HubKpis, HubLinks } from "@/components/atlas/hub/SectionHub";
import { HUBS } from "@/components/atlas/hub/hubs";
import { hubTileState } from "@/components/insights/hubTiles";
import { KpiTile } from "@/components/insights/KpiTile";
import { dailyInsightQuery, formatDayKey } from "@/components/insights/insightQueries";
import { analyticsBlockQuery } from "@/components/analytics/hub/blockQuery";
import {
  BarList,
  Card,
  CardBody,
  ChartCard,
  DataDrawer,
  CardFooter,
  CardHeader,
  CardSkeleton,
  ChartSkeleton,
  DeltaPill,
  EmptyState,
  HeaderStrip,
  InfoPopover,
  InsightCallout,
  KpiCard,
  KpiCardSkeleton,
  KpiGrid,
  KpiStrip,
  ListRow,
  ListSkeleton,
  PageHeader,
  PageTabs,
  PartialPill,
  Section,
  SectionIndex,
  ShowMore,
  ShowMoreText,
  SourceFooter,
  StatusPill,
  type DataColumn,
} from "@/components/kit";
import {
  AI_THIN,
  AI_UNCONFIGURED,
  AiSummary,
  AiSummaryView,
  AskAiButton,
  AskAiButtonView,
  buildSectionContext,
  figuresFromRows,
  type SectionContext,
} from "@/components/kit/ai";
import { MOVEMENT_RULE } from "@/components/insights/kpis";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PRIMARY_NAVIGATION, sectionMenu } from "@/lib/atlas/navigation";
import { listDatasets } from "@/lib/external/catalog.functions";
import { datasetDisplayName } from "@/lib/external/domainRegistry";
import { pageHead } from "@/lib/corpus/head";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/prototypes/kit")({
  head: () =>
    pageHead("Page kit", "The shared building blocks of the workspace, in light and dark."),
  component: Page,
});

const TOOLS = [
  {
    to: "/insights/explore",
    label: "Explore",
    icon: ScatterChart,
    text: "Put any two metrics side by side across states or MDLs.",
  },
  {
    to: "/insights/trends",
    label: "Trends",
    icon: LineChart,
    text: "Compare up to six places or MDLs on one metric over time.",
  },
  {
    to: "/insights/rankings",
    label: "Rankings & maps",
    icon: MapIcon,
    text: "Rank and map any metric for any period.",
  },
  {
    to: "/insights/signals",
    label: "Signals",
    icon: Activity,
    text: "Time to MDL termination, growth after centralization, clusters.",
  },
  {
    to: "/insights/today",
    label: "Insights of the day",
    icon: CalendarDays,
    text: "One computed insight per section each day.",
  },
  {
    to: "/insights/research",
    label: "Research workbench",
    icon: LibrarySquare,
    text: "State comparisons, judge and case analysis, citation paths.",
  },
] as const;

const LIVE_BLOCKS = ["federal-civil", "mdl-pending", "cpsc-recalls"] as const;

function Specimen({
  name,
  note,
  id,
  children,
  className,
}: {
  name: string;
  note?: string;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div id={id} className={cn("scroll-mt-16 space-y-2.5", className)}>
      <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-meta text-muted-foreground">
        <code className="font-mono text-[11px] font-medium text-foreground">{name}</code>
        {note ? <span>{note}</span> : null}
      </p>
      {children}
    </div>
  );
}

/** Insights tiles for three hub blocks, live. */
function LiveTiles() {
  const qs = useQueries({ queries: LIVE_BLOCKS.map((id) => analyticsBlockQuery(id)) });
  return (
    <KpiGrid columns={3} label="Live KPI cards">
      {LIVE_BLOCKS.map((id, i) => (
        <KpiTile key={id} state={hubTileState(id, qs[i]!)} />
      ))}
    </KpiGrid>
  );
}

/** Safety record counts as a KpiStrip, live from the catalog. */
function LiveStrip() {
  const fn = useServerFn(listDatasets);
  const q = useQuery({
    queryKey: ["corpus-datasets"],
    queryFn: () => fn(),
    staleTime: 10 * 60_000,
  });
  const byId = new Map((q.data ?? []).map((d) => [d.id, d]));
  const items = HUBS.safety.kpis
    .filter((k) => !q.data || byId.has(k.dataset))
    .slice(0, 4)
    .map((k) => {
      const d = byId.get(k.dataset);
      const n = d?.records;
      return {
        key: k.dataset,
        label: k.label,
        state: q.isPending
          ? ("loading" as const)
          : q.isError
            ? ("error" as const)
            : ("ready" as const),
        value: n != null && Number.isSafeInteger(n) ? n.toLocaleString("en-US") : null,
        source: d ? { source: { label: datasetDisplayName(d.id, d.label) } } : null,
      };
    });
  return (
    <KpiStrip
      items={items}
      label="Products & safety record counts"
      cellBasis="basis-[calc(50%-1px)] lg:basis-[calc(25%-1px)]"
    />
  );
}

type SafetyRow = { dataset: string; label: string; records: number | null; source: string };

/** Safety record counts from the catalog, largest first (live). */
function useSafetyRows() {
  const fn = useServerFn(listDatasets);
  const q = useQuery({
    queryKey: ["corpus-datasets"],
    queryFn: () => fn(),
    staleTime: 10 * 60_000,
  });
  const byId = new Map((q.data ?? []).map((d) => [d.id, d]));
  const rows: SafetyRow[] = HUBS.safety.kpis
    .flatMap((k) => {
      const d = byId.get(k.dataset);
      if (!d) return [];
      const n = d.records;
      return [
        {
          dataset: k.dataset,
          label: k.label,
          records: n != null && Number.isSafeInteger(n) && n >= 0 ? n : null,
          source: datasetDisplayName(d.id, d.label),
        },
      ];
    })
    .sort((a, b) => (b.records ?? -1) - (a.records ?? -1) || a.label.localeCompare(b.label));
  return { q, rows };
}

const SAFETY_COLUMNS: DataColumn<SafetyRow>[] = [
  { key: "label", label: "Collection", value: (r) => r.label },
  { key: "records", label: "Records", align: "right", value: (r) => r.records },
  { key: "source", label: "Dataset", value: (r) => r.source },
];

/** ChartCard + BarList + "View data", live: the Products & safety collections by size. */
function LiveChart() {
  const { q, rows } = useSafetyRows();
  const top = rows.find((r) => r.records !== null);
  return (
    <ChartCard
      title={
        top ? `${top.label} is the largest safety collection` : "Products & safety collections"
      }
      subtitle="Records per collection as the corpus catalog stores them"
      state={q.isPending ? "loading" : q.isError ? "error" : rows.length ? "ready" : "empty"}
      onRetry={() => void q.refetch()}
      height={180}
      data={{
        title: "Products & safety collections",
        rows,
        rowKey: (r) => r.dataset,
        columns: SAFETY_COLUMNS,
        source: { source: { label: "Corpus catalog", href: "/sources" } },
      }}
      source={{
        source: { label: "Corpus catalog", href: "/sources" },
        about: <p>Counts are the catalog&apos;s stored record counts; they are never added up.</p>,
      }}
    >
      <BarList
        ariaLabel="Records per safety collection"
        items={rows.map((r) => ({
          id: r.dataset,
          label: r.label,
          value: r.records,
          display: r.records === null ? "" : r.records.toLocaleString("en-US"),
        }))}
      />
    </ChartCard>
  );
}

/** DataDrawer in inline mode, live. */
function LiveInlineData() {
  const { rows } = useSafetyRows();
  return (
    <Card className="p-4">
      <p className="m-0 text-label">Products & safety collections</p>
      <DataDrawer
        mode="inline"
        title="Products & safety collections"
        rows={rows}
        rowKey={(r) => r.dataset}
        columns={SAFETY_COLUMNS}
        source={{ source: { label: "Corpus catalog", href: "/sources" } }}
        className="mt-1"
      />
    </Card>
  );
}

/** Today's safety insight as an InsightCallout, live. */
function LiveInsight() {
  const q = useQuery(dailyInsightQuery("safety"));
  const found = q.data?.sections.find((s) => s.section === "safety");
  if (q.isPending) return <CardSkeleton lines={4} label="Loading the insight of the day" />;
  if (q.isError || !found || found.failed)
    return (
      <EmptyState
        tone="error"
        compact
        title="The insight of the day could not be loaded."
        action={
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            Retry
          </Button>
        }
      />
    );
  const pick = found.pick;
  if (!pick)
    return (
      <EmptyState
        compact
        title="No insight available for this section yet"
        description="The data behind it is not published."
      />
    );
  return (
    <InsightCallout
      eyebrow={`Insight of the day · ${formatDayKey(q.data!.dayKey)} (UTC)`}
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
          about={pick.caveat ? <p>Note: {pick.caveat}</p> : undefined}
        />
      }
    >
      {pick.summary.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </InsightCallout>
  );
}

/** The AI kit on live data: the Products & safety collection sizes from the catalog. State examples use stub text. */
function AiSpecimen({ panel }: { panel: string }) {
  const { q, rows } = useSafetyRows();
  const recorded = rows.filter((r) => r.records !== null);
  const context =
    q.isPending || recorded.length < 2
      ? null
      : buildSectionContext({
          title: "Products & safety collections",
          scope: "Products & safety",
          source: "Corpus catalog",
          figures: figuresFromRows(recorded, {
            label: (r) => r.label,
            value: (r) => r.records,
            unit: "records",
            limit: 8,
          }),
        });
  const top = recorded[0];
  // layout text only: built from the live rows by a fixed template, never model output
  const stub = top
    ? [
        `${top.label} is the largest collection, with ${top.records!.toLocaleString("en-US")} records.`,
        `The catalog lists ${recorded.length} collections for this area.`,
        "The figures do not show why the collections differ in size.",
      ]
    : ["Stub text for the layout."];
  const noop = () => undefined;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-4">
          <p className="m-0 text-label">AskAiButton</p>
          <div className="flex flex-wrap items-center gap-2">
            <AskAiButtonView
              availability="ready"
              name="Products & safety collections"
              onAsk={noop}
            />
            <AskAiButtonView
              availability="ready"
              size="md"
              name="Products & safety collections"
              onAsk={noop}
            />
            <AskAiButtonView
              availability="ready"
              size="icon"
              name="Products & safety collections"
              onAsk={noop}
            />
            <AskAiButtonView availability="waiting" name="a section still loading" />
            <AskAiButtonView availability="unconfigured" name="Products & safety collections" />
          </div>
          <p className="m-0 text-meta text-muted-foreground">
            Small, medium, icon only, waiting for figures, and AI not configured (the tooltip and a
            toast say so; the button stays focusable). The live button below opens the assistant
            with this section attached.
          </p>
          <div className="flex items-center gap-2">
            {context ? (
              <AskAiButton context={context} sectionId={`kit-${panel}-ai-section`} />
            ) : (
              <AskAiButtonView availability="waiting" name="a section still loading" />
            )}
            <span className="text-meta text-muted-foreground">
              Live: {context ? `${context.figures.length} figures from the catalog` : "loading"}
            </span>
          </div>
        </Card>
        <div className="space-y-4">
          <AiSummary context={context} />
          <p className="m-0 text-meta text-muted-foreground">
            Live: Summarize reads the figures above through the server; where AI is not configured
            this strip says so instead of failing.
          </p>
        </div>
      </div>
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AiSummaryView state={{ kind: "idle" }} onSummarize={noop} />
        <AiSummaryView state={{ kind: "loading" }} />
        <AiSummaryView
          state={{ kind: "ready", bullets: stub, omitted: 0, cached: false, generatedAt: "stub" }}
          provenance="Products & safety collections. Source: Corpus catalog"
        />
        <AiSummaryView
          state={{
            kind: "ready",
            bullets: stub.slice(0, 2),
            omitted: 1,
            cached: true,
            generatedAt: "stub",
          }}
        />
        <AiSummaryView
          state={{
            kind: "error",
            message: "The summary could not be generated right now.",
          }}
          onSummarize={noop}
        />
        <AiSummaryView
          state={{
            kind: "rate_limited",
            message: "Too many summaries in a short time. Try again in 3 minutes.",
            retryAfterSec: 180,
          }}
          onSummarize={noop}
        />
        <AiSummaryView state={{ kind: "unconfigured", message: AI_UNCONFIGURED }} />
        <AiSummaryView state={{ kind: "empty" }} />
        <AiSummaryView state={{ kind: "thin", message: AI_THIN }} />
      </div>
      <p className="m-0 text-meta text-muted-foreground">
        The state examples show stub text built from the live rows, not model output.
      </p>
    </div>
  );
}

function Specimens({ panel }: { panel: string }) {
  const [tab, setTab] = useState("courts");
  const [segment, setSegment] = useState("states");
  const tabItems = PRIMARY_NAVIGATION.map((n) => ({ id: n.id, label: n.label }));
  return (
    <div className="space-y-10">
      <Specimen
        id={`${panel}-strip`}
        name="HeaderStrip + HeaderMenu"
        note="the one header: breadcrumb, title, a menu of links and dropdown panels, search, Ask AI. The Caseload panel is open; below 768 px the menu is one button that opens a sheet"
      >
        <div className="min-h-[27rem] overflow-visible rounded-xl border border-border bg-card shadow-xs">
          <HeaderStrip
            title="Courts & judges"
            description="Federal, state and tribal courts, and the judges who sit on them."
            breadcrumbs={[{ label: "Courts & judges", to: "/courts" }, { label: "Vacancies" }]}
            menu={sectionMenu("/courts/vacancies")}
            menuTitle="Courts & judges"
            menuLabel={`Section (${panel}, desktop)`}
            titleAs="h2"
            defaultOpenMenu="courts:caseload"
            search={
              <div className="relative hidden w-56 shrink-0 md:block lg:w-72">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  aria-label={`Search research (${panel})`}
                  placeholder="Search research"
                  className="h-9 pl-9"
                />
              </div>
            }
            askAi={
              <Button variant="outline" className="h-9 shrink-0 gap-1.5 px-2.5 md:h-9">
                <MessageCircle className="size-4 text-brand" aria-hidden />
                <span className="hidden sm:inline">Ask AI</span>
              </Button>
            }
            actions={<Button size="sm">Export</Button>}
          />
        </div>
      </Specimen>
      <Specimen
        id={`${panel}-strip-phone`}
        name="HeaderStrip, phone width"
        note="below 768 px the menu is one button labelled with the current page; it opens a sheet with every destination and its line"
      >
        <div className="w-[390px] max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <HeaderStrip
            compact
            titleAs="h2"
            title="Judicial vacancies"
            breadcrumbs={[{ label: "Courts & judges", to: "/courts" }, { label: "Vacancies" }]}
            menu={sectionMenu("/courts/vacancies")}
            menuTitle="Courts & judges"
            menuLabel={`Section (${panel}, phone)`}
            askAi={
              <Button
                variant="outline"
                size="icon"
                className="size-9 shrink-0"
                aria-label={`Ask AI (${panel})`}
              >
                <MessageCircle className="size-4 text-brand" aria-hidden />
              </Button>
            }
          />
        </div>
      </Specimen>

      <Specimen
        id={`${panel}-header`}
        name="PageHeader + PageTabs"
        note="nine tabs: six show, the rest sit under More"
      >
        <Card className="p-5">
          <PageHeader
            breadcrumbs={[{ label: "Prototypes", to: "/prototypes" }, { label: "Page kit" }]}
            title="Courts & judges"
            titleAs="h2"
            description="Every court and judge in the directory, caseloads, vacancies and comparisons."
            actions={
              <>
                <InfoPopover label="About this page" showLabel>
                  <p>Method notes and caveats sit here instead of inline prose.</p>
                </InfoPopover>
                <Button variant="outline" size="sm">
                  <Download />
                  Export
                </Button>
              </>
            }
            tabs={
              <PageTabs
                label="Sections"
                idPrefix={`kit-${panel}`}
                items={tabItems}
                value={tab}
                onValueChange={setTab}
              />
            }
          />
        </Card>
      </Specimen>

      <Specimen
        id={`${panel}-kpis`}
        name="Section + KpiGrid + KpiCard"
        note="catalog record counts, live"
      >
        <Section
          title="Courts & judges"
          description="Headline record counts, each linked to its dataset"
          actions={<InfoPopover>{"Counts are the catalog's stored record counts."}</InfoPopover>}
        >
          <HubKpis items={HUBS.courts.kpis} label="Courts figures" />
        </Section>
      </Specimen>

      <Specimen name="KpiCard with delta, sparkline, partial pill" note="the Insights tiles, live">
        <LiveTiles />
      </Specimen>

      <Specimen name="KpiStrip" note="one card, cells divided by hairlines, live">
        <LiveStrip />
      </Specimen>

      <Specimen
        id={`${panel}-chart`}
        name="ChartCard + BarList + DataDrawer"
        note="takeaway title, bars with values, View data opens the table, source and CSV (live)"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <LiveChart />
          <div className="space-y-4">
            <LiveInlineData />
            <Card className="p-4">
              <p className="m-0 mb-2 text-label">ShowMore</p>
              <ShowMore
                items={HUBS.overview.links}
                initial={3}
                noun="sections"
                render={(shown) => (
                  <ul className="m-0 list-none divide-y divide-border rounded-lg border border-border p-0">
                    {shown.map((l) => (
                      <ListRow key={l.to} to={l.to} title={l.label} description={l.description} />
                    ))}
                  </ul>
                )}
              />
              <p className="m-0 mt-4 mb-1 text-label">ShowMoreText</p>
              <ShowMoreText lines={2} className="text-[13px] leading-5 text-muted-foreground">
                {MOVEMENT_RULE.text} A change is a difference between two published figures, not a
                finding that anything caused it; several series compare a month with the same month
                a year earlier, as their text says.
              </ShowMoreText>
            </Card>
          </div>
        </div>
      </Specimen>

      <Specimen name="KpiCard states" note="loading, error, empty and not recorded">
        <KpiGrid columns={4} label="KPI card states">
          <KpiCard as="li" label="Loading" state="loading" trend={null} />
          <KpiCard
            as="li"
            label="Read failure"
            state="error"
            errorText="Could not be read just now."
            onRetry={() => undefined}
          />
          <KpiCard
            as="li"
            label="Nothing published"
            state="empty"
            emptyText="No national value is published."
          />
          <KpiCard
            as="li"
            label="Value not recorded"
            value={null}
            deltaNote="No complete period is recorded."
          />
        </KpiGrid>
      </Specimen>

      <Specimen
        id={`${panel}-states`}
        name="Recipe states"
        note="ChartCard loading, empty and error; KpiCard partial; DataDrawer and BarList without values"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <ChartCard
            title="Loading state"
            subtitle="The card keeps its height"
            state="loading"
            height={120}
          />
          <ChartCard
            title="Empty state"
            subtitle="Nothing is published for the period"
            state="empty"
            height={120}
            emptyText="Not recorded for this period."
          />
          <ChartCard
            title="Error state"
            subtitle="The read failed; the rest of the page is unaffected"
            state="error"
            onRetry={() => undefined}
            height={120}
          />
          <KpiCard
            label="Partial period"
            value={null}
            partial="The latest period is partial and is not the latest value."
            deltaNote="No complete period to compare with."
            source={{ source: { label: "Source named here" }, about: <p>Method and caveats.</p> }}
          />
          <Card className="p-4">
            <p className="m-0 text-label">DataDrawer without rows</p>
            <DataDrawer
              mode="inline"
              title="Empty table"
              rows={[] as SafetyRow[]}
              rowKey={(r) => r.dataset}
              columns={SAFETY_COLUMNS}
              emptyText="Not recorded"
            />
          </Card>
          <Card className="p-4">
            <p className="m-0 mb-3 text-label">BarList with a missing value</p>
            <BarList
              ariaLabel="A value not recorded"
              items={[{ id: "gap", label: "A state without a value", value: null, display: "" }]}
            />
          </Card>
        </div>
      </Specimen>

      <Specimen
        id={`${panel}-footer`}
        name="SourceFooter"
        note="a long source, a period and an as-of date wrap inside cards of three widths; the About button stays put"
      >
        <div className="flex flex-wrap items-start gap-4">
          {[17, 24, 36].map((rem) => (
            <Card key={rem} className="w-full" style={{ maxWidth: `${rem}rem` }}>
              <CardBody className="pt-4 text-[13px] text-muted-foreground">
                A card {rem} rem wide
              </CardBody>
              <CardFooter>
                <SourceFooter
                  className="flex-1"
                  source={{
                    label:
                      "Judicial Panel on Multidistrict Litigation, Statistical Analysis of Multidistrict Litigation, pending actions by report",
                    href: "https://www.jpml.uscourts.gov/",
                  }}
                  period="FY1992–FY2025"
                  asOf="Oct 1, 2026"
                  partial="FY2026 is a partial period and is not the latest value."
                  about={<p>Method and caveats stay in this popover.</p>}
                />
              </CardFooter>
            </Card>
          ))}
        </div>
      </Specimen>

      <Specimen id={`${panel}-insight`} name="InsightCallout" note="today's safety insight, live">
        <LiveInsight />
      </Specimen>

      <Specimen
        id={`${panel}-links`}
        name="Section + LinkTile"
        note="the Overview's section links with live counts"
      >
        <HubLinks
          links={HUBS.overview.links.slice(0, 3)}
          title="Sections"
          description="Every part of the platform, with a record count from the catalog."
        />
      </Specimen>

      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen name="Card + CardHeader + ListRow + CardFooter">
          <Card as="nav" aria-label={`Insights tools (${panel})`}>
            <CardHeader
              title="Analyse"
              description="Compare, rank, map and explain"
              actions={
                <InfoPopover label="About these tools">
                  <p>Each tool opens on live data with its own source footer.</p>
                </InfoPopover>
              }
            />
            <ul className="m-0 list-none divide-y divide-border border-t border-border p-0">
              {TOOLS.slice(0, 4).map((t) => (
                <ListRow key={t.to} to={t.to} icon={t.icon} title={t.label} description={t.text} />
              ))}
            </ul>
            <CardFooter>
              <SourceFooter
                className="flex-1"
                source={{ label: "Insights metric registry", href: "/insights" }}
                about={<p>The tools read the platform&apos;s own metric layer.</p>}
              />
            </CardFooter>
          </Card>
        </Specimen>
        <Specimen name="StatusPill · PartialPill · DeltaPill · Badge">
          <Card>
            <CardBody className="space-y-4 pt-4">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="good">Verified</StatusPill>
                <StatusPill tone="warning">Review</StatusPill>
                <StatusPill tone="serious">Elevated</StatusPill>
                <StatusPill tone="critical">High</StatusPill>
                <StatusPill tone="info">New</StatusPill>
                <StatusPill tone="neutral">Not recorded</StatusPill>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <PartialPill note="The latest period is partial and is not the latest value." />
                <DeltaPill delta={{ value: 1, text: "Up" }} />
                <DeltaPill delta={{ value: -1, text: "Down" }} />
                <DeltaPill delta={{ value: 0, text: "No change" }} />
                <DeltaPill delta={{ value: 1, text: "Up, agreed good", goodDirection: "up" }} />
                <DeltaPill delta={{ value: -1, text: "Down, agreed bad", goodDirection: "up" }} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="destructive">Destructive</Badge>
              </div>
            </CardBody>
          </Card>
        </Specimen>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen name="EmptyState">
          <div className="grid gap-3 sm:grid-cols-2">
            <EmptyState
              compact
              icon={SearchX}
              title="No state matches"
              description="Try its full name or two-letter abbreviation."
            />
            <EmptyState
              compact
              tone="error"
              title="Record counts could not be loaded."
              action={
                <Button size="sm" variant="outline">
                  Retry
                </Button>
              }
            />
          </div>
        </Specimen>
        <Specimen name="Skeletons" note="sized like the content">
          <div className="grid gap-3 sm:grid-cols-2">
            <KpiCardSkeleton trend />
            <Card>
              <ListSkeleton rows={3} />
            </Card>
            <CardSkeleton lines={2} />
            <Card className="p-4">
              <ChartSkeleton height={72} />
            </Card>
          </div>
        </Specimen>
      </div>

      <Specimen
        id={`${panel}-ai`}
        name="AskAiButton + AiSummary"
        note="section-scoped AI: a button that attaches the section, a cached 'What this shows' (live figures; state examples are stub text)"
      >
        <AiSpecimen panel={panel} />
      </Specimen>

      <Specimen
        id={`${panel}-ui`}
        name="ui primitives"
        note="restyled shadcn components, same APIs"
      >
        <Card>
          <CardBody className="space-y-5 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Primary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
              <Button variant="destructive">Destructive</Button>
              <Button size="sm">Small</Button>
              <Button disabled>Disabled</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input aria-label={`Example input (${panel})`} placeholder="Name or abbreviation" />
              <Select value={segment} onValueChange={setSegment}>
                <SelectTrigger aria-label={`Example select (${panel})`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="states">States</SelectItem>
                  <SelectItem value="counties">Counties</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm">
                        Tooltip
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Readable tooltip on the near-black primary.</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      Dialog
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Dialog title</DialogTitle>
                      <DialogDescription>
                        Dialogs use the popover surface, a 12 px radius and a soft overlay.
                      </DialogDescription>
                    </DialogHeader>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
            <Tabs defaultValue="states">
              <TabsList>
                <TabsTrigger value="states">States</TabsTrigger>
                <TabsTrigger value="counties">Counties</TabsTrigger>
                <TabsTrigger value="cities">Cities</TabsTrigger>
              </TabsList>
              <TabsContent value="states" className="text-meta text-muted-foreground">
                Segmented tabs (Radix) for in-card switches.
              </TabsContent>
              <TabsContent value="counties" className="text-meta text-muted-foreground">
                Counties panel.
              </TabsContent>
              <TabsContent value="cities" className="text-meta text-muted-foreground">
                Cities panel.
              </TabsContent>
            </Tabs>
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Section</TableHead>
                    <TableHead>Path</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PRIMARY_NAVIGATION.slice(0, 4).map((n) => (
                    <TableRow key={n.id}>
                      <TableCell className="font-medium">{n.label}</TableCell>
                      <TableCell className="font-mono text-meta text-muted-foreground">
                        {n.to}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardBody>
        </Card>
      </Specimen>
    </div>
  );
}

function Page() {
  return (
    <AppShell
      title="Page kit"
      description="The shared building blocks of the workspace on live data, in a light and a dark panel."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Prototypes", to: "/prototypes" },
        { label: "Page kit" },
      ]}
      actions={
        <InfoPopover label="About this page" showLabel>
          <p>
            Every figure here is live: catalog record counts, the Insights tiles and today&apos;s
            insight. The other examples carry navigation text and state labels only.
          </p>
          <p>Popovers, menus and dialogs open in the page&apos;s own theme (top bar toggle).</p>
        </InfoPopover>
      }
    >
      <SectionIndex
        className="mb-6"
        label="Specimens"
        items={[
          { id: "light-strip", label: "Header strip" },
          { id: "light-header", label: "Header & tabs" },
          { id: "light-kpis", label: "KPIs" },
          { id: "light-chart", label: "Chart card & data" },
          { id: "light-states", label: "States" },
          { id: "light-footer", label: "Footer" },
          { id: "light-insight", label: "Insight" },
          { id: "light-links", label: "Links" },
          { id: "light-ai", label: "AI" },
          { id: "light-ui", label: "Primitives" },
          { id: "kit-dark-panel", label: "Dark theme" },
        ]}
      />
      <div className="space-y-8">
        <section
          aria-labelledby="kit-light"
          className="light rounded-2xl border border-border bg-background p-4 text-foreground sm:p-6"
        >
          <h2 id="kit-light" className="mb-6 text-heading">
            Light
          </h2>
          <Specimens panel="light" />
        </section>
        <section
          aria-labelledby="kit-dark"
          id="kit-dark-panel"
          className="dark scroll-mt-16 rounded-2xl border border-border bg-background p-4 text-foreground sm:p-6"
        >
          <h2 id="kit-dark" className="mb-6 text-heading">
            Dark
          </h2>
          <Specimens panel="dark" />
        </section>
      </div>
    </AppShell>
  );
}
