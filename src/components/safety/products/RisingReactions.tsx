/**
 * Product profile, reactions tab: the rising-reaction monitor. MedDRA preferred terms whose reports rose most in the
 * latest four quarters against the four before, compared only where every quarter records the term (each period keeps
 * its top terms only), with an index chart the reader can rebase to any quarter.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/recharts";
import { IndexChart } from "@/components/charts/d3/charts";
import { AiSummary, AskAiButton, BarList, Section, buildSectionContext } from "@/components/kit";
import { risingTerms, termSeries } from "@/lib/safety/risingTerms";
import { termPeriodsQuery } from "./queries";
import { sourceLabel, termMatrix, windowStart, type SafetySubjectProfile } from "./productModel";

const fmt = (v: number) => v.toLocaleString("en-US");
const ID = "rising-reactions";
const PERIODS = 16;

export function RisingReactions({ p }: { p: SafetySubjectProfile }) {
  const from = windowStart(p.periods, "meddra_pt", PERIODS);
  const q = useQuery(termPeriodsQuery(p.subject.id, "meddra_pt", from));
  const matrix = useMemo(() => termMatrix(q.data ?? null), [q.data]);
  const periods = matrix.columns.map((c) => c.id);
  const result = useMemo(
    () =>
      risingTerms(
        matrix.rows.map((r) => r.id),
        matrix.columns.map((c) => c.id),
        matrix.value,
      ),
    [matrix],
  );
  if (!q.data || !result || !result.rising.length) return null;
  const top = result.rising.slice(0, 5).map((r) => r.term);
  const series = termSeries(top, periods.slice(-12), matrix.value);
  const windowText = `${result.recentPeriods[0]}–${result.recentPeriods.at(-1)} vs ${result.priorPeriods[0]}–${result.priorPeriods.at(-1)}`;
  const latest = q.data.periods.at(-1);
  const context = buildSectionContext({
    id: ID,
    title: `${p.subject.label}: rising reactions`,
    period: windowText,
    source: `${sourceLabel(p.subject.source_id)} reaction counts`,
    figures: result.rising.map((r) => ({
      label: `${r.term} reports`,
      value: r.recent,
      note: `prior window ${fmt(r.prior)}${r.change != null ? `, ${r.change > 0 ? "+" : ""}${r.change}%` : ""}`,
    })),
  });
  return (
    <Section
      id={ID}
      title="Rising reactions"
      description="Reactions whose reports rose most in the latest year."
      actions={<AskAiButton sectionId={ID} context={context} size="icon" />}
    >
      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-heading font-semibold text-foreground">Largest increases</h3>
            <span className="text-meta text-muted-foreground">{windowText}</span>
          </div>
          <BarList
            ariaLabel="Reactions with the largest increase in reports"
            items={result.rising.map((r) => ({
              id: r.term,
              label: r.term,
              value: r.increase,
              display: `+${fmt(r.increase)}`,
              note: `${fmt(r.prior)} → ${fmt(r.recent)} reports${r.change != null ? ` (${r.change > 0 ? "+" : ""}${r.change}%)` : ""}`,
            }))}
          />
          {result.notComparable ? (
            <p className="mt-2 text-meta text-muted-foreground">
              {result.notComparable} of the top terms are left out: a period in the comparison does
              not record them.
            </p>
          ) : null}
        </div>
        <ChartCard
          title={`Reports for the fastest-rising reactions, indexed to a ${result.grain} you choose`}
          subtitle={`Reports per ${result.grain}, rebased to 100 at the chosen ${result.grain}`}
          sources={
            latest
              ? [
                  {
                    label: `${sourceLabel(p.subject.source_id)}: latest period query`,
                    url: latest.query_url,
                  },
                ]
              : []
          }
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Counts are reports that list the reaction (MedDRA preferred term), not confirmed
                cases.
              </li>
              <li>
                Each period stores only its top terms. A term missing from a period that hit that
                limit is not recorded, so growth is computed only where every period of both windows
                records the term.
              </li>
              <li>Rising reports can reflect publicity or litigation as well as new harm.</li>
            </ul>
          }
          table={{
            caption: "Reports per period for the rising reactions",
            columns: [
              { label: "Reaction" },
              ...periods.slice(-12).map((x) => ({ label: x, align: "right" as const })),
            ],
            rows: series.map((s) => ({
              key: s.id,
              cells: [
                s.label,
                ...s.points.map((pt) => (pt.value == null ? "Not recorded" : pt.value)),
              ],
            })),
          }}
        >
          <IndexChart series={series} />
        </ChartCard>
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
