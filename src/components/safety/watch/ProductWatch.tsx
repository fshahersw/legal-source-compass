/**
 * Product watch (/safety/products, the default view): which products' FDA reports are rising faster than their source
 * as a whole, which of them no MDL is linked to, which are already in an MDL and still climbing, and where death
 * reports are rising. Opens with the counts and an AI summary, then the momentum map of every rated product, the
 * emerging cards, a forest plot of litigated products, a forest plot of death reports and the device product codes.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { ChartCard, type TableSpec } from "@/components/charts/ChartCard";
import { InfoPopover } from "@/components/kit/InfoPopover";
import { KpiStrip } from "@/components/kit/KpiCard";
import { Section } from "@/components/kit/Section";
import { SectionIndex } from "@/components/kit/SectionIndex";
import { AiSummary, buildSectionContext } from "@/components/kit/ai";
import { Input } from "@/components/ui/input";
import { formatMonth } from "@/components/safety/products/productModel";
import { cn } from "@/lib/utils";
import { chartTokens } from "@/components/charts/palette";
import { ForestPlot, type ForestRow } from "./ForestPlot";
import { MomentumMap } from "./MomentumMap";
import { STATUS_COLOR } from "./watchColors";
import { productWatchQuery } from "./watchQuery";
import { WatchCardTile } from "./WatchCards";
import {
  MIN_RATED,
  poissonLimits,
  SIGNAL_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  type MdlStatus,
  type WatchCard,
  type WatchView,
} from "./watchModel";

const n = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(v).toLocaleString("en-US")
    : "Not recorded";
const signed = (v: number) => `${v >= 1 ? "+" : "−"}${Math.abs(v * 100 - 100).toFixed(1)}%`;

const SOURCES = [
  { id: "all", label: "Drugs and devices" },
  { id: "faers", label: "Drugs (FAERS)" },
  { id: "maude", label: "Devices (MAUDE)" },
] as const;
type SourceFilter = (typeof SOURCES)[number]["id"];

function Method({ view }: { view: WatchView }) {
  const f = view.factors;
  return (
    <div className="space-y-2">
      <p>
        Each product&apos;s reports in its source&apos;s last 12 complete months are compared with
        the 12 months before. The prior count is first scaled by the change in all reports from the
        same system (FAERS {signed(f.faers.reports)}, MAUDE {signed(f.maude.reports)}), so a product
        only reads as rising when it outpaces its source as a whole.
      </p>
      <p>
        The ratio is reports ÷ expected. Its 95% interval comes from the count&apos;s own noise
        (Byar&apos;s approximation to the exact Poisson limits). Rising: the interval&apos;s lower
        end is above 1×; rising sharply: at least 1.5×; falling: its upper end is below 1×. Products
        with fewer than {MIN_RATED} reports in the last 12 months are not rated.
      </p>
      <p>
        MDL status uses recorded links only: the product&apos;s own MDL links and the emerging-tort
        radar&apos;s exact, brand, class and reviewed links. &quot;No MDL linked&quot; does not mean
        no litigation exists. Device product codes carry no MDL keys, so they are shown as &quot;MDL
        links not keyed&quot;.
      </p>
      <p>
        Reports are voluntary and unverified; they rise with use, publicity and litigation itself,
        and a rise does not show that a product caused harm.
      </p>
    </div>
  );
}

function forestRows(cards: readonly WatchCard[], deaths = false): ForestRow[] {
  return cards.flatMap((c) => {
    const observed = deaths ? c.deaths : c.recent;
    const expected = deaths ? c.deathsExpected : c.expected;
    if (observed === null || expected === null || expected <= 0) return [];
    const { lower, upper } = poissonLimits(observed);
    return [
      {
        id: c.id,
        label: c.label,
        note: deaths
          ? `${n(c.deathsPrior)} → ${n(observed)} death reports · ${STATUS_LABEL[c.status]}`
          : `MDL ${c.mdls
              .filter((m) => m.status === "pending")
              .slice(0, 3)
              .map((m) => m.mdl)
              .join(
                ", ",
              )}${c.actionsPending !== null ? ` · ${n(c.actionsPending)} actions pending` : ""}`,
        ratio: observed / expected,
        lower: lower / expected,
        upper: upper / expected,
        observed,
        expected,
        color: STATUS_COLOR[c.status],
      },
    ];
  });
}

function forestTable(cards: readonly WatchCard[], caption: string, deaths = false): TableSpec {
  return {
    caption,
    columns: [
      { label: "Product" },
      { label: "Source" },
      { label: "MDL status" },
      { label: deaths ? "Death reports, prior 12" : "Prior 12 months", align: "right" },
      { label: deaths ? "Death reports, last 12" : "Last 12 months", align: "right" },
      { label: "Expected", align: "right" },
      { label: "Ratio", align: "right" },
      { label: "Through" },
    ],
    rows: cards.map((c) => {
      const prior = deaths ? c.deathsPrior : c.prior;
      const recent = deaths ? c.deaths : c.recent;
      const expected = deaths ? c.deathsExpected : c.expected;
      return {
        key: c.id,
        cells: [
          c.label,
          SOURCE_LABEL[c.source],
          `${STATUS_LABEL[c.status]}${c.mdls.length ? ` (${c.mdls.map((m) => m.mdl).join(", ")})` : ""}`,
          n(prior),
          n(recent),
          n(expected),
          recent !== null && expected ? `${(recent / expected).toFixed(2)}×` : "Not rated",
          formatMonth(c.end),
        ],
      };
    }),
  };
}

export function ProductWatch() {
  const query = useQuery(productWatchQuery);
  const view = query.data?.view ?? null;
  const [source, setSource] = useState<SourceFilter>("all");
  const [visible, setVisible] = useState<Set<MdlStatus>>(
    () => new Set<MdlStatus>(["none", "pending", "closed", "unkeyed"]),
  );
  const [q, setQ] = useState("");
  const points = useMemo(
    () => (view ? view.points.filter((p) => source === "all" || p.source === source) : []),
    [view, source],
  );
  const highlight = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return new Set<string>();
    return new Set(
      points
        .filter((p) => p.label.toLowerCase().includes(needle))
        .slice(0, 8)
        .map((p) => p.id),
    );
  }, [points, q]);
  const labelled = useMemo(() => {
    if (!view) return [];
    const pool = [...view.emerging, ...view.litigated.slice(0, 3), ...view.devices.slice(0, 2)];
    return pool
      .filter((c) => source === "all" || c.source === source)
      .slice(0, 10)
      .map((c) => c.id);
  }, [view, source]);
  const context = useMemo(() => {
    if (!view) return null;
    return buildSectionContext({
      title: "Product watch",
      scope: "FDA FAERS drug and MAUDE device reports by product, with recorded MDL links",
      period: `12 months to ${formatMonth(view.asOf.faers ?? "")} (FAERS) and ${formatMonth(view.asOf.maude ?? "")} (MAUDE) vs the 12 months before`,
      source: "FDA FAERS and MAUDE via openFDA; JPML pending report",
      figures: [
        { label: "Products monitored", value: view.counts.monitored },
        { label: "Products rated (50+ reports)", value: view.counts.rated },
        { label: "Rising sharply", value: view.counts.bySignal.sharp },
        { label: "Rising", value: view.counts.bySignal.rising },
        { label: "Falling", value: view.counts.bySignal.falling },
        { label: "Drugs rising with no MDL linked", value: view.counts.risingNoMdl },
        { label: "Products in a pending MDL and rising", value: view.counts.risingPending },
        { label: "Products with death reports rising", value: view.counts.deathsRising },
        { label: "All FAERS reports, change", value: signed(view.factors.faers.reports) },
        { label: "All MAUDE reports, change", value: signed(view.factors.maude.reports) },
        ...view.emerging.slice(0, 6).map((c) => ({
          label: `${c.label} (no MDL linked): reports vs expected`,
          value: c.ratio === null ? `${n(c.recent)} new reports` : `${c.ratio.toFixed(2)}×`,
          note: c.uptake ? "rapid uptake" : undefined,
        })),
        ...view.litigated.slice(0, 4).map((c) => ({
          label: `${c.label} (pending MDL): reports vs expected`,
          value: c.ratio === null ? null : `${c.ratio.toFixed(2)}×`,
        })),
        ...view.deaths.slice(0, 4).map((c) => ({
          label: `${c.label}: death reports prior → last 12 months`,
          value: `${n(c.deathsPrior)} → ${n(c.deaths)}`,
        })),
      ],
      maxFigures: 30,
    });
  }, [view]);

  if (query.isPending)
    return (
      <div className="space-y-3" role="status" aria-label="Loading the product watch">
        <div className="h-28 animate-pulse rounded-xl border border-border bg-muted/40" />
        <div className="h-[440px] animate-pulse rounded-xl border border-border bg-muted/30" />
      </div>
    );
  if (query.isError)
    return (
      <p role="alert" className="rounded-md border border-border p-3 text-sm">
        The product watch could not be read just now.{" "}
        <button
          type="button"
          className="text-primary underline"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </p>
    );
  if (!view)
    return (
      <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
        The product watch is not published yet.
      </p>
    );

  const c = view.counts;
  const asOfText = `FAERS to ${formatMonth(view.asOf.faers ?? "")} · MAUDE to ${formatMonth(view.asOf.maude ?? "")}`;
  const mapTable: TableSpec = {
    caption: `Products on the momentum map (${points.filter((p) => visible.has(p.status)).length}), by reports in the last 12 months.`,
    columns: [
      { label: "Product" },
      { label: "Source" },
      { label: "Last 12 months", align: "right" },
      { label: "Against expected", align: "right" },
      { label: "Signal" },
      { label: "MDL status" },
    ],
    rows: points
      .filter((p) => visible.has(p.status))
      .slice(0, 400)
      .map((p) => ({
        key: p.id,
        cells: [
          p.label,
          SOURCE_LABEL[p.source],
          n(p.recent),
          `${p.ratio.toFixed(2)}×`,
          SIGNAL_LABEL[p.signal],
          STATUS_LABEL[p.status],
        ],
      })),
  };
  const lead = view.emerging[0];
  return (
    <div className="min-w-0 space-y-6">
      <section aria-label="Product watch summary" className="space-y-3">
        <KpiStrip
          label="Product watch"
          cellBasis="basis-[calc(50%-1px)] md:basis-[calc(33.333%-1px)] xl:basis-[calc(20%-1px)]"
          items={[
            {
              key: "monitored",
              label: "Products monitored",
              value: n(c.monitored),
              meta: `${n(c.bySource.faers)} drugs · ${n(c.bySource.maude)} device codes · MDL groups`,
            },
            {
              key: "rising",
              label: "Rising faster than their source",
              value: n(c.bySignal.sharp + c.bySignal.rising),
              meta: `${n(c.bySignal.sharp)} sharply · ${n(c.bySignal.falling)} falling`,
            },
            {
              key: "nomdl",
              label: "Drugs rising, no MDL linked",
              value: n(c.risingNoMdl),
              meta: lead ? `Leading: ${lead.label}` : "None",
            },
            {
              key: "pending",
              label: "In a pending MDL and rising",
              value: n(c.risingPending),
              meta: `${n(c.pendingMdls)} pending MDLs linked on the watch`,
            },
            {
              key: "deaths",
              label: "Death reports rising",
              value: n(c.deathsRising),
              meta: "against the source-wide change",
            },
          ]}
        />
        <AiSummary context={context} title="AI watch brief" />
      </section>

      <SectionIndex
        items={[
          { id: "watch-map", label: "Momentum map" },
          { id: "watch-emerging", label: "No MDL linked" },
          { id: "watch-litigated", label: "In litigation" },
          { id: "watch-deaths", label: "Death reports" },
          { id: "watch-devices", label: "Device codes" },
        ]}
      />

      <Section
        id="watch-map"
        title="Where every product sits"
        description="Each dot is a product. Across: its reports in the last 12 months. Up: those reports against the count its own past predicts after the source-wide change. The shaded upper half is rising faster than its source."
      >
        <ChartCard
          title={
            lead && lead.ratio !== null
              ? `${n(c.bySignal.sharp + c.bySignal.rising)} products are rising faster than their source; ${lead.label} leads those with no MDL linked at ${lead.ratio >= 10 ? lead.ratio.toFixed(0) : lead.ratio.toFixed(1)}×`
              : `${n(c.bySignal.sharp + c.bySignal.rising)} products are rising faster than their source`
          }
          subtitle={`Reports per product, last 12 months vs expected · ${asOfText}`}
          table={mapTable}
          sources={[
            {
              label: "openFDA drug adverse events (FAERS)",
              url: "https://open.fda.gov/apis/drug/event/",
            },
            {
              label: "openFDA device adverse events (MAUDE)",
              url: "https://open.fda.gov/apis/device/event/",
            },
          ]}
          period={asOfText}
          about={<Method view={view} />}
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={source === s.id}
                  onClick={() => setSource(s.id)}
                  className={cn(
                    "min-h-8 rounded-full border px-2.5 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-ring",
                    source === s.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-foreground/80 hover:bg-muted",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          }
          minHeight={420}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="MDL status shown"
              style={chartTokens}
            >
              {(["none", "pending", "closed", "unkeyed"] as MdlStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={visible.has(s)}
                  onClick={() =>
                    setVisible((prev) => {
                      const next = new Set(prev);
                      if (next.has(s) && next.size > 1) next.delete(s);
                      else next.add(s);
                      return next;
                    })
                  }
                  className={cn(
                    "inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 text-[12px] focus-visible:outline-2 focus-visible:outline-ring",
                    visible.has(s)
                      ? "border-border bg-surface text-foreground"
                      : "border-dashed border-border text-muted-foreground opacity-60",
                  )}
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: STATUS_COLOR[s] }}
                    aria-hidden
                  />
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <span
              className="inline-flex items-center gap-1.5 text-meta text-muted-foreground"
              style={chartTokens}
            >
              <span className="size-2.5 rounded-full bg-[var(--chart-base)]" aria-hidden />
              Not rising (any status)
            </span>
            <label className="relative flex items-center">
              <span className="sr-only">Find a product on the map</span>
              <Search
                className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a product"
                className="h-8 w-48 pl-7 text-[13px]"
              />
            </label>
          </div>
          <MomentumMap
            points={points}
            labelled={labelled}
            highlight={highlight}
            visible={visible}
          />
          {q.trim().length >= 2 ? (
            <p className="mt-1 text-meta text-muted-foreground" aria-live="polite">
              {highlight.size
                ? `${highlight.size} match${highlight.size > 1 ? "es" : ""} drawn large`
                : "No product on the map matches"}
            </p>
          ) : null}
        </ChartCard>
      </Section>

      <Section
        id="watch-emerging"
        title="Rising with no MDL linked"
        description="Drugs whose reports outpace FAERS as a whole and that no recorded MDL link reaches. A lead to read, not a finding: check each flag before reading a rise as a safety signal."
        actions={
          <InfoPopover label="How the watch works" showLabel>
            <Method view={view} />
          </InfoPopover>
        }
      >
        {view.emerging.length ? (
          <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {view.emerging.map((card) => (
              <WatchCardTile key={card.id} card={card} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No drug with no MDL linked is rising faster than FAERS.
          </p>
        )}
      </Section>

      <Section
        id="watch-litigated"
        title="Already in a pending MDL and still rising"
        description="Products a pending MDL is linked to whose reports are still climbing faster than their source. Litigation itself drives reporting, so read these as context for an active docket."
      >
        <ChartCard
          title={
            view.litigated[0] && view.litigated[0].ratio !== null
              ? `${view.litigated[0].label} reports run ${view.litigated[0].ratio.toFixed(1)}× expected while MDL ${view.litigated[0].mdls.find((m) => m.status === "pending")?.mdl ?? ""} is pending`
              : "Products in a pending MDL with rising reports"
          }
          subtitle="Reports in the last 12 months against expected · dot = ratio, line = 95% interval"
          table={forestTable(view.litigated, "Products in a pending MDL with rising reports.")}
          about={<Method view={view} />}
          minHeight={200}
          status={
            view.litigated.length
              ? undefined
              : {
                  kind: "empty",
                  reason: "No product in a pending MDL is rising faster than its source.",
                }
          }
        >
          <ForestPlot
            rows={forestRows(view.litigated)}
            unit="reports"
            ariaLabel="Products in a pending MDL: reports in the last 12 months against expected, with 95% intervals."
          />
        </ChartCard>
      </Section>

      <Section
        id="watch-deaths"
        title="Death reports rising"
        description="Reports that record a death as an outcome, against the count expected from the prior 12 months after the change in all death reports from the same system. A death report does not establish that the product caused the death."
      >
        <ChartCard
          title={
            view.deaths[0]
              ? `${view.deaths[0].label}: death reports went from ${n(view.deaths[0].deathsPrior)} to ${n(view.deaths[0].deaths)}`
              : "Products with rising death reports"
          }
          subtitle="Death reports in the last 12 months against expected · dot = ratio, line = 95% interval"
          table={forestTable(view.deaths, "Products with rising death reports.", true)}
          about={<Method view={view} />}
          minHeight={200}
          status={
            view.deaths.length
              ? undefined
              : {
                  kind: "empty",
                  reason: "No product's death reports are rising faster than its source.",
                }
          }
        >
          <ForestPlot
            rows={forestRows(view.deaths, true)}
            unit="death reports"
            ariaLabel="Products with rising death reports: last 12 months against expected, with 95% intervals."
          />
          <p
            className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-meta text-muted-foreground"
            style={chartTokens}
          >
            {(["none", "pending", "closed", "unkeyed"] as MdlStatus[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: STATUS_COLOR[s] }}
                  aria-hidden
                />
                {STATUS_LABEL[s]}
              </span>
            ))}
          </p>
        </ChartCard>
      </Section>

      <Section
        id="watch-devices"
        title="Device product codes rising"
        description="FDA device product codes whose MAUDE reports outpace MAUDE as a whole. Device reports often arrive in batches; the one-month flag marks where a single month holds most of the year."
      >
        {view.devices.length ? (
          <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {view.devices.map((card) => (
              <WatchCardTile key={card.id} card={card} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No device product code is rising faster than MAUDE.
          </p>
        )}
      </Section>
      <p className="text-meta text-muted-foreground">
        Reports are voluntary and unverified and do not establish that a product caused an event.
        Counts change as FDA adds, merges and revises reports.{" "}
        {view.dropped ? `${view.dropped} malformed rows were left out.` : ""}
      </p>
    </div>
  );
}
