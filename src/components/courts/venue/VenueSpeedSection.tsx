/**
 * Venue speed and backlog comparator (FCMS district profiles, 12 months ending June 30): the largest MDL districts
 * against the median of all 94 districts, now and since June 2000. One period kind per chart; gaps stay gaps.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartCard, TrendLines, periodTable, trendTakeaway } from "@/components/charts/recharts";
import { DivergingDots } from "@/components/charts/d3/charts";
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
  FCMS_METRIC,
  latestValue,
  medianByPeriod,
  medianDistrict,
  type FcmsDistrict,
  type FcmsMetric,
} from "@/lib/courts/fcmsHistory";
import {
  SOURCES,
  fcmsVenuesQuery,
  fmtDate,
  fmtInt,
  fmtOne,
  fmtPct,
  shortDistrict,
  venueScorecardQuery,
} from "./venueQueries";

const TITLE = "Speed and backlog in MDL venues";
const PICK = 8;
const LINES = 4;

export function VenueSpeedSection() {
  const q = useQuery(fcmsVenuesQuery);
  const mdl = useQuery(venueScorecardQuery);
  const districts = q.data?.districts ?? [];
  const byId = new Map(districts.map((d) => [d.courtId, d]));
  const picks = (mdl.data?.rows ?? [])
    .map((r) => byId.get(r.courtId))
    .filter((d): d is FcmsDistrict => !!d)
    .slice(0, PICK);
  const over3 = medianDistrict(districts, "civil_over_3y_pct");
  const trial = medianDistrict(districts, "median_months_civil_to_trial");
  const weighted = medianDistrict(districts, "pj_weighted_filings");
  const period = q.data?.period ? `12 months to ${fmtDate(q.data.period)}` : undefined;
  const lines = picks.slice(0, LINES);
  const medians = medianByPeriod(districts, "civil_over_3y_pct");
  const labels = lines[0]?.june.civil_over_3y_pct.map((p) => p.label) ?? [];
  const rows = labels.map((label, i) => {
    const row: Record<string, string | number | null> = { period: label };
    for (const d of lines) row[d.courtId] = d.june.civil_over_3y_pct[i]?.value ?? null;
    row["median"] = medians.get(label)?.value ?? null;
    return row;
  });
  const span = labels.length ? `${labels[0]}–${labels.at(-1)}` : undefined;
  const loading = q.isPending || mdl.isPending;
  const err = q.isError || mdl.isError;
  const retry = () => {
    void q.refetch();
    void mdl.refetch();
  };
  const dotsStatus = loading
    ? ({ kind: "loading" } as const)
    : err
      ? ({ kind: "error", onRetry: retry } as const)
      : !picks.length || over3.value === null
        ? ({ kind: "empty", reason: "FCMS district values are not recorded." } as const)
        : ({ kind: "ready" } as const);
  const linesStatus = loading
    ? ({ kind: "loading" } as const)
    : err
      ? ({ kind: "error", onRetry: retry } as const)
      : rows.length < 2
        ? ({ kind: "empty", reason: "FCMS history is not recorded." } as const)
        : ({ kind: "ready" } as const);
  const worst = [...picks].sort(
    (a, b) =>
      (latestValue(b, "civil_over_3y_pct")?.value ?? -1) -
      (latestValue(a, "civil_over_3y_pct")?.value ?? -1),
  )[0];
  const worstV = worst ? (latestValue(worst, "civil_over_3y_pct")?.value ?? null) : null;

  const context =
    over3.value !== null && period
      ? buildSectionContext({
          id: "venue-speed",
          title: TITLE,
          scope: "Federal district courts; the districts holding the most pending MDL actions",
          period,
          source: SOURCES.fcms.label,
          figures: [
            {
              label: "Median district, civil cases pending over 3 years",
              value: over3.value,
              unit: "%",
            },
            {
              label: "Median district, months from civil filing to trial",
              value: trial.value,
              unit: "months",
            },
            { label: "Median district, weighted filings per judgeship", value: weighted.value },
            ...picks.flatMap((d) => [
              {
                label: `${d.name}, civil cases pending over 3 years`,
                value: latestValue(d, "civil_over_3y_pct")?.value ?? null,
                unit: "%",
              },
              {
                label: `${d.name}, months from civil filing to trial`,
                value: latestValue(d, "median_months_civil_to_trial")?.value ?? null,
                unit: "months",
              },
            ]),
          ],
          maxFigures: 20,
        })
      : null;

  const metric = (m: FcmsMetric) => FCMS_METRIC[m].label;
  return (
    <Section
      id="venue-speed"
      title="Speed and backlog"
      description="How long civil cases take and how much of the docket is over three years old, in the largest MDL districts."
    >
      <KpiGrid columns={4} label="Venue speed figures">
        <KpiCard
          as="li"
          label="Median district: civil cases over 3 years"
          value={over3.value !== null ? fmtPct(over3.value) : null}
          meta={period}
          state={q.isPending ? "loading" : undefined}
          source={{ source: { label: SOURCES.fcms.label, href: SOURCES.fcms.url } }}
        />
        <KpiCard
          as="li"
          label="Median district: months to civil trial"
          value={trial.value !== null ? fmtOne(trial.value) : null}
          unit="months"
          meta={`${trial.recorded} of ${trial.of} districts report a value`}
          state={q.isPending ? "loading" : undefined}
        />
        <KpiCard
          as="li"
          label="Median district: weighted filings per judgeship"
          value={weighted.value !== null ? fmtInt(weighted.value) : null}
          meta={period}
          state={q.isPending ? "loading" : undefined}
        />
        <KpiCard
          as="li"
          label="Oldest docket among MDL hubs"
          value={worstV !== null ? fmtPct(worstV) : null}
          meta={worst ? `${worst.name}: civil cases over 3 years` : undefined}
          state={loading ? "loading" : undefined}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={
            worst && worstV !== null && over3.value !== null
              ? `${worst.name} has ${fmtPct(worstV)} of civil cases pending over 3 years; the median district has ${fmtPct(over3.value)}`
              : "Civil cases pending over 3 years, MDL districts against the median district"
          }
          subtitle={`Percent of pending civil cases · the ${PICK} districts with the most pending MDL actions · ${period ?? "latest FCMS period"}`}
          status={dotsStatus}
          sources={[SOURCES.fcms, SOURCES.jpml]}
          period={period}
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Districts are the {PICK} with the most pending MDL actions in the JPML report
                {mdl.data?.jpmlAsOf ? ` of ${fmtDate(mdl.data.jpmlAsOf)}` : ""}.
              </li>
              <li>
                The line is the median of all {over3.of} districts&apos; values ({over3.recorded}{" "}
                recorded), not a pooled national figure: a few MDL dockets would pull a pooled
                figure past most districts.
              </li>
              <li>
                MDL member cases count in a transferee district&apos;s pending civil caseload, which
                is why MDL hubs show old dockets.
              </li>
            </ul>
          }
          table={{
            caption: `FCMS district values, ${period ?? "latest period"}`,
            columns: [
              { label: "District" },
              { label: metric("civil_over_3y_pct"), align: "right" },
              { label: metric("median_months_civil_to_trial"), align: "right" },
              { label: metric("pj_weighted_filings"), align: "right" },
              { label: metric("vacant_judgeship_months"), align: "right" },
            ],
            rows: picks.map((d) => ({
              key: d.courtId,
              cells: [
                d.name,
                cell(d, "civil_over_3y_pct", fmtPct),
                cell(d, "median_months_civil_to_trial", fmtOne),
                cell(d, "pj_weighted_filings", fmtInt),
                cell(d, "vacant_judgeship_months", fmtOne),
              ],
            })),
          }}
          actions={
            <AskAiButton sectionId="venue-speed" title={TITLE} context={context} size="icon" />
          }
          minHeight={300}
        >
          {over3.value !== null ? (
            <DivergingDots
              items={picks.map((d) => ({
                label: shortDistrict(d.name),
                value: latestValue(d, "civil_over_3y_pct")?.value ?? null,
              }))}
              baseline={over3.value}
              baselineLabel="Median district"
              format={(v) => `${fmtOne(v)}%`}
              labelWidth={150}
            />
          ) : null}
        </ChartCard>
        <ChartCard
          variant="editorial"
          title={
            (lines[0]
              ? trendTakeaway(
                  `In ${lines[0].name}, the share of civil cases pending over 3 years`,
                  lines[0].june.civil_over_3y_pct.map((p) => ({ label: p.label, value: p.value })),
                  fmtPct,
                )
              : null) ?? "Civil cases pending over 3 years, MDL districts and the median district"
          }
          subtitle={`Civil cases pending over 3 years, % · 12 months to June each year · ${span ?? ""}`}
          status={linesStatus}
          sources={[SOURCES.fcms]}
          period={span}
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Only the 12-month periods ending June 30 are drawn, so every point covers the same
                window.
              </li>
              <li>Each period comes from the earliest FCMS edition that prints it.</li>
              <li>
                The median district line is drawn only for periods with at least 20 districts
                recorded.
              </li>
              <li>A value FCMS printed as a dash or left blank is a gap (Not recorded).</li>
            </ul>
          }
          table={periodTable(
            rows,
            "period",
            [
              ...lines.map((d) => ({ key: d.courtId, label: d.name })),
              { key: "median", label: "Median district" },
            ],
            fmtPct,
            {
              caption: "Civil cases pending over 3 years, % (12 months to June)",
              xLabel: "Period",
            },
          )}
          minHeight={300}
        >
          <TrendLines
            rows={rows}
            xKey="period"
            series={[
              ...lines.map((d) => ({ key: d.courtId, label: shortDistrict(d.name) })),
              { key: "median", label: "Median district", context: true },
            ]}
            format={fmtPct}
            tick={(v) => `${Math.round(v)}%`}
            xTick={(v) => `’${v.slice(-2)}`}
            height={280}
            ariaLabel="Civil cases pending over 3 years, MDL districts and the median district, June 2000 to June 2026"
          />
        </ChartCard>
      </div>
      <div className="mt-3 flex justify-end">
        <DataDrawer
          title={`FCMS district values, ${period ?? "latest period"}`}
          rows={districts}
          rowKey={(d) => d.courtId}
          searchable
          triggerLabel={`View all ${districts.length} districts`}
          columns={[
            {
              key: "court",
              label: "District",
              value: (d) => d.name,
              render: (d) => (
                <Link
                  to="/courts/$id"
                  params={{ id: d.courtId }}
                  className="text-primary hover:underline"
                >
                  {d.name}
                </Link>
              ),
            },
            ...(
              [
                "civil_over_3y_pct",
                "median_months_civil_to_trial",
                "median_months_civil",
                "pj_weighted_filings",
                "vacant_judgeship_months",
              ] as const
            ).map((m) => ({
              key: m,
              label: `${FCMS_METRIC[m].label}${FCMS_METRIC[m].unit === "%" ? " (%)" : ""}`,
              align: "right" as const,
              value: (d: FcmsDistrict) => latestValue(d, m)?.value ?? null,
            })),
          ]}
          source={{ source: { label: SOURCES.fcms.label, href: SOURCES.fcms.url }, period }}
        />
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}

function cell(d: FcmsDistrict, m: FcmsMetric, f: (v: number) => string) {
  const v = latestValue(d, m)?.value;
  return v != null ? f(v) : "Not recorded";
}
