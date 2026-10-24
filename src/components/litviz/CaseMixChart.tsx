/**
 * Litigation lead chart: federal civil filings per fiscal year, stacked by case type (this project's nature-of-suit
 * groups from the FJC Integrated Database). The five largest groups in the latest complete year are shown; the rest
 * is the national total minus those five. The unfinished fiscal year is drawn faded and never used for the title.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { StackedBarsOverTime } from "@/components/charts/d3/charts";
import { groupTrendsQuery, nationalQuery } from "@/components/courts/caseload/caseloadQueries";
import { AiSummary } from "@/components/kit/ai/AiSummary";
import { AskAiButton } from "@/components/kit/ai/AskAiButton";
import { buildSectionContext } from "@/components/kit/ai/buildSectionContext";
import { formatCount } from "@/lib/analytics/trend";
import { caseMixRows } from "./caseMix";

const SOURCE = {
  label: "Federal Judicial Center, Integrated Database (civil cases)",
  url: "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present",
};
const TITLE = "Federal civil filings by case type";

export function CaseMixChart() {
  const groups = useQuery(groupTrendsQuery);
  const national = useQuery(nationalQuery);
  const mix =
    groups.data && national.data
      ? caseMixRows(groups.data.rows, national.data.years, { top: 5, span: 20 })
      : null;
  const status =
    groups.isPending || national.isPending
      ? ({ kind: "loading" } as const)
      : groups.isError || national.isError
        ? ({
            kind: "error",
            message: "This chart could not be loaded.",
            onRetry: () => {
              void groups.refetch();
              void national.refetch();
            },
          } as const)
        : !mix
          ? ({ kind: "empty", reason: "Filings by case type are not recorded yet." } as const)
          : ({ kind: "ready" } as const);

  const latestRow = mix?.rows.find((r) => r.period === `FY${mix.latestFy}`);
  const latestTotal = latestRow
    ? Object.values(latestRow.values).every((v) => v != null)
      ? Object.values(latestRow.values).reduce<number>((s, v) => s + (v ?? 0), 0)
      : null
    : null;
  const first = mix?.rows[0]?.period;
  const last = mix?.rows.at(-1)?.period;
  const period = first && last ? `${first} – ${last}` : undefined;
  const partialFy = national.data?.partialFy ?? null;

  const context =
    mix && latestRow
      ? buildSectionContext({
          id: "litigation-case-mix",
          title: TITLE,
          scope: "U.S. district courts, civil cases",
          period: period ?? null,
          source: SOURCE.label,
          figures: [
            { label: `All civil filings, FY${mix.latestFy}`, value: latestTotal, unit: "cases" },
            ...mix.keys.map((k) => ({
              label: `${mix.labels[k]}, FY${mix.latestFy}`,
              value: latestRow.values[k],
              unit: "cases",
            })),
            ...mix.rows
              .filter((r) => !r.partial)
              .slice(-8, -1)
              .map((r) => ({
                label: `All civil filings, ${r.period}`,
                value: Object.values(r.values).every((v) => v != null)
                  ? Object.values(r.values).reduce<number>((s, v) => s + (v ?? 0), 0)
                  : null,
                unit: "cases",
              })),
          ],
          maxFigures: 20,
        })
      : null;

  return (
    <section id="litigation-case-mix" aria-label={TITLE} className="space-y-3">
      <ChartCard
        variant="editorial"
        title={
          mix && latestTotal != null && mix.shownShare != null
            ? `FY${mix.latestFy}: ${formatCount(latestTotal)} federal civil filings; the five largest case types were ${Math.round(mix.shownShare * 100)}%`
            : TITLE
        }
        subtitle="Civil cases filed in U.S. district courts each fiscal year, by case type"
        status={status}
        sources={[SOURCE]}
        period={period}
        about={
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Fiscal years run October 1 to September 30 and are named for the year they end.
            </li>
            <li>
              Case types group the nature-of-suit code each case was filed under. The five largest
              in FY{mix?.latestFy ?? ""} are shown; &ldquo;All other case types&rdquo; is the
              national total minus those five.
            </li>
            <li>
              Mass-tort waves show up as product liability spikes (for example FY2020). A year a
              figure is not recorded for is left blank.
            </li>
            {partialFy ? (
              <li>FY{partialFy} is unfinished and drawn faded; it is not used for the title.</li>
            ) : null}
          </ul>
        }
        table={
          mix
            ? {
                caption: "Federal civil filings by case type and fiscal year",
                columns: [{ label: "Fiscal year" }, ...mix.keys.map((k) => ({ label: mix.labels[k]! }))],
                rows: mix.rows.map((r) => ({
                  key: r.period,
                  cells: [
                    `${r.period}${r.partial ? " (unfinished)" : ""}`,
                    ...mix.keys.map((k) => r.values[k] ?? "Not recorded"),
                  ],
                })),
              }
            : undefined
        }
        minHeight={340}
      >
        {mix ? (
          <StackedBarsOverTime rows={mix.rows} keys={mix.keys} labels={mix.labels} height={300} />
        ) : null}
      </ChartCard>
      <AiSummary
        context={context}
        actions={
          <AskAiButton
            sectionId="litigation-case-mix"
            title={TITLE}
            context={context}
            questions={[
              "Which case types are growing fastest?",
              "What caused the spike in product liability filings?",
              "How do prisoner and civil rights filings compare over time?",
            ]}
          />
        }
      />
    </section>
  );
}
