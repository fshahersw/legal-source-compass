/**
 * Court page, Caseload section: the district's speed and backlog since June 2000 (FCMS history, 12 months ending
 * June 30, against the median district) and its MDL actions pending at each fiscal year end since FY2005 (Judicial
 * Business), with the latest JPML count beside it. Renders nothing for a court that is not a federal district.
 */
import { useQuery } from "@tanstack/react-query";
import {
  ChartCard,
  TrendColumns,
  TrendLines,
  periodTable,
  trendTakeaway,
} from "@/components/charts/recharts";
import { AiSummary, AskAiButton, KpiCard, KpiGrid, buildSectionContext } from "@/components/kit";
import {
  FCMS_METRIC,
  latestValue,
  medianByPeriod,
  type FcmsDistrict,
  type FcmsMetric,
} from "@/lib/courts/fcmsHistory";
import { fy, reconciliationNotes, valueAt, type HubDistrict } from "@/lib/courts/mdlHubs";
import {
  DISTRICT_ID,
  SOURCES,
  courtMdlLoadQuery,
  fcmsCourtQuery,
  fcmsVenuesQuery,
  fmtDate,
  fmtInt,
  fmtOne,
  fmtPct,
  mdlHubsQuery,
} from "./venueQueries";

export function CourtVenueHistoryPanel({ courtId }: { courtId: string }) {
  const enabled = DISTRICT_ID.test(courtId);
  const court = useQuery({ ...fcmsCourtQuery(courtId), enabled });
  const all = useQuery({ ...fcmsVenuesQuery, enabled });
  const hubs = useQuery({ ...mdlHubsQuery, enabled });
  const load = useQuery({ ...courtMdlLoadQuery(courtId), enabled });
  if (!enabled) return null;
  if (court.isPending || hubs.isPending)
    return (
      <div
        className="mb-6 h-56 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading venue speed and MDL history"
      />
    );
  const d = court.data ?? null;
  const hub = hubs.data?.districts.find((h) => h.courtId === courtId) ?? null;
  if (!d && !hub) {
    if (court.isError || hubs.isError)
      return (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-border px-4 py-3 text-meta text-muted-foreground"
        >
          Venue speed and MDL history could not be loaded.{" "}
          <button
            type="button"
            className="text-primary underline"
            onClick={() => {
              void court.refetch();
              void hubs.refetch();
            }}
          >
            Retry
          </button>
        </p>
      );
    return null;
  }
  return (
    <Body
      courtId={courtId}
      d={d}
      hub={hub}
      all={all.data?.districts ?? []}
      jpml={
        load.data
          ? { pending: load.data.pendingActions, mdls: load.data.pendingMdls, asOf: load.data.asOf }
          : null
      }
    />
  );
}

