/**
 * /safety: the NHTSA defect-investigation pipeline. Open probes (current ones apart from legacy and incomplete rows
 * NHTSA still marks open), how often a closed probe's record cites a recall campaign present in the recall data, how
 * long that took, and the recalls the Office of Defects Investigation influenced.
 */
import { useQuery } from "@tanstack/react-query";
import {
  ChartCard,
  DumbbellRange,
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
import type { ProbeStatus } from "@/lib/safety/nhtsaPipeline";
import { nhtsaPipelineQuery } from "./sectionQueries";

const INV_SOURCE = {
  label: "NHTSA Office of Defects Investigation, investigations",
  url: "https://www.nhtsa.gov/recalls",
};
const REC_SOURCE = { label: "NHTSA recall campaigns", url: "https://www.nhtsa.gov/recalls" };
const fmt = (v: number) => v.toLocaleString("en-US");
const days = (v: number) => `${fmt(Math.round(v))} days`;
const ID = "nhtsa-pipeline";
const STATUS_LABEL: Record<ProbeStatus, string> = {
  current: "Current",
  legacy: "Legacy (opened before 2015)",
  incomplete: "Incomplete (no opening date or manufacturer)",
};
const SHORT_TYPE: Record<string, string> = {
  "Preliminary evaluation": "Preliminary evaluation (PE)",
  "Engineering analysis": "Engineering analysis (EA)",
  "Recall query": "Recall query (RQ)",
  "Defect petition": "Defect petition (DP)",
  "Audit query": "Audit query (AQ)",
};

export function NhtsaPipelineSection() {
  const q = useQuery(nhtsaPipelineQuery);
  const d = q.data;
  const state = q.isPending ? "loading" : q.isError ? "error" : "ready";
  const current = d?.open.filter((p) => p.status === "current") ?? [];
  const openOf = (t: string) => current.filter((p) => p.type === t).length;
  const pe = d?.conversion.find((c) => c.type === "Preliminary evaluation");
  const ea = d?.conversion.find((c) => c.type === "Engineering analysis");
  const linked = (d?.conversion ?? [])
    .filter((c) => c.type === "Preliminary evaluation" || c.type === "Engineering analysis")
    .reduce((a, c) => ({ closed: a.closed + c.closed, matched: a.matched + c.matched }), {
      closed: 0,
      matched: 0,
    });
  const linkedPct = linked.closed > 0 ? (linked.matched / linked.closed) * 100 : null;
  const years = d?.recallYears ?? [];
  const period = years.length ? `${years[0]!.year}–${years.at(-1)!.year}` : undefined;
  const odiPoints = years.map((y) => ({ label: y.year, value: y.odi, partial: y.partial }));
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
      : ({ kind: "ready" } as const);
  const dumbbell = (d?.conversion ?? [])
    .filter((c) => c.matched >= 5)
    .map((c) => ({
      id: c.type,
      label: SHORT_TYPE[c.type] ?? c.type,
      a: c.p25Days,
      b: c.p75Days,
      note:
        c.medianDays != null
          ? `median ${days(c.medianDays)} · ${fmt(c.matched)} recalls`
          : undefined,
    }));
  const context = d
    ? buildSectionContext({
        id: ID,
        title: "NHTSA defect investigations",
        period: d.asOf ? `as of ${d.asOf}` : null,
        source: `${INV_SOURCE.label}; ${REC_SOURCE.label}`,
        figures: [
          {
            label: "Open preliminary evaluations (current)",
            value: openOf("Preliminary evaluation"),
          },
          { label: "Open engineering analyses (current)", value: openOf("Engineering analysis") },
          { label: "Rows marked open but legacy (opened before 2015)", value: d.openCounts.legacy },
          {
            label: "Rows marked open with no opening date or manufacturer",
            value: d.openCounts.incomplete,
          },
          {
            label: "Closed PEs and EAs since 2010 linked to a recall in the data",
            value: linkedPct,
            unit: "%",
            decimals: 1,
          },
          {
            label: "Median days from opening to recall, PE",
            value: pe?.medianDays ?? null,
            unit: "days",
          },
          {
            label: "Median days from opening to recall, EA",
            value: ea?.medianDays ?? null,
            unit: "days",
          },
          {
            label: "ODI-influenced recall campaigns, latest 12 months",
            value: d.odiCampaignsLast12,
          },
          ...years.slice(-5).map((y) => ({
            label: "ODI-influenced recall campaigns",
            value: y.odi,
            period: y.year,
            note: y.partial ? "partial year" : undefined,
          })),
        ],
        maxFigures: 20,
      })
    : null;
  return (
    <Section
      id={ID}
      title="Vehicle defect investigations"
      description="Open NHTSA probes and how often they end in a recall."
      actions={<AskAiButton sectionId={ID} context={context} size="icon" />}
    >
      <KpiGrid columns={4} label="NHTSA investigation figures">
        <KpiCard
          as="li"
          label="Open preliminary evaluations"
          value={d ? fmt(openOf("Preliminary evaluation")) : null}
          meta="Current probes only"
          state={state}
        />
        <KpiCard
          as="li"
          label="Open engineering analyses"
          value={d ? fmt(openOf("Engineering analysis")) : null}
          meta="The stage that most often precedes a recall"
          state={state}
        />
        <KpiCard
          as="li"
          label="Closed PEs and EAs linked to a recall"
          value={linkedPct == null ? null : `${linkedPct.toFixed(1)}%`}
          meta={`${fmt(linked.matched)} of ${fmt(linked.closed)} opened since 2010`}
          state={state}
        />
        <KpiCard
          as="li"
          label="Median days to recall, EA"
          value={ea?.medianDays != null ? fmt(ea.medianDays) : null}
          meta={pe?.medianDays != null ? `PE: ${fmt(pe.medianDays)} days` : undefined}
          state={state}
          source={{
            source: { label: INV_SOURCE.label, href: INV_SOURCE.url },
            asOf: d?.asOf ?? undefined,
          }}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard
          variant="editorial"
          title="Time from opening a probe to the recall it cites"
          subtitle="Middle half of probes (25th to 75th percentile), days · probes opened since 2010"
          status={
            dumbbell.length
              ? status
              : q.isPending
                ? status
                : { kind: "empty", reason: "Not recorded." }
          }
          sources={[INV_SOURCE, REC_SOURCE]}
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                A probe is linked to a recall only when its record cites an exact campaign number
                (NNVNNN000) that exists in the recall data, which starts in 2010.
              </li>
              <li>Days run from the probe&apos;s opening date to the recall&apos;s report date.</li>
              <li>An open investigation is not a defect finding.</li>
            </ul>
          }
          table={{
            caption: "Closed probes opened since 2010, by type",
            columns: [
              { label: "Type" },
              { label: "Closed", align: "right" },
              { label: "Cite a campaign", align: "right" },
              { label: "Linked to a recall", align: "right" },
              { label: "Median days", align: "right" },
              { label: "25th pct", align: "right" },
              { label: "75th pct", align: "right" },
            ],
            rows: (d?.conversion ?? []).map((c) => ({
              key: c.type,
              cells: [
                c.type,
                c.closed,
                c.citesRecall,
                c.matched,
                c.medianDays ?? "Not recorded",
                c.p25Days ?? "Not recorded",
                c.p75Days ?? "Not recorded",
              ],
            })),
          }}
        >
          <DumbbellRange
            rows={dumbbell}
            aLabel="25th percentile"
            bLabel="75th percentile"
            format={days}
            labelWidth={200}
            ariaLabel="Days from probe opening to recall by probe type"
          />
        </ChartCard>
        <ChartCard
          variant="editorial"
          title={
            trendTakeaway("Recalls influenced by NHTSA's investigators", odiPoints, fmt) ??
            "Recalls influenced by NHTSA's investigators"
          }
          subtitle={`Recall campaigns per year${period ? ` · ${period}` : ""}`}
          status={
            years.length >= 2
              ? status
              : q.isPending
                ? status
                : { kind: "empty", reason: "Not recorded." }
          }
          sources={[REC_SOURCE]}
          period={period}
          partial={years.at(-1)?.partial ? `${years.at(-1)!.year} is not complete.` : undefined}
          about={
            <p>
              &quot;Influenced by ODI&quot; is NHTSA&apos;s own field on the campaign. Do-not-drive
              and park-outside are the owner warnings NHTSA records on the campaign.
            </p>
          }
          table={periodTable(
            years,
            "year",
            [
              { key: "odi", label: "Influenced by ODI" },
              { key: "doNotDrive", label: "Do not drive or park outside" },
              { key: "campaigns", label: "All campaigns" },
            ],
            fmt,
            { caption: "NHTSA recall campaigns per year", xLabel: "Year", partialKey: "partial" },
          )}
        >
          <TrendLines
            rows={years}
            xKey="year"
            partialKey="partial"
            format={fmt}
            series={[
              { key: "odi", label: "Influenced by ODI" },
              { key: "doNotDrive", label: "Do not drive or park outside" },
            ]}
            ariaLabel="NHTSA recall campaigns influenced by ODI and with owner warnings, per year"
          />
        </ChartCard>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-heading font-semibold text-foreground">
            Share of closed probes linked to a recall
          </h3>
          <BarList
            ariaLabel="Share of closed probes linked to a recall, by type"
            items={(d?.conversion ?? []).map((c) => ({
              id: c.type,
              label: SHORT_TYPE[c.type] ?? c.type,
              value: c.closed ? (c.matched / c.closed) * 100 : null,
              display: c.closed ? `${((c.matched / c.closed) * 100).toFixed(1)}%` : "Not recorded",
              note: `${fmt(c.matched)} of ${fmt(c.closed)}`,
            }))}
          />
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-heading font-semibold text-foreground">Newest open probes</h3>
          <ol className="m-0 list-none space-y-2 p-0">
            {current.slice(0, 6).map((p) => (
              <li key={p.id} className="text-body">
                <a
                  href={`https://www.nhtsa.gov/?nhtsaId=${encodeURIComponent(p.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {p.id}
                </a>{" "}
                <span className="text-foreground">{p.subject ?? "Not recorded"}</span>
                <span className="block text-meta text-muted-foreground">
                  {p.type} · {p.manufacturer ?? "Not recorded"} · opened{" "}
                  {p.opened ?? "Not recorded"}
                </span>
              </li>
            ))}
            {!current.length ? (
              <li className="text-body text-muted-foreground">
                {q.isPending ? "Loading…" : "Not recorded."}
              </li>
            ) : null}
          </ol>
          <DataDrawer
            title="Investigations NHTSA marks open"
            description="Current probes first. Legacy and incomplete rows are listed as NHTSA publishes them but are not counted as current probes."
            triggerLabel={`See all ${d?.open.length ?? 0}`}
            rows={d?.open ?? []}
            rowKey={(p) => p.id}
            searchable
            columns={[
              { key: "id", label: "Action", value: (p) => p.id },
              { key: "status", label: "Status", value: (p) => STATUS_LABEL[p.status] },
              { key: "type", label: "Type", value: (p) => p.type },
              { key: "opened", label: "Opened", value: (p) => p.opened },
              { key: "age", label: "Days open", align: "right", value: (p) => p.ageDays },
              { key: "mfr", label: "Manufacturer", value: (p) => p.manufacturer },
              { key: "subject", label: "Subject", value: (p) => p.subject },
            ]}
            source={{
              source: { label: INV_SOURCE.label, href: INV_SOURCE.url },
              asOf: d?.asOf ?? undefined,
            }}
            className="mt-3"
          />
          {d ? (
            <p className="mt-2 text-meta text-muted-foreground">
              Also marked open: {fmt(d.openCounts.legacy)} legacy rows opened before 2015 and{" "}
              {fmt(d.openCounts.incomplete)} rows with no opening date or manufacturer.
            </p>
          ) : null}
        </div>
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
