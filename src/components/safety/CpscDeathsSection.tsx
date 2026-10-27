/**
 * /safety: CPSC recalls whose injury statement explicitly says someone died, drowned, suffocated, strangled or was
 * killed, including those CPSC's own death tag in the dataset marks "No".
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
import { cpscDeathsQuery } from "./sectionQueries";

const SOURCE = {
  label: "CPSC Recalls API (agency_safety_cpsc_recalls_api)",
  url: "https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const ID = "cpsc-deaths";

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
    tagged: y.recalls - y.untagged,
    untagged: y.untagged,
    partial: y.partial,
  }));
  const context = d
    ? buildSectionContext({
        id: ID,
        title: "CPSC recalls whose injury text reports a death",
        period: d.dataThrough ? `through ${d.dataThrough}` : null,
        source: SOURCE.label,
        figures: [
          { label: "Recalls whose injury statement says someone died", value: d.total },
          { label: "Of these, tagged with no death mention in the dataset", value: d.untagged },
          { label: "CPSC recalls in the dataset", value: d.datasetTotal },
          { label: "Latest such recall", value: d.latest ?? null },
          ...years.slice(-6).map((y) => ({
            label: "Recalls reporting a death",
            value: y.recalls,
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
      description="Recalls whose injury statement says someone died."
      actions={<AskAiButton sectionId={ID} context={context} size="icon" />}
    >
      <KpiGrid columns={4} label="CPSC death-mention figures">
        <KpiCard
          as="li"
          label="Recalls reporting a death"
          value={d ? fmt(d.total) : null}
          meta={d?.datasetTotal ? `of ${fmt(d.datasetTotal)} CPSC recalls` : undefined}
          state={state}
        />
        <KpiCard
          as="li"
          label="Missed by the death tag"
          value={d ? fmt(d.untagged) : null}
          meta="Tagged “No” or blank in the dataset"
          state={state}
        />
        <KpiCard as="li" label="Latest such recall" value={d?.latest ?? null} state={state} />
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
        title="CPSC recalls whose injury statement reports a death, by year"
        subtitle={`Recalls per year · split by the dataset's own death tag${period ? ` · ${period}` : ""}`}
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
              A recall counts when its injury statement says someone died, drowned, suffocated, was
              strangled or was killed. Negated phrases (&quot;no one has died&quot;) and the
              standard risk-of-death hazard wording do not count.
            </li>
            <li>A text mention, not a verified count of deaths caused by the product.</li>
            <li>
              &quot;Missed by the death tag&quot;: the dataset&apos;s death_mention cell reads No or
              is blank although the text reports a death.
            </li>
          </ul>
        }
        table={periodTable(
          chartRows,
          "year",
          [
            { key: "tagged", label: "Tagged as a death mention" },
            { key: "untagged", label: "Missed by the tag" },
          ],
          fmt,
          {
            caption: "CPSC recalls reporting a death per year",
            xLabel: "Year",
            partialKey: "partial",
            total: true,
          },
        )}
      >
        <TrendColumns
          rows={chartRows}
          xKey="year"
          stacked
          partialKey="partial"
          format={fmt}
          series={[
            { key: "tagged", label: "Tagged as a death mention" },
            { key: "untagged", label: "Missed by the tag" },
          ]}
          ariaLabel="CPSC recalls reporting a death per year"
        />
      </ChartCard>
      <DataDrawer
        title="CPSC recalls reporting a death"
        description="Newest first. The excerpt is the sentence of the injury statement that reports the death."
        triggerLabel={`See all ${d?.total ?? 0}`}
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
          { key: "word", label: "Says", value: (r) => r.word },
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
