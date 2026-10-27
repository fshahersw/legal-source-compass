/**
 * CFR section page: the products and recalls this rule governs, by exact identifier (device classification regulation
 * number, or FMVSS number for 49 CFR 571.N). Renders nothing for sections no crosswalk applies to or with no match.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { RankBars, TrendColumns, periodTable, trendTakeaway } from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import {
  crosswalkFor,
  deviceSummary,
  fmvssCoverageNote,
  recallYears,
  type SectionCrosswalk,
} from "@/lib/law/sectionCrosswalk";
import { getSectionCrosswalk } from "@/lib/law/sectionCrosswalk.functions";

const fmt = (v: number) => v.toLocaleString("en-US");
const DEVICE_SOURCE = {
  label: "FDA device classification (openFDA bulk download)",
  url: "https://open.fda.gov/apis/device/classification/",
};
const NHTSA_SOURCE = {
  label: "NHTSA recalls (NHTSA datasets and APIs)",
  url: "https://www.nhtsa.gov/nhtsa-datasets-and-apis",
};
const ID = "section-products";

export function SectionProductsPanel({ title, section }: { title: string; section: string }) {
  const applies = crosswalkFor(title, section) !== null;
  const q = useQuery({
    queryKey: ["law", "section-crosswalk", title, section],
    queryFn: () => getSectionCrosswalk({ data: { title, section } }),
    staleTime: 30 * 60 * 1000,
    enabled: applies,
  });
  if (!applies || q.isPending || !q.data) {
    if (applies && q.isError)
      return (
        <p role="alert" className="text-meta text-muted-foreground">
          Products and recalls under this rule could not be loaded.{" "}
          <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      );
    return null;
  }
  return q.data.kind === "device" ? (
    <DevicePanel x={q.data} citation={`${title} CFR ${section}`} />
  ) : (
    <VehiclePanel x={q.data} citation={`${title} CFR ${section}`} />
  );
}

function DevicePanel({
  x,
  citation,
}: {
  x: Extract<SectionCrosswalk, { kind: "device" }>;
  citation: string;
}) {
  if (!x.devices.length) return null;
  const s = deviceSummary(x.devices);
  const source = DEVICE_SOURCE;
  const context = buildSectionContext({
    id: ID,
    title: `Device types classified under ${citation}`,
    period: x.exportDate ? `FDA export of ${x.exportDate}` : null,
    source: source.label,
    figures: [
      { label: "Device types (product codes)", value: s.types },
      { label: "Class III device types", value: s.classIII },
      { label: "Implant device types", value: s.implants },
      { label: "Life-sustaining or life-supporting device types", value: s.lifeSustaining },
    ],
  });
  return (
    <Section
      id={ID}
      title="Devices classified under this regulation"
      description="FDA device types whose classification regulation is this section."
      actions={
        <AskAiButton
          sectionId={ID}
          title="Devices under this regulation"
          context={context}
          size="icon"
        />
      }
    >
      <KpiGrid columns={4} label="Devices under this regulation">
        <KpiCard
          as="li"
          size="sm"
          label="Device types"
          value={fmt(s.types)}
          meta="Product codes"
          source={{ source, asOf: x.exportDate ?? undefined }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="Class III"
          value={fmt(s.classIII)}
          meta="Highest-risk class"
          source={{ source }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="Implants"
          value={fmt(s.implants)}
          meta="FDA implant flag"
          source={{ source }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="Life-sustaining"
          value={fmt(s.lifeSustaining)}
          meta="FDA flag"
          source={{ source }}
        />
      </KpiGrid>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-meta text-muted-foreground">
          FDA&apos;s classification as published; it says nothing about whether a given product
          complied.
        </p>
        <DataDrawer
          title={`Device types classified under ${citation}`}
          triggerLabel={`View data (${fmt(s.types)})`}
          filename={`devices-${citation.replace(/\W+/g, "-")}`}
          rows={x.devices}
          rowKey={(d) => d.productCode}
          source={{ source, asOf: x.exportDate ?? undefined }}
          columns={[
            { key: "code", label: "Product code", value: (d) => d.productCode },
            { key: "name", label: "Device", value: (d) => d.name },
            { key: "class", label: "Class", value: (d) => d.deviceClass },
            {
              key: "implant",
              label: "Implant",
              value: (d) => (d.implant == null ? null : d.implant ? "Yes" : "No"),
            },
            {
              key: "life",
              label: "Life-sustaining",
              value: (d) => (d.lifeSustaining == null ? null : d.lifeSustaining ? "Yes" : "No"),
            },
            { key: "spec", label: "Specialty", value: (d) => d.specialty },
          ]}
        />
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}

function VehiclePanel({
  x,
  citation,
}: {
  x: Extract<SectionCrosswalk, { kind: "vehicle" }>;
  citation: string;
}) {
  if (!x.recalls.length) return null;
  const years = recallYears(x.recalls, x.today);
  const unitsKnown = x.recalls
    .filter((r) => r.units != null)
    .reduce((a, r) => a + (r.units ?? 0), 0);
  const unitsMissing = x.recalls.filter((r) => r.units == null).length;
  const makers = new Map<string, number>();
  for (const r of x.recalls)
    if (r.manufacturer) makers.set(r.manufacturer, (makers.get(r.manufacturer) ?? 0) + 1);
  const topMakers = [...makers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const latest = [...x.recalls]
    .filter((r) => r.date)
    .sort((a, b) => b.date!.localeCompare(a.date!))[0];
  const period = years.length ? `${years[0]!.year}–${years.at(-1)!.year}` : undefined;
  const coverage = fmvssCoverageNote(x.coverage);
  const lowerBound = `Only recalls whose record names the standard are counted${coverage ? `; ${coverage}` : "."}`;
  const context = buildSectionContext({
    id: ID,
    title: `Recalls citing FMVSS ${x.key} (${citation})`,
    period: period ?? null,
    source: NHTSA_SOURCE.label,
    figures: [
      {
        label: "Recall campaigns citing the standard",
        value: x.recalls.length,
        note: `Lower bound. ${lowerBound}`,
      },
      {
        label: "Vehicles or items potentially affected",
        value: unitsKnown,
        note: unitsMissing ? `${unitsMissing} recalls without a count` : undefined,
      },
      ...years
        .filter((y) => !y.partial)
        .slice(-5)
        .map((y) => ({ label: `Recalls in ${y.year}`, value: y.recalls })),
      ...topMakers.slice(0, 3).map(([m, n]) => ({ label: `Recalls by ${m}`, value: n })),
    ],
  });
  return (
    <Section
      id={ID}
      title={`Recalls citing FMVSS No. ${x.key}`}
      description="NHTSA recall campaigns that name this safety standard."
      actions={
        <AskAiButton
          sectionId={ID}
          title={`Recalls citing FMVSS ${x.key}`}
          context={context}
          size="icon"
        />
      }
    >
      <KpiGrid columns={4} label="Recalls citing this standard">
        <KpiCard
          as="li"
          size="sm"
          label="Recall campaigns"
          value={fmt(x.recalls.length)}
          meta={`At least · only recalls naming the standard${period ? ` · ${period}` : ""}`}
          source={{ source: NHTSA_SOURCE, asOf: x.dataAsOf ?? undefined }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="Units potentially affected"
          value={fmt(unitsKnown)}
          meta={
            unitsMissing
              ? `${fmt(unitsMissing)} recalls give no count`
              : "As reported by manufacturers"
          }
          source={{ source: NHTSA_SOURCE }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="Manufacturers"
          value={fmt(makers.size)}
          meta={topMakers[0] ? `Most: ${topMakers[0][0]}` : undefined}
          source={{ source: NHTSA_SOURCE }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="Latest recall"
          value={latest?.date ?? null}
          meta={latest?.campaign}
          source={{ source: NHTSA_SOURCE }}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={
            trendTakeaway(
              `Recalls citing FMVSS ${x.key}`,
              years.map((y) => ({ label: y.year, value: y.recalls, partial: y.partial })),
              fmt,
            ) ?? "Recalls per year"
          }
          subtitle={`Recall campaigns per report year · ${years.at(-1)?.year ?? ""} partial`}
          sources={[NHTSA_SOURCE]}
          period={period}
          asOf={x.dataAsOf ?? undefined}
          about={
            <p>
              Recalls whose record names FMVSS No. {x.key}, matched on that number only, so the
              count is a lower bound. {lowerBound} Units are as the manufacturer reported them.
            </p>
          }
          table={periodTable(
            years,
            "year",
            [
              { key: "recalls", label: "Recalls" },
              { key: "units", label: "Units potentially affected" },
            ],
            fmt,
            {
              caption: `Recalls citing FMVSS ${x.key} per year`,
              xLabel: "Year",
              partialKey: "partial",
            },
          )}
          actions={
            <DataDrawer
              title={`Recalls citing FMVSS No. ${x.key}`}
              triggerLabel={`View data (${fmt(x.recalls.length)})`}
              filename={`recalls-fmvss-${x.key}`}
              rows={[...x.recalls].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))}
              rowKey={(r) => r.campaign}
              searchable
              source={{ source: NHTSA_SOURCE, asOf: x.dataAsOf ?? undefined }}
              columns={[
                { key: "date", label: "Report date", value: (r) => r.date },
                {
                  key: "campaign",
                  label: "Campaign",
                  value: (r) => r.campaign,
                  render: (r) =>
                    r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {r.campaign}
                      </a>
                    ) : (
                      r.campaign
                    ),
                },
                { key: "title", label: "Recall", value: (r) => r.title },
                { key: "units", label: "Units", align: "right", value: (r) => r.units },
              ]}
            />
          }
        >
          <TrendColumns
            rows={years}
            xKey="year"
            series={[{ key: "recalls", label: "Recalls" }]}
            format={fmt}
            partialKey="partial"
            height={200}
            ariaLabel={`Recalls citing FMVSS ${x.key} per year`}
          />
        </ChartCard>
        <ChartCard
          variant="editorial"
          title={
            topMakers[0]
              ? `${topMakers[0][0]} filed the most of these recalls (${fmt(topMakers[0][1])})`
              : "Recalls by manufacturer"
          }
          subtitle="Recall campaigns citing the standard, top manufacturers"
          sources={[NHTSA_SOURCE]}
          period={period}
          table={{
            caption: `Recalls citing FMVSS ${x.key} by manufacturer`,
            columns: [{ label: "Manufacturer" }, { label: "Recalls" }],
            rows: [...makers.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([m, n]) => ({ key: m, cells: [m, n] })),
          }}
        >
          <RankBars
            items={topMakers.map(([m, n]) => ({ id: m, label: m, value: n }))}
            format={fmt}
            ariaLabel={`Recalls citing FMVSS ${x.key} by manufacturer`}
          />
        </ChartCard>
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
