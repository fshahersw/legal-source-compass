/**
 * Courts & judges lead chart: the slowest and fastest federal districts by median days from filing to disposition,
 * against the median district (FJC IDB civil cases, latest complete fiscal year). A district name links to its court
 * profile only when the district's own record links that profile; otherwise it stays plain text.
 */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
const short = (name: string) => name.replace(/^District Court, /, "");

export function DistrictSpeedChart() {
  const navigate = useNavigate();
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
            {
              label: "Median of qualifying districts' medians, filing to disposition",
              value: speed.baseline,
              unit: "days",
            },
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
            ? `FY${fy}: the typical district closed civil cases in a median ${days(speed.baseline)}, from ${days(fastest.value)} in ${short(fastest.name)} to ${days(slowest.value)} in ${short(slowest.name)}`
            : TITLE
        }
        subtitle={`Median days from filing to disposition, slowest and fastest 5 districts against the median district${period ? ` · ${period}` : ""}`}
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
              The line is the median of the compared districts&apos; medians (the typical district).
              {speed?.national != null
                ? ` Over all civil cases closed nationally the median was ${days(speed.national)}: mass-tort dockets closed in a few districts pull that figure up.`
                : ""}
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
            items={picks.map((d) =>
              d.hasCourtPage
                ? { label: short(d.name), value: d.value, href: `/courts/${d.id}` }
                : { label: short(d.name), value: d.value, note: "No court page recorded" },
            )}
            onNavigate={(href) => void navigate({ to: href })}
            baseline={speed.baseline}
            baselineLabel="Median district"
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
              "Why is the national all-case median so different from the typical district?",
            ]}
          />
        }
      />
    </section>
  );
}