function Body({
  courtId,
  d,
  hub,
  all,
  jpml,
}: {
  courtId: string;
  d: FcmsDistrict | null;
  hub: HubDistrict | null;
  all: FcmsDistrict[];
  jpml: { pending: number | null; mdls: number | null; asOf: string | null } | null;
}) {
  const latest = d ? `12 months to ${fmtDate(d.latest)}` : undefined;
  const k = (m: FcmsMetric) => (d ? (latestValue(d, m)?.value ?? null) : null);
  const rank = (m: FcmsMetric) => {
    const r = d?.rank[m];
    return r ? `rank ${r.rank} of ${r.of} (1 = highest)` : "rank not recorded";
  };
  const hubYear = hub ? Math.max(...hub.years) : null;
  const hubPending = hub && hubYear !== null ? valueAt(hub, "mdl_pending", hubYear) : null;
  const name = d?.name ?? hub?.name ?? courtId;

  const series = (m: FcmsMetric) => {
    if (!d) return [];
    const med = medianByPeriod(all, m);
    return d.june[m].map((p) => ({
      period: p.label,
      court: p.value,
      median: med.get(p.label)?.value ?? null,
    }));
  };
  const over3 = series("civil_over_3y_pct");
  const trial = series("median_months_civil_to_trial");
  const trialRecorded = trial.some((r) => r.court !== null);
  const span = over3.length ? `${over3[0]!.period}–${over3.at(-1)!.period}` : undefined;
  const hubRows = hub
    ? hub.years.map((y) => ({ fy: fy(y), pending: valueAt(hub, "mdl_pending", y) }))
    : [];
  const notes = hub ? reconciliationNotes(hub, ["mdl_pending"]) : null;

  const context = buildSectionContext({
    id: `court-venue-${courtId}`,
    title: `Speed, backlog and MDL load: ${name}`,
    scope: name,
    period: [latest, hubYear !== null ? fy(hubYear) : null].filter(Boolean).join("; "),
    source: `${SOURCES.fcms.label}; ${SOURCES.jb.label}`,
    figures: [
      {
        label: "Months from civil filing to trial",
        value: k("median_months_civil_to_trial"),
        unit: "months",
        period: latest,
      },
      {
        label: "Civil cases pending over 3 years",
        value: k("civil_over_3y_pct"),
        unit: "%",
        period: latest,
      },
      { label: "Vacant judgeship months", value: k("vacant_judgeship_months"), period: latest },
      { label: "Weighted filings per judgeship", value: k("pj_weighted_filings"), period: latest },
      ...(hubYear !== null
        ? [
            {
              label: "MDL actions pending at fiscal year end",
              value: hubPending,
              period: fy(hubYear),
            },
          ]
        : []),
      ...(jpml
        ? [
            {
              label: "MDL actions pending (JPML report)",
              value: jpml.pending,
              period: jpml.asOf ?? undefined,
            },
          ]
        : []),
      ...(over3[0]
        ? [
            {
              label: "Civil cases pending over 3 years",
              value: over3[0].court,
              unit: "%",
              period: over3[0].period,
            },
          ]
        : []),
    ],
    maxFigures: 12,
  });

  return (
    <div id="court-venue-history" className="mb-6 space-y-4">
      <KpiGrid columns={4} label={`Speed and MDL load, ${name}`}>
        <KpiCard
          as="li"
          label="Months to civil trial"
          value={
            k("median_months_civil_to_trial") !== null
              ? fmtOne(k("median_months_civil_to_trial")!)
              : null
          }
          unit="months"
          meta={d ? `${latest} · ${rank("median_months_civil_to_trial")}` : undefined}
          source={{ source: { label: SOURCES.fcms.label, href: d?.sourceUrl ?? SOURCES.fcms.url } }}
        />
        <KpiCard
          as="li"
          label="Civil cases over 3 years old"
          value={k("civil_over_3y_pct") !== null ? fmtPct(k("civil_over_3y_pct")!) : null}
          meta={d ? `${latest} · ${rank("civil_over_3y_pct")}` : undefined}
        />
        <KpiCard
          as="li"
          label="Vacant judgeship months"
          value={
            k("vacant_judgeship_months") !== null ? fmtOne(k("vacant_judgeship_months")!) : null
          }
          meta={d ? `${latest} · ${rank("vacant_judgeship_months")}` : undefined}
        />
        <KpiCard
          as="li"
          label="MDL actions pending"
          value={hubPending !== null ? fmtInt(hubPending) : null}
          meta={
            hubYear !== null
              ? `${fy(hubYear)} year end${jpml?.pending != null ? ` · JPML ${fmtInt(jpml.pending)} on ${fmtDate(jpml.asOf)}` : ""}`
              : undefined
          }
          source={{ source: { label: SOURCES.jb.label, href: hub?.sourceUrl ?? SOURCES.jb.url } }}
        />
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-2">
        {d ? (
          <ChartCard
            title={
              trendTakeaway(
                "The share of civil cases pending over 3 years",
                over3.map((r) => ({ label: r.period, value: r.court })),
                fmtPct,
              ) ?? "Civil cases pending over 3 years"
            }
            subtitle={`Percent of pending civil cases · 12 months to June · ${span ?? ""} · dashed: median district`}
            status={
              over3.some((r) => r.court !== null)
                ? { kind: "ready" }
                : { kind: "empty", reason: "Not recorded for this district." }
            }
            sources={[SOURCES.fcms]}
            period={span}
            about={
              <ul className="list-disc space-y-1 pl-4">
                <li>
                  Each point covers the 12 months ending June 30, taken from the earliest FCMS
                  edition that prints it.
                </li>
                <li>
                  The median district is the middle of all districts recorded for that period (at
                  least 20).
                </li>
                <li>
                  MDL member cases count in the transferee district&apos;s pending civil caseload.
                </li>
              </ul>
            }
            table={periodTable(
              over3,
              "period",
              [
                { key: "court", label: name },
                { key: "median", label: "Median district" },
              ],
              fmtPct,
              { caption: `Civil cases pending over 3 years, ${name}`, xLabel: "Period" },
            )}
            actions={
              <AskAiButton
                sectionId={`court-venue-${courtId}`}
                title={context.title}
                context={context}
                size="icon"
              />
            }
            minHeight={240}
          >
            <TrendLines
              rows={over3}
              xKey="period"
              series={[
                { key: "court", label: name },
                { key: "median", label: "Median district", context: true },
              ]}
              format={fmtPct}
              tick={(v) => `${Math.round(v)}%`}
              xTick={(v) => `’${v.slice(-2)}`}
              ariaLabel={`Civil cases pending over 3 years, ${name}, against the median district`}
            />
          </ChartCard>
        ) : null}
        {d ? (
          <ChartCard
            title={
              trendTakeaway(
                "Median time from civil filing to trial",
                trial.map((r) => ({ label: r.period, value: r.court })),
                (v) => `${fmtOne(v)} months`,
              ) ?? "Months from civil filing to trial"
            }
            subtitle={`${FCMS_METRIC.median_months_civil_to_trial.label} · 12 months to June · ${span ?? ""} · dashed: median district`}
            status={
              trialRecorded
                ? { kind: "ready" }
                : {
                    kind: "empty",
                    reason:
                      "Not recorded: FCMS prints no trial-time figure for this district (too few civil trials).",
                  }
            }
            sources={[SOURCES.fcms]}
            period={span}
            about={
              <p>
                FCMS prints the median only when a district tried enough civil cases in the period;
                other periods are gaps, never zero.
              </p>
            }
            table={periodTable(
              trial,
              "period",
              [
                { key: "court", label: name },
                { key: "median", label: "Median district" },
              ],
              fmtOne,
              { caption: `Median months from civil filing to trial, ${name}`, xLabel: "Period" },
            )}
            minHeight={240}
          >
            <TrendLines
              rows={trial}
              xKey="period"
              series={[
                { key: "court", label: name },
                { key: "median", label: "Median district", context: true },
              ]}
              format={(v) => `${fmtOne(v)} months`}
              tick={(v) => fmtOne(v)}
              xTick={(v) => `’${v.slice(-2)}`}
              ariaLabel={`Median months from civil filing to trial, ${name}`}
            />
          </ChartCard>
        ) : null}
        {hub ? (
          <ChartCard
            className="xl:col-span-2"
            title={
              trendTakeaway(
                "MDL actions pending here",
                hubRows.map((r) => ({ label: r.fy, value: r.pending })),
                fmtInt,
              ) ?? "MDL actions pending at fiscal year end"
            }
            subtitle={`MDL actions pending on September 30 · ${hubRows[0]?.fy ?? ""}–${hubRows.at(-1)?.fy ?? ""}`}
            status={
              hubRows.some((r) => r.pending !== null)
                ? { kind: "ready" }
                : { kind: "empty", reason: "Not recorded for this district." }
            }
            sources={[SOURCES.jb, SOURCES.jpml]}
            period={`${hubRows[0]?.fy ?? ""}–${hubRows.at(-1)?.fy ?? ""}`}
            footnotes={notes?.shown.length ? notes.shown : undefined}
            about={
              <ul className="list-disc space-y-1 pl-4">
                <li>
                  Fiscal years end September 30. The JPML count
                  {jpml?.asOf ? ` of ${fmtDate(jpml.asOf)}` : ""} is a point-in-time figure on
                  another date and is not drawn as a column.
                </li>
                <li>
                  Reconciliation is noted per series-year for this series only
                  {notes?.otherSeries
                    ? `; ${notes.otherSeries} other series of this district's record carry a note that does not affect these counts`
                    : ""}
                  .
                </li>
              </ul>
            }
            table={periodTable(
              hubRows,
              "fy",
              [{ key: "pending", label: "MDL actions pending" }],
              fmtInt,
              {
                caption: `MDL actions pending, ${name}`,
                xLabel: "Fiscal year",
              },
            )}
            minHeight={220}
          >
            <TrendColumns
              rows={hubRows}
              xKey="fy"
              series={[{ key: "pending", label: "MDL actions pending" }]}
              format={fmtInt}
              xTick={(v) => `’${v.slice(4)}`}
              ariaLabel={`MDL actions pending at fiscal year end, ${name}`}
            />
          </ChartCard>
        ) : null}
      </div>
      <AiSummary context={context} />
    </div>
  );
}
