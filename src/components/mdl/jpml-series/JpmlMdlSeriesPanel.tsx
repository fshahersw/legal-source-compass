/**
 * One MDL across every held JPML monthly pending-MDL report (since July 2012): actions now pending (or total actions)
 * over time, actions added between consecutive monthly reports, and the title, transferee district and judge exactly
 * as each report printed them. Joined by exact MDL number only.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarTrend,
  ChartFrame,
  LineTrend,
  metricFormatter,
  type ChartStatus,
  type TableSpec,
} from "@/components/charts";
import { SegmentedControl } from "@/components/matters/common";
import {
  JPML_PAGES,
  fmtInt,
  fmtSigned,
  longDate,
  monthKeys,
  monthLabel,
  monthlyAxis,
  monthlySeries,
  type MdlSeries,
} from "./model";
import { jpmlMdlSeriesQuery } from "./queries";

const count = metricFormatter("count");

export function JpmlMdlSeriesPanel({ mdl }: { mdl: number }) {
  const q = useQuery(jpmlMdlSeriesQuery(mdl));
  const [field, setField] = useState<"pending" | "total">("pending");
  const data = q.data ?? null;
  const status: ChartStatus = q.isLoading
    ? { kind: "loading" }
    : q.isError
      ? { kind: "error", onRetry: () => void q.refetch() }
      : !data
        ? {
            kind: "empty",
            reason: `No held JPML monthly pending-MDL report (July 2012 to the latest month) lists MDL ${mdl}.`,
          }
        : !data.points.length
          ? {
              kind: "empty",
              reason: `MDL ${mdl} appears only in quarter-end reports; see the table below.`,
            }
          : { kind: "ready" };
  const view = useMemo(() => (data && data.points.length ? build(data) : null), [data]);
  const fieldLabel = field === "pending" ? "Actions now pending" : "Total actions (historical)";
  return (
    <section aria-labelledby={`jpml-mdl-${mdl}-heading`} className="mt-4 space-y-3">
      <header className="space-y-1">
        <h2 id={`jpml-mdl-${mdl}-heading`} className="text-base font-semibold">
          MDL {mdl} in the JPML pending-MDL reports
        </h2>
        {data ? <Summary data={data} /> : null}
      </header>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartFrame
          title={`${fieldLabel} in MDL ${mdl}, per JPML monthly report`}
          unit="actions"
          period={view?.period}
          sources={[
            { label: "JPML pending MDL reports", url: JPML_PAGES.archive },
            ...(data?.sourceUrl
              ? [{ label: `Latest report listing MDL ${mdl} (PDF)`, url: data.sourceUrl }]
              : []),
          ]}
          status={status}
          actions={
            <SegmentedControl
              label="Value shown"
              value={field}
              options={[
                { value: "pending", label: "Pending" },
                { value: "total", label: "Total (historical)" },
              ]}
              onChange={setField}
            />
          }
          notes={[
            "'Actions Now Pending' and 'Total Actions (Historical)' as printed for this MDL in each report. Months with no held report, or reports that do not list the MDL, are gaps.",
            "Total actions only grows unless the Panel lowers its historical count; pending falls as actions are closed or remanded.",
          ]}
          footnotes={view?.footnotes}
          table={view?.table}
          minHeight={220}
        >
          {view ? (
            <LineTrend
              series={[field === "pending" ? view.pending : view.total]}
              axis={view.axis}
              formatter={count}
              unit="actions"
              ariaLabel={`${fieldLabel} in MDL ${mdl} per JPML monthly report`}
              height={220}
            />
          ) : null}
        </ChartFrame>
        <ChartFrame
          title={`Actions added to MDL ${mdl} between consecutive monthly reports`}
          unit="actions"
          period={view?.period}
          sources={[{ label: "JPML pending MDL reports", url: JPML_PAGES.archive }]}
          status={
            view && !view.hasAdded
              ? { kind: "empty", reason: "No two consecutive monthly reports list this MDL." }
              : status
          }
          notes={[
            "Change in the printed 'Total Actions (Historical)' between reports one calendar month apart that both list the MDL. A negative bar means the Panel lowered the historical count.",
          ]}
          table={view?.addedTable}
          minHeight={200}
        >
          {view?.hasAdded ? (
            <BarTrend
              series={[view.added]}
              axis={view.axis}
              formatter={count}
              unit="actions"
              ariaLabel={`Actions added to MDL ${mdl} between consecutive JPML monthly reports`}
              height={200}
            />
          ) : null}
        </ChartFrame>
      </div>
      {data ? <AsPrinted data={data} /> : null}
    </section>
  );
}

function Summary({ data }: { data: MdlSeries }) {
  const latest = data.points[data.points.length - 1] ?? data.quarterEnd[data.quarterEnd.length - 1];
  const facts: [string, string][] = [
    [
      "Latest report listing it",
      latest
        ? `${longDate(latest.date)} · ${fmtInt(latest.pending)} pending of ${fmtInt(latest.total)} total`
        : "Not recorded",
    ],
    [
      "In the latest monthly report",
      data.status === "in_latest_monthly_report"
        ? "Yes"
        : `No (latest report ${data.latestMonthlyReport ? longDate(data.latestMonthlyReport) : "Not recorded"})`,
    ],
    [
      "Peak pending among held reports",
      data.peak ? `${fmtInt(data.peak.value)} (${longDate(data.peak.date)})` : "Not recorded",
    ],
    [
      "Reports listing it",
      `${data.reportsListed} of ${data.reportsInSpan} held monthly reports between ${data.firstListed ? longDate(data.firstListed) : "—"} and ${data.lastListed ? longDate(data.lastListed) : "—"}`,
    ],
    [
      "Months since transfer at the latest report",
      data.monthsSinceTransfer === null
        ? "Not recorded (no held listing prints the transfer date)"
        : `${data.monthsSinceTransfer} (transferred ${data.dateTransferred ? longDate(data.dateTransferred) : "—"})`,
    ],
    [
      "Actions added, one-month intervals",
      data.added
        ? `${fmtInt(data.added.added)} over ${data.added.intervals} intervals${data.added.decreases ? `; historical count lowered in ${data.added.decreases}` : ""}`
        : "Not recorded",
    ],
  ];
  return (
    <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 xl:grid-cols-3">
      {facts.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function AsPrinted({ data }: { data: MdlSeries }) {
  const runs = [
    ...data.titleRuns.map((r) => ({ kind: "Title", ...r })),
    ...data.districtRuns.map((r) => ({ kind: "Transferee district", ...r })),
    ...data.judgeRuns.map((r) => ({ kind: "Transferee judge(s)", ...r })),
  ];
  return (
    <section
      aria-labelledby={`jpml-mdl-${data.mdl}-printed`}
      className="rounded-md border border-border bg-surface"
    >
      <h3
        id={`jpml-mdl-${data.mdl}-printed`}
        className="border-b border-border/70 px-3 py-2 text-sm font-semibold"
      >
        As printed in the reports
      </h3>
      <div className="max-h-72 overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <caption className="sr-only">
            Title, transferee district and judges as each JPML report printed them
          </caption>
          <thead className="sticky top-0 bg-surface text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-3 py-1 text-left font-medium">
                Field
              </th>
              <th scope="col" className="px-3 py-1 text-left font-medium">
                As printed
              </th>
              <th scope="col" className="px-3 py-1 text-left font-medium">
                Reports
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={`${r.kind}-${i}`} className="border-b border-border/50 align-top">
                <td className="px-3 py-1 text-muted-foreground">{r.kind}</td>
                <td className="px-3 py-1">{r.value || "None printed"}</td>
                <td className="px-3 py-1 tabular-nums sm:whitespace-nowrap">
                  {longDate(r.from)}
                  {r.to !== r.from ? ` – ${longDate(r.to)}` : ""} ({r.reports})
                </td>
              </tr>
            ))}
            {data.quarterEnd.map((p) => (
              <tr key={`q-${p.date}`} className="border-b border-border/50 align-top">
                <td className="px-3 py-1 text-muted-foreground">Quarter-end report</td>
                <td className="px-3 py-1">
                  {fmtInt(p.pending)} pending of {fmtInt(p.total)} total ·{" "}
                  {p.district ?? "Not recorded"}
                  {p.circuit ? ` · ${p.circuit} Circuit` : ""}
                </td>
                <td className="px-3 py-1 tabular-nums sm:whitespace-nowrap">{longDate(p.date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border/70 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
        Joined by exact MDL number only; a title change under the same number is kept as printed.
        Names are not linked to person profiles.{" "}
        <Link
          to="/records/$dataset/$id"
          params={{ dataset: "jpml_mdl_pending_series", id: `mdl:${data.mdl}` }}
          className="text-primary underline-offset-2 hover:underline"
        >
          Full record
        </Link>
      </p>
    </section>
  );
}

function build(d: MdlSeries) {
  const first = d.points[0]!.date;
  const last =
    d.latestMonthlyReport && d.latestMonthlyReport > d.points[d.points.length - 1]!.date
      ? d.latestMonthlyReport
      : d.points[d.points.length - 1]!.date;
  const axis = monthlyAxis(monthKeys(first, last));
  const pending = monthlySeries("pending", "Actions now pending", d.points, (p) => p.pending);
  const total = monthlySeries("total", "Total actions (historical)", d.points, (p) => p.total);
  const adjacent = d.changes.filter((c) => c.monthsApart === 1);
  const added = {
    id: "added",
    label: "Actions added",
    points: adjacent.map((c) => ({ key: c.to.slice(0, 7), value: c.totalChange })),
  };
  const table: TableSpec = {
    caption: `MDL ${d.mdl} per JPML monthly report`,
    columns: [
      { label: "Report date" },
      { label: "Pending", align: "right" },
      { label: "Total (historical)", align: "right" },
      { label: "District" },
      { label: "Judge(s)" },
    ],
    rows: [...d.points].reverse().map((p) => ({
      key: p.date,
      cells: [
        longDate(p.date),
        fmtInt(p.pending),
        fmtInt(p.total),
        p.district ?? "Not recorded",
        p.judges.join(" / ") || "None printed",
      ],
    })),
  };
  const addedTable: TableSpec = {
    caption: `Actions added to MDL ${d.mdl} between consecutive monthly reports`,
    columns: [
      { label: "From" },
      { label: "To" },
      { label: "Months apart", align: "right" },
      { label: "Total actions change", align: "right" },
      { label: "Pending change", align: "right" },
    ],
    rows: [...d.changes].reverse().map((c) => ({
      key: `${c.from}-${c.to}`,
      muted: c.monthsApart !== 1,
      cells: [
        longDate(c.from),
        longDate(c.to),
        String(c.monthsApart),
        fmtSigned(c.totalChange),
        fmtSigned(c.pendingChange),
      ],
    })),
  };
  const footnotes = d.absent.length
    ? [
        `Not listed in ${d.absent.length} held report${d.absent.length === 1 ? "" : "s"} inside its span: ${d.absent.slice(0, 6).map(longDate).join(", ")}${d.absent.length > 6 ? ", …" : ""}.`,
      ]
    : undefined;
  return {
    axis,
    pending,
    total,
    added,
    hasAdded: adjacent.some((c) => c.totalChange !== null),
    table,
    addedTable,
    footnotes,
    period: `${monthLabel(first.slice(0, 7))} – ${monthLabel(last.slice(0, 7))}`,
  };
}
