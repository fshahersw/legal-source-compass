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
  ScatterChart,
  SearchX,
} from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { HubKpis, HubLinks } from "@/components/atlas/hub/SectionHub";
import { HUBS } from "@/components/atlas/hub/hubs";
import { KpiTile } from "@/components/insights/OverviewBoard";
import { HUB_BLOCK_TOPIC, kpiFromBlock } from "@/components/insights/kpis";
import { dailyInsightQuery, formatDayKey } from "@/components/insights/insightQueries";
import { analyticsBlockQuery } from "@/components/analytics/hub/blockQuery";
import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardSkeleton,
  ChartSkeleton,
  DeltaPill,
  EmptyState,
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
  SourceFooter,
  StatusPill,
} from "@/components/kit";
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
import { blockDef } from "@/lib/analytics/registry";
import { PRIMARY_NAVIGATION } from "@/lib/atlas/navigation";
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
  children,
  className,
}: {
  name: string;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)}>
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
    <KpiGrid columns={2} className="xl:grid-cols-3" label="Live KPI cards">
      {LIVE_BLOCKS.map((id, i) => {
        const q = qs[i]!;
        const title = blockDef(id)?.title ?? id;
        const topic = HUB_BLOCK_TOPIC[id]!;
        const state = q.isPending
          ? ({ kind: "loading", id, topic, title } as const)
          : q.isError
            ? ({ kind: "error", id, topic, title, retry: () => void q.refetch() } as const)
            : q.data.status === "empty"
              ? ({ kind: "empty", id, topic, title, reason: q.data.reason } as const)
              : ({ kind: "ok", kpi: kpiFromBlock(q.data.data, title, topic) } as const);
        return <KpiTile key={id} state={state} />;
      })}
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

function Specimens({ panel }: { panel: string }) {
  const [tab, setTab] = useState("courts");
  const [segment, setSegment] = useState("states");
  const tabItems = PRIMARY_NAVIGATION.map((n) => ({ id: n.id, label: n.label }));
  return (
    <div className="space-y-10">
      <Specimen name="PageHeader + PageTabs" note="nine tabs: six show, the rest sit under More">
        <Card className="p-5">
          <PageHeader
            breadcrumbs={[{ label: "Prototypes", to: "/prototypes" }, { label: "Page kit" }]}
            title="Courts & judges"
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

      <Specimen name="Section + KpiGrid + KpiCard" note="catalog record counts, live">
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

      <Specimen name="InsightCallout" note="today's safety insight, live">
        <LiveInsight />
      </Specimen>

      <Specimen name="Section + LinkTile" note="the Overview's section links with live counts">
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

      <Specimen name="ui primitives" note="restyled shadcn components, same APIs">
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
          className="dark rounded-2xl border border-border bg-background p-4 text-foreground sm:p-6"
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
