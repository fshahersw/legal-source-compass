/**
 * /safety: vehicle complaint surge radar. NHTSA ODI complaints in the latest 365 days against the 365 days before, by
 * manufacturer and by manufacturer × top-level component, from safety_nhtsa_complaint_windows_v1. Until that RPC is
 * applied the section renders nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard, DumbbellRange } from "@/components/charts/recharts";
import { DivergingDots } from "@/components/charts/d3/charts";
import { medianOf } from "@/components/charts/takeaway";
import {
  AiSummary,
  AskAiButton,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import { openProbesByManufacturer } from "@/lib/safety/nhtsaPipeline";
import { StateNote } from "@/components/enforcement/parts";
import {
  hasComplaintWindows,
  pctChange,
  radarRows,
  shortMaker,
  titleCase,
} from "@/lib/safety/safetyWindows";
import { complaintWindowsQuery, nhtsaPipelineQuery } from "./sectionQueries";

const SOURCE = {
  label: "NHTSA Office of Defects Investigation, consumer complaints",
  url: "https://www.nhtsa.gov/nhtsa-datasets-and-apis",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`;
const ID = "complaint-radar";
const MIN = 100;

export function ComplaintRadarSection() {
  const q = useQuery(complaintWindowsQuery);
  const pipeline = useQuery(nhtsaPipelineQuery);
  const w = q.data;
  if (q.isError)
    return (
      <Section id={ID} title="Vehicle complaint surge radar">
        <StateNote
          tone="error"
          action={
            <button type="button" className="underline" onClick={() => void q.refetch()}>
              Retry
            </button>
          }
        >
          The complaint windows could not be read just now.
        </StateNote>
      </Section>
    );
  // Shows nothing until the RPC is applied (null) or while it loads.
  if (!hasComplaintWindows(w)) return null;
  const t = w.totals;
  const rows = radarRows(w, MIN, 15);
  const withChange = rows.filter((r) => r.change !== null);
  const baseline = medianOf(withChange.map((r) => r.change)) ?? 0;
  const probes = pipeline.data ? openProbesByManufacturer(pipeline.data.open) : null;
  const period = `${w.current_from} to ${w.current_to} vs ${w.prior_from} to ${w.prior_to}`;
  const change = pctChange(t.current, t.prior);
  const makers = w.manufacturers.slice(0, 12).map((m) => ({
    id: m.manufacturer,
    label: shortMaker(m.manufacturer),
    a: m.prior,
    b: m.current,
    note: probes?.get(m.manufacturer) ? `${probes.get(m.manufacturer)} open probes` : undefined,
  }));
  const context = buildSectionContext({
    id: ID,
    title: "Vehicle complaint surge radar",
    period,
    source: SOURCE.label,
    figures: [
      { label: "Complaints, latest 365 days", value: t.current },
      {
        label: "Complaints, prior 365 days",
        value: t.prior,
        note: w.prior_partial ? "partial window" : undefined,
      },
      { label: "Change", value: w.prior_partial ? null : change, unit: "%", decimals: 1 },
      { label: "Injuries reported, latest 365 days", value: t.injured },
      { label: "Deaths reported, latest 365 days", value: t.deaths },
      { label: "Complaints reporting a fire, latest 365 days", value: t.fires },
      ...withChange.slice(0, 8).map((r) => ({
        label: `${r.label} complaints, change`,
        value: r.change,
        unit: "%",
        note: `${fmt(r.prior)} to ${fmt(r.current)}`,
      })),
    ],
    maxFigures: 18,
  });
  const about = (
    <ul className="list-disc space-y-1 pl-4">
      <li>Complaints are unverified consumer reports to NHTSA, received from 2020-01-01.</li>
      <li>Both windows are 365 days, so they compare directly.</li>
      <li>
        One complaint can name several components. Each pair counts the complaints naming that
        component, so pairs must not be added up.
      </li>
      <li>
        The pairs shown are the 60 with the largest increase in complaints, then kept when they have
        at least {MIN} in the latest window; a pair with a larger percent rise but a smaller
        increase may not be among them. The dot line is the median change of the pairs shown.
      </li>
      <li>Manufacturers are shown as NHTSA records them; open probes match on the exact name.</li>
    </ul>
  );
  return (
    <Section
      id={ID}
      title="Vehicle complaint surge radar"
      description="Where consumer complaints are rising fastest."
      actions={<AskAiButton sectionId={ID} context={context} size="icon" />}
    >
      <KpiGrid columns={4} label="Vehicle complaint figures">
        <KpiCard
          as="li"
          label="Complaints, latest 365 days"
          value={fmt(t.current)}
          meta={`${w.current_from} to ${w.current_to}`}
          delta={
            change != null && !w.prior_partial
              ? { value: change, text: `${pct(change)} vs prior 365 days` }
              : null
          }
        />
        <KpiCard
          as="li"
          label="Injuries reported"
          value={t.injured == null ? null : fmt(t.injured)}
          meta="Latest 365 days"
        />
        <KpiCard
          as="li"
          label="Deaths reported"
          value={t.deaths == null ? null : fmt(t.deaths)}
          meta="Latest 365 days"
        />
        <KpiCard
          as="li"
          label="Fires reported"
          value={fmt(t.fires)}
          meta={`${fmt(t.crashes)} crashes`}
          source={{ source: { label: SOURCE.label, href: SOURCE.url }, asOf: w.as_of }}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={
            withChange[0]
              ? `${withChange[0].label} complaints rose ${pct(withChange[0].change!)}, the fastest rise among the pairs shown`
              : "Complaint change by manufacturer and component"
          }
          subtitle="Change in complaints, latest 365 days vs the 365 before · manufacturer × component"
          status={
            withChange.length
              ? { kind: "ready" }
              : { kind: "empty", reason: "No pair reached the minimum." }
          }
          sources={[SOURCE]}
          period={period}
          about={about}
          table={{
            caption: "Complaints by manufacturer and component",
            columns: [
              { label: "Manufacturer · component" },
              { label: "Prior 365 days", align: "right" },
              { label: "Latest 365 days", align: "right" },
              { label: "Change", align: "right" },
              { label: "Injuries", align: "right" },
              { label: "Deaths", align: "right" },
              { label: "Fires", align: "right" },
            ],
            rows: rows.map((r) => ({
              key: r.id,
              cells: [
                r.label,
                r.prior,
                r.current,
                r.change == null ? "Not recorded" : pct(r.change),
                r.injured ?? "Not recorded",
                r.deaths ?? "Not recorded",
                r.fires,
              ],
            })),
          }}
        >
          <DivergingDots
            items={withChange.map((r) => ({ label: r.label, value: r.change }))}
            baseline={baseline}
            baselineLabel="Median pair"
            format={pct}
            labelWidth={220}
          />
        </ChartCard>
        <ChartCard
          variant="editorial"
          title="Manufacturers with the most complaints"
          subtitle="Complaints, prior 365 days → latest 365 days"
          status={makers.length ? { kind: "ready" } : { kind: "empty", reason: "Not recorded." }}
          sources={[SOURCE]}
          period={period}
          about={about}
          table={{
            caption: "Complaints by manufacturer",
            columns: [
              { label: "Manufacturer" },
              { label: "Prior 365 days", align: "right" },
              { label: "Latest 365 days", align: "right" },
              { label: "Injuries", align: "right" },
              { label: "Deaths", align: "right" },
              { label: "Open probes", align: "right" },
            ],
            rows: w.manufacturers.map((m) => ({
              key: m.manufacturer,
              cells: [
                m.manufacturer,
                m.prior,
                m.current,
                m.injured ?? "Not recorded",
                m.deaths ?? "Not recorded",
                probes ? (probes.get(m.manufacturer) ?? 0) : "Not recorded",
              ],
            })),
          }}
        >
          <DumbbellRange
            rows={makers}
            aLabel="Prior 365 days"
            bLabel="Latest 365 days"
            format={fmt}
            gapLabel="Change"
            labelWidth={160}
            ariaLabel="Complaints by manufacturer, prior and latest 365 days"
          />
        </ChartCard>
      </div>
      <DataDrawer
        title="Complaint pairs"
        description={`The manufacturer × component pairs with at least 50 complaints in the latest window and the largest increases, ${period}.`}
        triggerLabel={`See all ${w.pairs.length}`}
        rows={w.pairs}
        rowKey={(p) => `${p.manufacturer}|${p.component}`}
        searchable
        columns={[
          { key: "m", label: "Manufacturer", value: (p) => p.manufacturer },
          { key: "c", label: "Component", value: (p) => titleCase(p.component) },
          { key: "prior", label: "Prior 365 days", align: "right", value: (p) => p.prior },
          { key: "current", label: "Latest 365 days", align: "right", value: (p) => p.current },
          { key: "inj", label: "Injuries", align: "right", value: (p) => p.injured },
          { key: "dth", label: "Deaths", align: "right", value: (p) => p.deaths },
          { key: "fire", label: "Fires", align: "right", value: (p) => p.fires },
          { key: "crash", label: "Crashes", align: "right", value: (p) => p.crashes },
        ]}
        source={{ source: { label: SOURCE.label, href: SOURCE.url }, period }}
        className="mt-3"
      />
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
