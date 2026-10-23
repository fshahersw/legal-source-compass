import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { OversightReport } from "@/lib/external/oversight.functions";
import { Kpi, Panel, SourceLink, StateNote } from "../parts";
import { FilterSelect, Pager, RetryButton, SearchBox, Skeleton } from "./bits";
import { useDebounced } from "./useDebounced";
import { ReportsByYearChart } from "./OversightCharts";
import { oversightMetaQuery, oversightOverviewQuery, oversightSearchQuery } from "./queries";
import { coverageLine, fmtDate, fmtInt, NOT_RECORDED, recsLabel } from "./oversightView";

const SOURCE = "https://www.oversight.gov/reports/federal";

/**
 * Public reports of the federal Offices of Inspector General, from Oversight.gov (CIGIE). Search and filters read the stored
 * listing; each report links to its Oversight.gov page (opened in the source panel). Recommendation counts are the OIG's own,
 * and a report that states none shows Not recorded.
 */
export function IgReports({ presetOig = "" }: { presetOig?: string }) {
  const meta = useQuery(oversightMetaQuery);
  const overview = useQuery(oversightOverviewQuery);
  const [text, setText] = useState("");
  const [oig, setOig] = useState(presetOig);
  const [type, setType] = useState("");
  const [year, setYear] = useState("");
  const [page, setPage] = useState(0);
  const q = useDebounced(text.trim(), 350);
  useEffect(() => setPage(0), [q, oig, type, year]);
  useEffect(() => {
    if (presetOig) setOig(presetOig);
  }, [presetOig]);
  const results = useQuery(oversightSearchQuery({ q, oig, type, year, page }));
  const trend = overview.data ?? null;
  const dataset = meta.data?.["oversight_reports"];
  const oigOptions = useMemo(
    () =>
      (trend?.oigs ?? []).map((o) => ({
        value: o.name,
        label: `${o.name} (${fmtInt(o.reports)})`,
      })),
    [trend],
  );
  const filtered = Boolean(q || oig || type || year);
  const clear = () => {
    setText("");
    setOig("");
    setType("");
    setYear("");
  };

  if (overview.isLoading)
    return <Skeleton label="Loading Inspector General reports" className="h-72" />;
  if (overview.isError)
    return (
      <StateNote tone="error" action={<RetryButton onRetry={() => void overview.refetch()} />}>
        Inspector General reports could not be loaded.
      </StateNote>
    );
  if (!trend)
    return (
      <StateNote>
        Inspector General reports are not published in this workspace yet. They are the public
        reports listed on <SourceLink href={SOURCE}>Oversight.gov</SourceLink>.
      </StateNote>
    );
  const t = trend.totals;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi
          label="Reports listed"
          value={fmtInt(t.reports)}
          note="Public reports on Oversight.gov"
        />
        <Kpi
          label="Offices of Inspector General"
          value={fmtInt(trend.oigs.length)}
          note="With at least one listed report"
        />
        <Kpi
          label="Report dates"
          value={
            t.firstDate && t.lastDate
              ? `${t.firstDate.slice(0, 4)} to ${t.lastDate.slice(0, 4)}`
              : NOT_RECORDED
          }
          note={
            t.undated ? `${fmtInt(t.undated)} reports have no date` : "Every listed report is dated"
          }
        />
        <Kpi
          label="Recommendations stated"
          value={fmtInt(t.recs)}
          note={`Stated on ${fmtInt(t.recsReports)} of ${fmtInt(t.reports)} reports; as reported`}
        />
      </div>
      <ReportsByYearChart
        trend={trend}
        title="Public Inspector General reports by year and type"
        tall
      />
      <Panel
        title="Reports"
        subtitle={coverageLine(trend)}
        footnote={
          <>
            Source: <SourceLink href={SOURCE}>Oversight.gov</SourceLink>, the Council of the
            Inspectors General on Integrity and Efficiency; every field is the listing&rsquo;s own
            and an empty one shows Not recorded. Descriptions are the OIG&rsquo;s summaries and may
            be shortened here.
            {dataset?.coverage ? ` ${dataset.coverage}.` : ""}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
          <SearchBox
            value={text}
            onChange={setText}
            label="Search Inspector General reports"
            placeholder="Title, report number, OIG or description"
          />
          <FilterSelect
            label="OIG"
            value={oig}
            onChange={setOig}
            options={oigOptions}
            className="w-52"
          />
          <FilterSelect
            label="Type"
            value={type}
            onChange={setType}
            options={dataset?.filters["type"] ?? []}
          />
          <FilterSelect
            label="Year"
            value={year}
            onChange={setYear}
            options={dataset?.filters["year"] ?? []}
          />
          {filtered ? (
            <button
              type="button"
              onClick={clear}
              className="rounded text-xs text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Clear filters
            </button>
          ) : null}
        </div>
        {results.isError ? (
          <div className="p-3">
            <StateNote tone="error" action={<RetryButton onRetry={() => void results.refetch()} />}>
              The report list could not be loaded.
            </StateNote>
          </div>
        ) : !results.data ? (
          <div className="p-3">
            <Skeleton label="Loading reports" />
          </div>
        ) : results.data.reports.length === 0 ? (
          <div className="p-3">
            <StateNote>
              No listed report matches {filtered ? "these filters" : "the search"}. Absence here is
              not proof that no report exists: Oversight.gov lists what each OIG chooses to post.
            </StateNote>
          </div>
        ) : (
          <div aria-busy={results.isFetching}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-xs">
                <caption className="sr-only">Inspector General reports, newest first</caption>
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
                  {results.data.reports.map((r) => (
                    <ReportRow key={r.id} r={r} />
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={page}
              pageSize={results.data.pageSize}
              shown={results.data.reports.length}
              total={results.data.total}
              onPage={setPage}
              busy={results.isFetching}
              noun="reports"
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

export function ReportRow({ r }: { r: OversightReport }) {
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-3 py-1.5 font-mono">{fmtDate(r.date)}</td>
      <td className="max-w-[28rem] px-2 py-1.5">
        <a
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {r.title}
        </a>
        {r.description ? (
          <p
            className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground"
            title={r.description}
          >
            {r.description}
          </p>
        ) : null}
        {r.dojOigId ? (
          <Link
            to="/records/$dataset/$id"
            params={{ dataset: "doj_oig_reports", id: r.dojOigId }}
            className="mt-0.5 inline-block text-[11px] text-primary hover:underline"
          >
            DOJ OIG record (component, PDF)
          </Link>
        ) : null}
      </td>
      <td className="px-2 py-1.5">{r.oig ?? NOT_RECORDED}</td>
      <td className="whitespace-nowrap px-2 py-1.5">{r.type ?? NOT_RECORDED}</td>
      <td className="whitespace-nowrap px-2 py-1.5 font-mono">{r.reportNumber ?? NOT_RECORDED}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono">
        {recsLabel(r.recommendations)}
      </td>
    </tr>
  );
}
