/**
 * /safety: CPSC recalls reporting a death. The dataset's own death tag (Product-related) plus recalls tagged "No" whose
 * injury statement or title says a person died. "Background / other product" rows (a death with another product) are
 * shown apart and never counted as recalls reporting a death.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard, TrendColumns, periodTable } from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import { KIND_LABEL } from "@/lib/safety/cpscDeaths";
import { cpscDeathsQuery } from "./sectionQueries";

const SOURCE = {
  label: "CPSC Recalls API (agency_safety_cpsc_recalls_api)",
  url: "https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const ID = "cpsc-deaths";
const SERIES = [
  { key: "product", label: KIND_LABEL.product },
  { key: "missed", label: KIND_LABEL.missed },
];

export function CpscDeathsSection() {
  const q = useQuery(cpscDeathsQuery);
  const d = q.data;
  const state = q.isPending ? "loading" : q.isError ? "error" : "ready";
  const years = (d?.years ?? []).filter((y) => Number(y.year) >= 2010);
  const period = years.length ? `${years[0]!.year}–${years.at(-1)!.year}` : undefined;
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
      : years.length < 2
        ? ({ kind: "empty", reason: "Not recorded for this period." } as const)
        : ({ kind: "ready" } as const);
  const chartRows = years.map((y) => ({
    year: y.year,
    product: y.product,
    missed: y.missed,
    partial: y.partial,
  }));
  const context = d
    ? buildSectionContext({
        id: ID,
        title: "CPSC recalls reporting a death",
        period: d.dataThrough ? `through ${d.dataThrough}` : null,
        source: SOURCE.label,
        figures: [
          { label: "Recalls reporting a death", value: d.total },
          { label: "Of these, tagged product-related in the dataset", value: d.tagged },
          {
            label: "Of these, tagged No or blank although the text reports a death",
            value: d.untagged,
          },
          {
            label: "Recalls tagged as a death with another product (not counted)",
            value: d.background,
          },
          { label: "CPSC recalls in the dataset", value: d.datasetTotal },
          { label: "Latest recall reporting a death", value: d.latest ?? null },
          ...years.slice(-6).map((y) => ({
            label: "Recalls reporting a death",
            value: y.product + y.missed,
            period: y.year,
            note: y.partial ? "partial year" : undefined,
          })),
        ],
      })
    : null;
  return (
    <Section
      id={ID}
      title="Consumer product recalls reporting deaths"
      description="Recalls the dataset tags with a product-related death, plus those its tag missed."
      actions={<AskAiButton sectionId={ID} context={context} size="icon" />}
    >
      <KpiGrid columns={5} label="CPSC death-mention figures">
        <KpiCard
          as="li"
          label="Recalls reporting a death"
          value={d ? fmt(d.total) : null}
          meta={
            d
              ? `${fmt(d.tagged)} tagged product-related${d.datasetTotal ? ` · of ${fmt(d.datasetTotal)} CPSC recalls` : ""}`
              : undefined
          }
          state={state}
        />
        <KpiCard
          as="li"
          label="Missed by the death tag"
          value={d ? fmt(d.untagged) : null}
          meta="Tagged “No” or blank; the text reports a death"
          state={state}
        />
        <KpiCard
          as="li"
          label="Death with another product"
          value={d ? fmt(d.background) : null}
          meta="Tagged background; not counted"
          state={state}
        />
        <KpiCard
          as="li"
          label="Latest recall reporting a death"
          value={d?.latest ?? null}
          state={state}
        />
        <KpiCard
          as="li"
          label="Data through"
          value={d?.dataThrough ?? null}
          state={state}
          source={{ source: { label: SOURCE.label, href: SOURCE.url } }}
        />
      </KpiGrid>
      <ChartCard
        variant="editorial"
        className="mt-4"
        title="CPSC recalls reporting a death, by year"
        subtitle={`Recalls per year · tagged product-related or missed by the tag${period ? ` · ${period}` : ""}`}
        status={status}
        sources={[SOURCE]}
        period={period}
        partial={
          years.at(-1)?.partial
            ? `${years.at(-1)!.year} runs to ${d?.dataThrough ?? "the latest recall"}.`
            : undefined
        }
        about={
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Tagged product-related: the dataset&apos;s death_mention cell starts with
              &quot;Product-related&quot;.
            </li>
            <li>
              Missed by the tag: the cell reads No or is blank, but the injury statement or title
              says a person died, drowned, suffocated, was strangled or killed, or reports deaths.
              Negated (&quot;no injuries or deaths have been reported&quot;), hypothetical (&quot;in
              danger of being strangled&quot;, &quot;nearly suffocated&quot;) and animal deaths, and
              the standard risk-of-death hazard wording, do not count.
            </li>
            <li>
              Rows tagged &quot;Background / other product&quot; (a death with another product) are
              left out of the count and listed apart in the data.
            </li>
            <li>A text mention, not a verified count of deaths caused by the product.</li>
          </ul>
        }
        table={periodTable(chartRows, "year", SERIES, fmt, {
          caption: "CPSC recalls reporting a death per year",
          xLabel: "Year",
          partialKey: "partial",
          total: true,
        })}
      >
        <TrendColumns
          rows={chartRows}
          xKey="year"
          stacked
          partialKey="partial"
          format={fmt}
          series={SERIES}
          ariaLabel="CPSC recalls reporting a death per year"
        />
      </ChartCard>
      <DataDrawer
        title="CPSC recalls reporting a death, and background deaths"
        description="Newest first. Group says how each recall was counted; background rows are not counted. The excerpt is the sentence of the injury statement that mentions the death."
        triggerLabel={`See all ${d?.recalls.length ?? 0}`}
        rows={d?.recalls ?? []}
        rowKey={(r) => r.id}
        searchable
        columns={[
          { key: "date", label: "Date", value: (r) => r.date },
          {
            key: "no",
            label: "Recall",
            value: (r) => r.recallNumber,
            render: (r) =>
              r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {r.recallNumber}
                </a>
              ) : (
                r.recallNumber
              ),
          },
          { key: "title", label: "Title", value: (r) => r.title },
          { key: "group", label: "Group", value: (r) => KIND_LABEL[r.kind] },
          { key: "word", label: "Says", value: (r) => r.word ?? "Not recorded" },
          { key: "tag", label: "Dataset tag", value: (r) => r.tag },
          { key: "excerpt", label: "Injury statement", value: (r) => r.excerpt },
        ]}
        source={{
          source: { label: SOURCE.label, href: SOURCE.url },
          asOf: d?.dataThrough ?? undefined,
        }}
        className="mt-3"
      />
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
