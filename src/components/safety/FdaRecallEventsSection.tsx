/**
 * /safety: FDA recall events, counted on FDA's own event id (one event can list hundreds of products), by initiation
 * year and center, with a Class I trend and the firms with the most events in the 12 classified months.
 */
import { useQuery } from "@tanstack/react-query";
import {
  ChartCard,
  TrendColumns,
  TrendLines,
  periodTable,
  trendTakeaway,
} from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  BarList,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import { CLASSIFICATION_LAG_MONTHS, FDA_CENTER_LABEL } from "@/lib/safety/fdaRecallEvents";
import { fdaRecallEventsQuery } from "./sectionQueries";

const SOURCE = {
  label: "openFDA enforcement reports (drugs, devices, food)",
  url: "https://open.fda.gov/apis/drug/enforcement/",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const SERIES = [
  { key: "drug", label: "Drugs" },
  { key: "device", label: "Devices" },
  { key: "food", label: "Food" },
] as const;
const ID = "fda-recall-events";

export function FdaRecallEventsSection() {
  const q = useQuery(fdaRecallEventsQuery);
  const d = q.data;
  const years = d?.years ?? [];
  const first = years[0]?.year;
  const last = years.at(-1)?.year;
  const period = first && last ? `${first}–${last}` : undefined;
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
      : years.length < 2
        ? ({ kind: "empty", reason: "Not recorded for this period." } as const)
        : ({ kind: "ready" } as const);
  const totals = years.map((y) => ({ label: y.year, value: y.total, partial: y.partial }));
  const classI = years.map((y) => ({ label: y.year, value: y.classI, partial: y.partial }));
  const partialNote =
    [
      years[0]?.partial
        ? `${first} is partial: openFDA's enforcement reports start in June 2012.`
        : null,
      years.at(-1)?.partial
        ? `${last} runs to ${d?.latestInitiation ?? "the latest initiation date"}; FDA classifies recalls weeks to months after they start, so recent months fill in later.`
        : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const ratio = d && d.kpis.events > 0 ? d.kpis.rows / d.kpis.events : null;
  const windowText = d?.window ? `${d.window.from} to ${d.window.to}` : "12 classified months";
  const lagNote = `the latest ${CLASSIFICATION_LAG_MONTHS} months are left out while FDA classifies them`;
  const leaders = d?.firms ?? [];
  const context = d
    ? buildSectionContext({
        id: ID,
        title: "FDA recall events",
        period: period ?? null,
        source: SOURCE.label,
        figures: [
          {
            label: "Recall events initiated in 12 classified months",
            value: d.kpis.eventsLast12,
            period: windowText,
            note: lagNote,
          },
          {
            label: "Class I events in 12 classified months",
            value: d.kpis.classILast12,
            period: windowText,
            note: lagNote,
          },
          { label: "Ongoing events", value: d.kpis.ongoing },
          { label: "Product rows per event", value: ratio, decimals: 1 },
          ...years.slice(-6).map((y) => ({
            label: "Recall events",
            value: y.total,
            period: y.year,
            note: y.partial ? "partial year" : undefined,
          })),
          ...years.slice(-6).map((y) => ({
            label: "Class I events",
            value: y.classI,
            period: y.year,
            note: y.partial ? "partial year" : undefined,
          })),
          ...leaders.slice(0, 5).map((f) => ({
            label: `${f.firm} (${FDA_CENTER_LABEL[f.center]}) recall events`,
            value: f.events,
            period: windowText,
            note: lagNote,
          })),
        ],
        maxFigures: 24,
      })
    : null;
  const about = (
    <ul className="list-disc space-y-1 pl-4">
      <li>
        openFDA publishes one row per recalled product. FDA groups the products of one recall under
        an event id; this section counts events, not rows
        {ratio ? ` (about ${ratio.toFixed(1)} product rows per event overall)` : ""}.
      </li>
      <li>
        An event is dated by its earliest recall initiation date, is Class I when any of its
        products is Class I, and is ongoing when any product is still ongoing.
      </li>
      <li>Class I: a reasonable probability that the product will cause serious harm or death.</li>
      {d && d.kpis.rowsWithoutEvent > 0 ? (
        <li>{fmt(d.kpis.rowsWithoutEvent)} rows carry no event id and are left out.</li>
      ) : null}
      <li>
        Firms are listed under their exact normalised name in each center; names are never merged.
      </li>
    </ul>
  );
  return (
    <Section
      id={ID}
      title="FDA recall events"
      description="Recalls counted as FDA events, not product rows."
      actions={<AskAiButton sectionId={ID} context={context} size="icon" />}
    >
      <KpiGrid columns={4} label="FDA recall event figures">
        <KpiCard
          as="li"
          label="Events, 12 classified months"
          value={d ? fmt(d.kpis.eventsLast12) : null}
          meta={`${windowText}; ${lagNote}`}
          state={q.isPending ? "loading" : q.isError ? "error" : "ready"}
        />
        <KpiCard
          as="li"
          label="Class I events, 12 classified months"
          value={d ? fmt(d.kpis.classILast12) : null}
          meta={`Most serious class · ${windowText}`}
          state={q.isPending ? "loading" : q.isError ? "error" : "ready"}
        />
        <KpiCard
          as="li"
          label="Ongoing events"
          value={d ? fmt(d.kpis.ongoing) : null}
          meta="Any product still ongoing"
          state={q.isPending ? "loading" : q.isError ? "error" : "ready"}
        />
        <KpiCard
          as="li"
          label="Product rows per event"
          value={ratio ? ratio.toFixed(1) : null}
          meta={d ? `${fmt(d.kpis.rows)} rows, ${fmt(d.kpis.events)} events` : undefined}
          state={q.isPending ? "loading" : q.isError ? "error" : "ready"}
          source={{ source: { label: SOURCE.label, href: SOURCE.url } }}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={trendTakeaway("FDA recall events", totals, fmt) ?? "FDA recall events per year"}
          subtitle={`Recall events by initiation year and center${period ? ` · ${period}` : ""}`}
          status={status}
          sources={[SOURCE]}
          period={period}
          partial={partialNote}
          about={about}
          table={periodTable(years, "year", [...SERIES], fmt, {
            caption: "FDA recall events per year by center",
            xLabel: "Year",
            partialKey: "partial",
            total: true,
          })}
        >
          <TrendColumns
            rows={years}
            xKey="year"
            series={[...SERIES]}
            format={fmt}
            stacked
            partialKey="partial"
            ariaLabel="FDA recall events per year by center"
          />
        </ChartCard>
        <ChartCard
          variant="editorial"
          title={
            trendTakeaway("Class I recall events", classI, fmt) ?? "Class I recall events per year"
          }
          subtitle={`Class I events, all three centers${period ? ` · ${period}` : ""}`}
          status={status}
          sources={[SOURCE]}
          period={period}
          partial={partialNote}
          about={about}
          table={periodTable(years, "year", [{ key: "classI", label: "Class I events" }], fmt, {
            caption: "Class I FDA recall events per year",
            xLabel: "Year",
            partialKey: "partial",
          })}
        >
          <TrendLines
            rows={years}
            xKey="year"
            series={[{ key: "classI", label: "Class I events" }]}
            format={fmt}
            partialKey="partial"
            ariaLabel="Class I FDA recall events per year"
          />
        </ChartCard>
      </div>
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-heading font-semibold text-foreground">
            Firms with the most recall events
          </h3>
          <span className="text-meta text-muted-foreground">{windowText}</span>
        </div>
        {leaders.length ? (
          <BarList
            ariaLabel="Firms by FDA recall events in 12 classified months"
            items={leaders.slice(0, 8).map((f) => ({
              id: `${f.center}-${f.firmKey}`,
              label: f.firm,
              value: f.events,
              display: fmt(f.events),
              note: `${FDA_CENTER_LABEL[f.center]} · ${f.classI} Class I · ${fmt(f.rows)} product rows`,
            }))}
          />
        ) : (
          <p className="text-body text-muted-foreground">
            {q.isPending ? "Loading…" : "Not recorded for this period."}
          </p>
        )}
        <DataDrawer
          title={`Top ${leaders.length} firms by FDA recall events`}
          description={`The ${leaders.length} firms with the most events initiated ${windowText}, by exact firm name and center.`}
          triggerLabel={`Top ${leaders.length} firms`}
          rows={leaders}
          rowKey={(f) => `${f.center}-${f.firmKey}`}
          columns={[
            { key: "firm", label: "Firm", value: (f) => f.firm },
            { key: "center", label: "Center", value: (f) => FDA_CENTER_LABEL[f.center] },
            { key: "events", label: "Events", align: "right", value: (f) => f.events },
            { key: "classI", label: "Class I", align: "right", value: (f) => f.classI },
            { key: "rows", label: "Product rows", align: "right", value: (f) => f.rows },
          ]}
          source={{ source: { label: SOURCE.label, href: SOURCE.url }, period: windowText }}
          className="mt-3"
        />
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
