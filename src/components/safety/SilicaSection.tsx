/**
 * /safety "Occupational exposure": OSHA respirable crystalline silica citations (29 CFR 1910.1053 and 1926.1153), with
 * cut-stone fabricators (NAICS 327991, where engineered-stone countertops are cut) apart from other industries. From
 * safety_osha_silica_v1; until that RPC is applied the section renders nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/recharts";
import { StackedBarsOverTime } from "@/components/charts/d3/charts";
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
import { silicaYears } from "@/lib/safety/safetyWindows";
import { oshaSilicaQuery } from "./sectionQueries";

const SOURCE = {
  label: "U.S. Department of Labor, OSHA enforcement data",
  url: "https://enforcedata.dol.gov/views/data_catalogs.php",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const usd = (v: number) =>
  v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(2)} million`
    : `$${Math.round(v).toLocaleString("en-US")}`;
const ID = "occupational-exposure";
const LABELS = {
  fabricator_general: "Cut-stone fabricators (1910.1053)",
  other_general: "Other general industry (1910.1053)",
  construction: "Construction (1926.1153)",
};

export function SilicaSection() {
  const q = useQuery(oshaSilicaQuery);
  const s = q.data;
  if (!s || !s.last12 || !s.to) return null;
  const years = silicaYears(s);
  const l = s.last12;
  const window = `12 months to ${s.to}`;
  const period = years.length ? `${years[0]!.year}–${years.at(-1)!.year}` : undefined;
  const fab = years.map((y) => ({ year: y.year, value: y.fabricator_general, partial: y.partial }));
  const peak = fab.filter((y) => !y.partial).sort((a, b) => b.value - a.value)[0];
  const context = buildSectionContext({
    id: ID,
    title: "Silica citations (engineered stone)",
    period: window,
    source: SOURCE.label,
    figures: [
      { label: "Silica citation items", value: l.violations, period: window },
      {
        label: "Citation items at cut-stone fabricators",
        value: l.fabricator_violations,
        period: window,
      },
      {
        label: "Cut-stone fabricator inspections cited",
        value: l.fabricator_inspections,
        period: window,
      },
      {
        label: "Current penalties",
        value: l.penalties == null ? null : usd(l.penalties),
        period: window,
      },
      { label: "States with silica citations", value: l.states, period: window },
      ...years.map((y) => ({
        label: "Silica citation items at cut-stone fabricators",
        value: y.fabricator_general,
        period: String(y.year),
        note: y.partial ? "partial year" : undefined,
      })),
    ],
    maxFigures: 20,
  });
  return (
    <Section
      id={ID}
      title="Occupational exposure: silica"
      description="OSHA silica citations, with engineered-stone fabricators apart."
      actions={<AskAiButton sectionId={ID} context={context} size="icon" />}
    >
      <KpiGrid columns={4} label="Silica citation figures">
        <KpiCard as="li" label="Silica citation items" value={fmt(l.violations)} meta={window} />
        <KpiCard
          as="li"
          label="At cut-stone fabricators"
          value={fmt(l.fabricator_violations)}
          meta={`${fmt(l.fabricator_inspections)} inspections`}
        />
        <KpiCard
          as="li"
          label="Current penalties"
          value={l.penalties == null ? null : usd(l.penalties)}
          meta={window}
        />
        <KpiCard
          as="li"
          label="States"
          value={fmt(l.states)}
          meta="With a silica citation"
          source={{ source: { label: SOURCE.label, href: SOURCE.url }, asOf: s.to }}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <ChartCard
          variant="editorial"
          title={
            peak
              ? `Citations at cut-stone fabricators peaked at ${fmt(peak.value)} in ${peak.year}`
              : "Silica citation items per year"
          }
          subtitle={`Silica citation items by issuance year and standard${period ? ` · ${period}` : ""}`}
          status={years.length ? { kind: "ready" } : { kind: "empty", reason: "Not recorded." }}
          sources={[SOURCE]}
          period={period}
          partial={`The data start ${s.from} and end ${s.to}; the first and last years are partial.`}
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Citation items under 29 CFR 1910.1053 (general industry) and 1926.1153
                (construction), joined exactly to their inspection on the OSHA activity number.
              </li>
              <li>
                Cut-stone fabricators are inspections recorded under NAICS 327991 (cut stone and
                stone product manufacturing), where engineered-stone countertops are fabricated.
              </li>
              <li>
                Citations reflect where OSHA inspects (emphasis programs), not how many workers are
                exposed or ill.
              </li>
            </ul>
          }
          table={{
            caption: "Silica citation items per year",
            columns: [
              { label: "Year" },
              { label: LABELS.fabricator_general, align: "right" },
              { label: LABELS.other_general, align: "right" },
              { label: LABELS.construction, align: "right" },
              { label: "Current penalties", align: "right" },
            ],
            rows: [...years].reverse().map((y) => ({
              key: String(y.year),
              cells: [
                `${y.year}${y.partial ? " (partial)" : ""}`,
                y.fabricator_general,
                y.other_general,
                y.construction,
                y.penalties == null ? "Not recorded" : usd(y.penalties),
              ],
            })),
          }}
        >
          <StackedBarsOverTime
            rows={years.map((y) => ({
              period: String(y.year),
              partial: y.partial,
              values: {
                fabricator_general: y.fabricator_general,
                other_general: y.other_general,
                construction: y.construction,
              },
            }))}
            keys={["fabricator_general", "other_general", "construction"]}
            labels={LABELS}
            format={fmt}
          />
        </ChartCard>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-heading font-semibold text-foreground">
              States with the most citations
            </h3>
            <span className="text-meta text-muted-foreground">{window}</span>
          </div>
          <BarList
            ariaLabel="States by silica citation items"
            items={s.states.slice(0, 10).map((st) => ({
              id: st.state,
              label: st.state,
              value: st.violations,
              display: fmt(st.violations),
              note: st.fabricator_violations
                ? `${fmt(st.fabricator_violations)} at fabricators`
                : undefined,
            }))}
          />
          <DataDrawer
            title="Cut-stone fabricator inspections with silica citations"
            description="Inspections at NAICS 327991 establishments with silica citation items in the latest 24 months, as OSHA records the establishment."
            triggerLabel={`See all ${s.establishments.length}`}
            rows={s.establishments}
            rowKey={(e) => String(e.activity_nr)}
            searchable
            columns={[
              { key: "name", label: "Establishment", value: (e) => e.name },
              { key: "city", label: "City", value: (e) => e.city },
              { key: "state", label: "State", value: (e) => e.state },
              { key: "n", label: "Citation items", align: "right", value: (e) => e.violations },
              {
                key: "pen",
                label: "Current penalties ($)",
                align: "right",
                value: (e) => e.penalties,
              },
              { key: "latest", label: "Latest issued", value: (e) => e.latest },
              {
                key: "act",
                label: "OSHA activity",
                value: (e) => String(e.activity_nr),
                render: (e) => (
                  <a
                    href={`https://www.osha.gov/ords/imis/establishment.inspection_detail?id=${e.activity_nr}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {e.activity_nr}
                  </a>
                ),
              },
            ]}
            source={{ source: { label: SOURCE.label, href: SOURCE.url }, asOf: s.to }}
            className="mt-3"
          />
        </div>
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
