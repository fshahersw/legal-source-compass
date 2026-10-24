import { useQuery } from "@tanstack/react-query";
import { Kpi, Panel, SourceLink, StateNote } from "../parts";
import { Skeleton } from "./bits";
import { MoneyByYearChart, RecsByYearChart, ReportsByYearChart } from "./OversightCharts";
import { ReportRow } from "./IgReports";
import { agencyOversightQuery } from "./queries";
import { fmtInt, fmtDate, NOT_RECORDED } from "./oversightView";

const SOURCE = "https://www.oversight.gov/reports/federal";

/**
 * Inspector General reports for one agency (/agencies/<Federal Register agency id>): the reports its own Office of Inspector
 * General lists on Oversight.gov, matched to the agency record by an exact name key (an OIG with no exact match is not
 * shown on any agency page). Reports per year, recommendations the OIG states, and dollar findings where the OIG's own report
 * pages state them. Renders nothing for an agency with no matched OIG.
 */
export function AgencyOversightPanel({
  agencyId,
  className = "",
}: {
  agencyId: string;
  className?: string;
}) {
  const q = useQuery(agencyOversightQuery(agencyId));
  if (q.isLoading)
    return (
      <div className={className}>
        <Skeleton label="Loading Inspector General reports" className="h-28" />
      </div>
    );
  if (q.isError)
    return (
      <div className={className}>
        <StateNote
          tone="error"
          action={
            <button
              type="button"
              onClick={() => void q.refetch()}
              className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Retry
            </button>
          }
        >
          Inspector General reports could not be loaded.
        </StateNote>
      </div>
    );
  const d = q.data;
  if (!d || !d.trend) return null;
  const t = d.trend;
  return (
    <section className={`min-w-0 space-y-2 ${className}`} aria-label="Inspector General reports">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-heading font-semibold text-foreground">Inspector General reports</h2>
          <p className="text-xs text-muted-foreground">
            {t.name} on <SourceLink href={SOURCE}>Oversight.gov</SourceLink>, matched to this agency
            by exact name. Figures are the OIG&rsquo;s own, not audited here.
          </p>
        </div>
        <a
          href="/law/enforcement?tab=oversight"
          className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          Browse all Inspector General reports
        </a>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <Kpi label="Reports listed" value={fmtInt(t.totals.reports)} />
        <Kpi
          label="Report dates"
          value={
            t.totals.firstDate && t.totals.lastDate
              ? `${t.totals.firstDate.slice(0, 4)} to ${t.totals.lastDate.slice(0, 4)}`
              : NOT_RECORDED
          }
          note={t.totals.undated ? `${fmtInt(t.totals.undated)} reports have no date` : undefined}
        />
        <Kpi
          label="Recommendations stated"
          value={fmtInt(t.totals.recs)}
          note={`On ${fmtInt(t.totals.recsReports)} of ${fmtInt(t.totals.reports)} reports; as reported`}
        />
      </div>
      <div className="grid items-start gap-2 xl:grid-cols-2">
        <ReportsByYearChart trend={t} title="Reports per year, by type" />
        <RecsByYearChart trend={t} title="Recommendations stated per year" />
        <MoneyByYearChart trend={t} className="xl:col-span-2" />
      </div>
      <Panel
        title="Most recent reports"
        subtitle={`${d.reports.length} of ${d.total != null ? fmtInt(d.total) : NOT_RECORDED} listed`}
        footnote={
          <>
            Each title opens the report page on Oversight.gov. Latest listed report date:{" "}
            {fmtDate(t.totals.lastDate)}.
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-xs">
            <caption className="sr-only">Most recent reports of {t.name}</caption>
            <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Date
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Report
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Submitting OIG
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Type
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Report no.
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Recs
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {d.reports.map((r) => (
                <ReportRow key={r.id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}
