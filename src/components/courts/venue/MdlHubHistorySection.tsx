/**
 * MDL hub history by district, FY2005-FY2025 (Judicial Business, court_jb_districts), with the JPML point-in-time
 * count beside it. Reconciliation notes are written per series-year for the districts shown; the record-level
 * "Source total mismatch" badge is not shown, because it flags a whole district for one cumulative cell.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartCard, TrendLines, periodTable } from "@/components/charts/recharts";
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
  fy,
  hubSummary,
  hubTrendRows,
  latestYear,
  rankHubs,
  reconciliationNotes,
  valueAt,
  type HubDistrict,
} from "@/lib/courts/mdlHubs";
import { SOURCES, fmtInt, fmtPct, mdlHubsQuery, venueScorecardQuery } from "./venueQueries";

const TOP = 6;
const TITLE = "MDL actions pending by district";

export function MdlHubHistorySection() {
  const q = useQuery(mdlHubsQuery);
  const jpml = useQuery(venueScorecardQuery);
  const districts = q.data?.districts ?? [];
  const year = latestYear(districts);
  const ranked = year !== null ? rankHubs(districts, year) : [];
  const summary = year !== null ? hubSummary(districts, year) : null;
  const top = ranked.slice(0, TOP).map((r) => r.d);
  const rows = hubTrendRows(top);
  const jpmlBy = new Map((jpml.data?.rows ?? []).map((r) => [r.courtId, r.pendingActions]));
  const first = rows[0]?.["fy"];
  const period = year !== null && typeof first === "string" ? `${first}–${fy(year)}` : undefined;
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
      : top.length < 2 || rows.length < 2
        ? ({ kind: "empty", reason: "Pending MDL actions by district are not recorded." } as const)
        : ({ kind: "ready" } as const);
  const notes = top.flatMap((d) =>
    reconciliationNotes(d, ["mdl_pending"]).shown.map((n) => `${d.name}: ${n}`),
  );
  // The leader five years earlier is that year's own leader; the current leader's own value then is a separate figure.
  const earlier = summary?.leaderFiveYearsEarlier ?? null;
  const topThen = summary?.top ? summary.topFiveYearsEarlier : null;
  const context =
    summary?.top && year !== null
      ? buildSectionContext({
          id: "mdl-hubs",
          title: TITLE,
          scope: "Federal district courts, MDL actions pending at fiscal year end",
          period: period ?? fy(year),
          source: SOURCES.jb.label,
          figures: [
            {
              label: `${summary.top.name}, MDL actions pending`,
              value: summary.top.pending,
              period: fy(year),
            },
            {
              label: `${summary.top.name}, share of national MDL actions pending`,
              value: summary.top.share,
              unit: "%",
              period: fy(year),
            },
            {
              label: "Districts holding 75% of pending MDL actions",
              value: summary.districtsFor75,
              period: fy(year),
            },
            {
              label: "Districts with pending MDL actions",
              value: summary.districtsWithPending,
              period: fy(year),
            },
            ...(earlier
              ? [
                  {
                    label: `Largest MDL district five years earlier: ${earlier.name}, MDL actions pending`,
                    value: earlier.pending,
                    period: fy(year - 5),
                  },
                  {
                    label: `Largest MDL district five years earlier: ${earlier.name}, share of national MDL actions pending`,
                    value: earlier.share,
                    unit: "%",
                    period: fy(year - 5),
                  },
                ]
              : []),
            ...(topThen !== null && earlier?.courtId !== summary.top.courtId
              ? [
                  {
                    label: `${summary.top.name}, MDL actions pending five years earlier`,
                    value: topThen,
                    period: fy(year - 5),
                  },
                ]
              : []),
            ...top.slice(1).map((d) => ({
              label: `${d.name}, MDL actions pending`,
              value: valueAt(d, "mdl_pending", year),
              period: fy(year),
            })),
          ],
          maxFigures: 12,
        })
      : null;

  return (
    <Section
      id="mdl-hubs"
      title="Where MDL actions sit"
      description="Pending MDL actions by transferee district at each fiscal year end, FY2005 to FY2025."
    >
      <KpiGrid columns={4} label="MDL hub figures">
        <KpiCard
          as="li"
          label="Largest MDL district"
          value={summary?.top ? fmtInt(summary.top.pending) : null}
          unit="actions"
          meta={summary?.top && year !== null ? `${summary.top.name}, ${fy(year)}` : undefined}
          state={q.isPending ? "loading" : undefined}
          source={{ source: { label: SOURCES.jb.label, href: SOURCES.jb.url } }}
        />
        <KpiCard
          as="li"
          label="Its share of the national total"
          value={summary?.top?.share != null ? fmtPct(summary.top.share) : null}
          meta={year !== null ? `MDL actions pending, ${fy(year)}` : undefined}
          state={q.isPending ? "loading" : undefined}
        />
        <KpiCard
          as="li"
          label="Districts holding 75% of actions"
          value={summary?.districtsFor75 != null ? String(summary.districtsFor75) : null}
          meta={
            summary
              ? `of ${summary.districtsWithPending} districts with pending MDL actions`
              : undefined
          }
          state={q.isPending ? "loading" : undefined}
        />
        <KpiCard
          as="li"
          label="Largest district five years earlier"
          value={earlier ? fmtInt(earlier.pending) : null}
          unit="actions"
          meta={
            year !== null && earlier
              ? [
                  `${earlier.name}, ${fy(year - 5)}`,
                  summary?.top && earlier.courtId !== summary.top.courtId && topThen !== null
                    ? `${summary.top.name} then: ${fmtInt(topThen)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
          state={q.isPending ? "loading" : undefined}
        />
      </KpiGrid>
      <ChartCard
        variant="editorial"
        className="mt-4"
        title={
          summary?.top?.share != null && year !== null
            ? `${summary.top.name} held ${fmtPct(summary.top.share)} of pending MDL actions at the end of ${fy(year)}`
            : TITLE
        }
        subtitle={`MDL actions pending at fiscal year end (September 30) · the ${TOP} largest districts in ${year !== null ? fy(year) : "the latest year"}${period ? ` · ${period}` : ""}`}
        status={status}
        sources={[SOURCES.jb]}
        period={period}
        about={
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Counts are MDL actions pending in each transferee district on September 30, as the
              Judicial Business tables print them.
            </li>
            <li>
              A JPML report is a point-in-time count on another date; it sits beside these figures
              in the data table and is never joined into the line.
            </li>
            <li>
              A district&apos;s record can carry a cell that did not add up to the published table
              total. Only those series-years are noted below the chart, for the series shown; a
              mismatch in another column (for example a cumulative count) is not a problem with
              these counts.
            </li>
            <li>A printed dash is shown as a gap (Not recorded), never as zero.</li>
          </ul>
        }
        footnotes={notes.length ? notes : undefined}
        table={periodTable(
          rows,
          "fy",
          top.map((d) => ({ key: d.courtId, label: d.name })),
          fmtInt,
          { caption: "MDL actions pending by district, fiscal year end", xLabel: "Fiscal year" },
        )}
        actions={<AskAiButton sectionId="mdl-hubs" title={TITLE} context={context} size="icon" />}
        minHeight={300}
      >
        <TrendLines
          rows={rows}
          xKey="fy"
          series={top.map((d) => ({ key: d.courtId, label: d.name }))}
          format={fmtInt}
          xTick={(v) => `’${v.slice(4)}`}
          endLabels
          height={300}
          ariaLabel="MDL actions pending by district, FY2005 to FY2025"
        />
      </ChartCard>
      <div className="mt-3 flex justify-end">
        {year !== null ? (
          <DataDrawer
            title={`MDL actions pending by district, ${fy(year)}`}
            rows={ranked}
            rowKey={(r) => r.d.courtId}
            searchable
            triggerLabel={`View all ${ranked.length} districts`}
            columns={[
              {
                key: "court",
                label: "District",
                value: (r) => r.d.name,
                render: (r) => (
                  <Link
                    to="/courts/$id"
                    params={{ id: r.d.courtId }}
                    className="text-primary hover:underline"
                  >
                    {r.d.name}
                  </Link>
                ),
              },
              {
                key: "pending",
                label: `Pending ${fy(year)}`,
                align: "right",
                value: (r) => r.pending,
              },
              {
                key: "share",
                label: "Share of national (%)",
                align: "right",
                value: (r) => r.share,
              },
              {
                key: "prior",
                label: `Pending ${fy(year - 5)}`,
                align: "right",
                value: (r) => valueAt(r.d, "mdl_pending", year - 5),
              },
              { key: "peak", label: "Peak year", value: (r) => peakYear(r.d) },
              {
                key: "jpml",
                label: `JPML pending${jpml.data?.jpmlAsOf ? ` (${jpml.data.jpmlAsOf})` : ""}`,
                align: "right",
                value: (r) => jpmlBy.get(r.d.courtId) ?? null,
              },
              {
                key: "notes",
                label: "Reconciliation notes (pending series)",
                value: (r) => reconciliationNotes(r.d, ["mdl_pending"]).shown.join("; ") || null,
              },
            ]}
            source={{ source: { label: SOURCES.jb.label, href: SOURCES.jb.url }, period }}
          />
        ) : null}
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}

function peakYear(d: HubDistrict): string | null {
  let best: { y: number; v: number } | null = null;
  d.years.forEach((y, i) => {
    const v = d.series.mdl_pending[i];
    if (v != null && (!best || v > best.v)) best = { y, v };
  });
  const b = best as { y: number; v: number } | null;
  return b ? `${fy(b.y)} (${fmtInt(b.v)})` : null;
}
