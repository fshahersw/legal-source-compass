/**
 * Courts & judges lead chart: the slowest and fastest federal districts by median days from filing to disposition,
 * against the national median (FJC IDB civil cases, latest complete fiscal year). Each row links nowhere by itself;
 * the table lists the same districts with their court ids.
 */
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { DivergingDots } from "@/components/charts/d3/charts";
import { AiSummary } from "@/components/kit/ai/AiSummary";
import { AskAiButton } from "@/components/kit/ai/AskAiButton";
import { buildSectionContext } from "@/components/kit/ai/buildSectionContext";
import { districtsQuery, nationalQuery } from "./caseloadQueries";
import { districtSpeed } from "./districtSpeed";

const SOURCE = {
  label: "Federal Judicial Center, Integrated Database (civil cases)",
  url: "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present",
};
const MIN_CLOSED = 500;
const TITLE = "Time to disposition by district";
const days = (v: number) => `${Math.round(v).toLocaleString("en-US")} days`;

export function DistrictSpeedChart() {
  const districts = useQuery(districtsQuery);
  const national = useQuery(nationalQuery);
  const fy = national.data?.latestFy ?? null;
  const nationalMedian =
    fy != null ? (national.data?.years.find((y) => y.fy === fy)?.medianDays ?? null) : null;
  const speed = districts.data
    ? districtSpeed(districts.data.rows, nationalMedian, { n: 5, minTerminations: MIN_CLOSED })
    : null;
  const status =
    districts.isPending || national.isPending
      ? ({ kind: "loading" } as const)
      : districts.isError || national.isError
        ? ({
            kind: "error",
            message: "This chart could not be loaded.",
            onRetry: () => {
              void districts.refetch();
              void national.refetch();
            },
          } as const)
        : !speed
          ? ({ kind: "empty", reason: "District medians are not recorded yet." } as const)
          : ({ kind: "ready" } as const);
  const picks = speed ? [...speed.slowest, ...speed.fastest] : [];
  const slowest = speed?.slowest[0];
  const fastest = speed?.fastest.at(-1);
  const period = fy != null ? `FY${fy}` : undefined;

  const context =
    speed && fy != null
      ? buildSectionContext({
          id: "district-speed",
          title: TITLE,
          scope: `Federal district courts that closed at least ${MIN_CLOSED} civil cases`,
          period: `FY${fy}`,
          source: SOURCE.label,
          figures: [
            { label: "National median, filing to disposition", value: speed.baseline, unit: "days" },
            ...picks.map((d) => ({ label: d.name, value: d.value, unit: "days" })),
            { label: "Districts compared", value: speed.counted },
          ],
          maxFigures: 14,
        })
      : null;

  return (
    <section id="district-speed" aria-label={TITLE} className="space-y-3">
      <ChartCard
        variant="editorial"
        title={
          slowest && fastest && speed
            ? `FY${fy}: civil cases took a median ${days(speed.baseline)} nationally, from ${days(fastest.value)} in ${fastest.name} to ${days(slowest.value)} in ${slowest.name}`
            : TITLE
        }
        subtitle={`Median days from filing to disposition, slowest and fastest 5 districts against the national median${period ? ` · ${period}` : ""}`}
        status={status}
        sources={[SOURCE]}
        period={period}
        about={
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Median days from filing to disposition over the civil cases each district closed in
              the fiscal year (October 1 to September 30).
            </li>
            <li>
              Only districts that closed at least {MIN_CLOSED} civil cases are compared
              {speed ? ` (${speed.counted} districts; ${speed.excluded} left out)` : ""}, so a court
              with a handful of closings does not top the list.
            </li>
            <li>
              The national median is over all civil cases closed nationally, not the median of the
              district medians. Mass-tort dockets can move a district&apos;s median sharply.
            </li>
          </ul>
        }
        table={
          speed
            ? {
                caption: `Median days from filing to disposition, FY${fy}`,
                columns: [{ label: "District" }, { label: "Median days" }, { label: "Group" }],
                rows: picks.map((d, i) => ({
                  key: d.id,
                  cells: [d.name, Math.round(d.value), i < 5 ? "Slowest 5" : "Fastest 5"],
                })),
              }
            : undefined
        }
        minHeight={320}
      >
        {speed ? (
          <DivergingDots
            items={picks.map((d) => ({ label: d.name, value: d.value }))}
            baseline={speed.baseline}
            baselineLabel="National median"
            format={(v) => Math.round(v).toLocaleString("en-US")}
            labelWidth={200}
          />
        ) : null}
      </ChartCard>
      <AiSummary
        context={context}
        actions={
          <AskAiButton
            sectionId="district-speed"
            title={TITLE}
            context={context}
            questions={[
              "Why do some districts take much longer to resolve civil cases?",
              "How does a slow district affect where a case should be filed?",
              "What does the national median include?",
            ]}
          />
        }
      />
    </section>
  );
}
