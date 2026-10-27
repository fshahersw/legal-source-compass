/**
 * /law/cfr lead section: which mass-tort regulations changed since 2017 (drug and device rules at FDA, the motor
 * vehicle standards and defect reporting at NHTSA, CPSC's hazardous substances part) and which Federal Register rule
 * changed them. Model and counting rules: src/lib/law/cfrRadar.ts.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { Heatmap } from "@/components/charts/Heatmap";
import { metricFormatter } from "@/components/charts/format";
import { TrendColumns, periodTable, trendTakeaway } from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import { partCitation, type SectionChange } from "@/lib/law/cfrRadar";
import { cfrRadarQuery } from "./lawQueries";

const SOURCE = {
  label: "eCFR point-in-time versions (Office of the Federal Register)",
  url: "https://www.ecfr.gov/reader-aids/using-ecfr/ecfr-changes-through-time",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const ID = "cfr-radar";
const TITLE = "Changes to mass-tort regulations since 2017";

export function CfrChangeRadar() {
  const q = useQuery(cfrRadarQuery);
  const r = q.data;
  const state = q.isPending ? "loading" : q.isError ? "error" : "ready";
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({
          kind: "error",
          message: "This chart could not be loaded.",
          onRetry: () => void q.refetch(),
        } as const)
      : ({ kind: "ready" } as const);
  const totals = r
    ? r.years.map((y) => ({
        year: y,
        changes: r.parts.reduce((a, p) => a + (p.byYear[y] ?? 0), 0),
        partial: y === r.partialYear,
      }))
    : [];
  const allChanges = r ? r.parts.reduce((a, p) => a + p.changes, 0) : 0;
  const partsRecent = r
    ? r.parts.filter((p) => p.latest !== null && p.latest > r.last12.since)
    : [];
  const latest = r?.changes[0];
  const latestPart = latest && r ? r.parts.find((p) => p.key === latest.partKey) : undefined;
  const period = r ? `2017–${r.partialYear} (${r.partialYear} partial)` : undefined;

  const context = r
    ? buildSectionContext({
        id: ID,
        title: TITLE,
        scope: r.parts.map((p) => partCitation(p)).join(", "),
        period: `Since 2017-01-03, through ${r.today}`,
        source: SOURCE.label,
        figures: [
          {
            label: `Sections changed since ${r.last12.since}`,
            value: r.last12.sections,
            unit: "sections",
          },
          {
            label: `Substantive changes since ${r.last12.since}`,
            value: r.last12.changes,
            unit: "changes",
          },
          {
            label: "Substantive changes since 2017, all watched parts",
            value: allChanges,
            unit: "changes",
          },
          ...r.parts.map((p) => ({
            label: `${partCitation(p)} (${p.label}): sections changed since 2017`,
            value: p.changedSections,
            unit: `of ${fmt(p.sections)} sections; latest ${p.latest ?? "none recorded"}`,
          })),
        ],
        maxFigures: 16,
      })
    : null;

  return (
    <Section
      id={ID}
      title={TITLE}
      description="Substantive eCFR changes to the drug, device, vehicle and consumer-product rules product cases cite."
      actions={
        <AskAiButton
          sectionId={ID}
          title={TITLE}
          context={context}
          questions={[
            "Which of these regulation changes matter for failure-to-warn claims?",
            "What changed in the device quality system rule in 2026?",
            "Which vehicle safety standards changed most since 2017?",
          ]}
        />
      }
    >
      <KpiGrid columns={4} label="CFR change radar figures">
        <KpiCard
          as="li"
          label="Sections changed in the last 12 months"
          state={state}
          value={r ? fmt(r.last12.sections) : null}
          meta={
            r ? `${fmt(r.last12.changes)} substantive changes since ${r.last12.since}` : undefined
          }
          source={{ source: SOURCE, asOf: r?.today }}
        />
        <KpiCard
          as="li"
          label="Parts changed in the last 12 months"
          state={state}
          value={r ? fmt(partsRecent.length) : null}
          meta={r ? `of ${fmt(r.parts.length)} watched parts` : undefined}
          source={{ source: SOURCE, asOf: r?.today }}
        />
        <KpiCard
          as="li"
          label="Substantive changes since 2017"
          state={state}
          value={r ? fmt(allChanges) : null}
          meta="Watched parts, eCFR history"
          source={{ source: SOURCE, period }}
        />
        <KpiCard
          as="li"
          label="Latest change"
          state={state}
          value={latest ? latest.date : null}
          meta={
            latest && latestPart
              ? `${latestPart.title} CFR ${latest.section} · ${latestPart.label}`
              : undefined
          }
          source={{ source: SOURCE, asOf: r?.today }}
        />
      </KpiGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          variant="editorial"
          title={
            r
              ? `${fmt(r.last12.sections)} sections of these parts changed in the last 12 months`
              : "Substantive changes by part and year"
          }
          subtitle={`Substantive section changes per part and year · since 2017 · ${r?.partialYear ?? ""} partial`}
          status={status}
          sources={[SOURCE]}
          period={period}
          asOf={r?.today}
          partial={r ? `${r.partialYear} runs through ${r.today}.` : undefined}
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                eCFR history begins on 2017-01-03, so earlier amendments are not counted (for
                example 21 CFR 314.70 was last changed in 2016).
              </li>
              <li>
                Editorial reissues are not counted; each change is one new version of one section.
              </li>
            </ul>
          }
          table={
            r
              ? {
                  caption: "Substantive changes per part and year since 2017",
                  columns: [
                    { label: "Part" },
                    ...r.years.map((y) => ({ label: y === r.partialYear ? `${y} (partial)` : y })),
                    { label: "Sections changed" },
                  ],
                  rows: r.parts.map((p) => ({
                    key: p.key,
                    cells: [
                      `${partCitation(p)} · ${p.label}`,
                      ...r.years.map((y) => p.byYear[y] ?? 0),
                      `${fmt(p.changedSections)} of ${fmt(p.sections)}`,
                    ],
                  })),
                }
              : undefined
          }
          actions={r ? <ChangesDrawer changes={r.changes} today={r.today} /> : undefined}
        >
          {r ? (
            <Heatmap
              rows={r.parts.map((p) => ({
                id: p.key,
                label: `${p.title} CFR ${p.part} · ${p.label}`,
              }))}
              columns={r.years.map((y) => ({ id: y, label: y === r.partialYear ? `${y}*` : y }))}
              value={(row, col) => r.parts.find((p) => p.key === row)?.byYear[col] ?? null}
              formatter={metricFormatter("count")}
              cellLabels
              ariaLabel="Substantive changes per CFR part and year since 2017"
              cellNote={(row) => {
                const p = r.parts.find((x) => x.key === row);
                return p
                  ? `${fmt(p.changedSections)} of ${fmt(p.sections)} sections changed since 2017`
                  : undefined;
              }}
            />
          ) : null}
        </ChartCard>

        <ChartCard
          variant="editorial"
          title={
            trendTakeaway(
              "Changes to watched parts",
              totals.map((t) => ({ label: t.year, value: t.changes, partial: t.partial })),
              fmt,
            ) ?? "Substantive changes per year"
          }
          subtitle="All watched parts together, substantive section changes per year"
          status={status}
          sources={[SOURCE]}
          period={period}
          partial={r ? `${r.partialYear} runs through ${r.today}.` : undefined}
          table={periodTable(totals, "year", [{ key: "changes", label: "Changes" }], fmt, {
            caption: "Substantive changes per year, watched parts",
            xLabel: "Year",
            partialKey: "partial",
          })}
        >
          <TrendColumns
            rows={totals}
            xKey="year"
            series={[{ key: "changes", label: "Changes" }]}
            format={fmt}
            partialKey="partial"
            height={240}
            ariaLabel="Substantive changes per year to the watched CFR parts"
          />
        </ChartCard>
      </div>
      <AiSummary context={context} className="mt-4" />
    </Section>
  );
}

function ChangesDrawer({ changes, today }: { changes: SectionChange[]; today: string }) {
  return (
    <DataDrawer
      title="Changes to watched parts"
      description="Every substantive section change since 2017, newest first. The Federal Register rule is shown when the eCFR source note names it or it is the only rule for the part that day."
      triggerLabel={`View data (${changes.length.toLocaleString("en-US")})`}
      filename="cfr-watched-part-changes"
      rows={changes}
      rowKey={(c, i) => `${c.id}:${c.date}:${i}`}
      searchable
      searchLabel="Filter by section or heading"
      source={{ source: SOURCE, asOf: today }}
      columns={[
        { key: "date", label: "Version date", value: (c) => c.date },
        {
          key: "section",
          label: "Section",
          value: (c) => `${c.partKey.split(":")[0]} CFR ${c.section}`,
          render: (c) => (
            <Link
              to="/law/cfr/$title/$section"
              params={{ title: c.partKey.split(":")[0]!, section: c.section }}
              className="text-primary hover:underline"
            >
              {c.partKey.split(":")[0]} CFR {c.section}
            </Link>
          ),
        },
        {
          key: "heading",
          label: "Heading",
          value: (c) => (c.removed ? `${c.heading} (removed)` : c.heading),
        },
        {
          key: "fr",
          label: "Federal Register rule",
          value: (c) =>
            c.fr.length ? c.fr.map((f) => f.citation ?? f.documentNumber).join("; ") : null,
          render: (c) =>
            c.fr.length ? (
              <span className="flex flex-wrap gap-x-2">
                {c.fr.map((f) => (
                  <a
                    key={f.documentNumber}
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {f.citation ?? f.documentNumber}
                  </a>
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">Not recorded</span>
            ),
        },
      ]}
    />
  );
}
