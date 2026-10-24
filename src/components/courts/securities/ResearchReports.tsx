/**
 * "Research reports": figures printed in the securities class action reports of Cornerstone Research (the filings
 * reports with the Stanford Securities Class Action Clearinghouse) and NERA Economic Consulting. Series charts use the
 * latest report that prints each year and list the earlier reports' values that differ; below them every fact of one
 * report is listed with its page and a link to the publisher's PDF.
 */
import { useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import {
  BarTrend,
  ChartFrame,
  ChartLegend,
  LineTrend,
  seriesVar,
  type ChartStatus,
  type TableSpec,
} from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Callout, QueryPanel } from "@/components/courts/collection/CollectionParts";
import { Panel } from "@/components/enforcement/parts";
import { cn } from "@/lib/utils";
import {
  buildSeries,
  CHARTS,
  defaultReport,
  groupReports,
  pageText,
  reportShort,
  shortPublisher,
  trendPoints,
  unitFormatter,
  unitWords,
  yearKeys,
  type ChartId,
  type CraFact,
  type CraReport,
  type SeriesResult,
} from "./craModel";
import {
  FACTS_PAGE,
  getCraChartFacts,
  getCraReportFacts,
  getCraReports,
} from "./craReports.functions";

const STALE = 30 * 60 * 1000;
const link =
  "rounded text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring";

const craReportsQuery = {
  queryKey: ["cra-reports"] as const,
  queryFn: () => getCraReports(),
  staleTime: STALE,
};

export function ResearchReports() {
  const q = useQuery(craReportsQuery);
  return (
    <section id="research-reports" aria-labelledby="research-reports-title" className="space-y-3">
      <div>
        <h2 id="research-reports-title" className="text-base font-semibold leading-6">
          Research reports
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          Figures printed in published securities class action reports, each with its report and
          page.
        </p>
      </div>
      <QueryPanel
        query={q}
        label="Loading research reports"
        errorText="The research report figures could not be loaded."
        emptyText="The research report figures are not published yet. When they are, this section lists every report with the facts printed in it."
        isEmpty={(d) => !d.reports.length}
      >
        {(d) => <Body reports={d.reports} dropped={d.dropped} />}
      </QueryPanel>
    </section>
  );
}

function Body({ reports, dropped }: { reports: CraReport[]; dropped: number }) {
  const byId = useMemo(() => new Map(reports.map((r) => [r.id, r])), [reports]);
  const facts = reports.reduce((n, r) => n + (r.facts ?? 0), 0);
  const publishers = new Set(reports.map((r) => r.publisher)).size;
  return (
    <div className="space-y-4">
      <Callout>
        Values printed in the reports of <strong>Cornerstone Research</strong> (its filings reports
        are published with the{" "}
        <strong>Stanford Law School Securities Class Action Clearinghouse</strong>) and{" "}
        <strong>NERA Economic Consulting</strong>. Each value is read from the text of a
        report&apos;s table or a sentence stating it, never off a chart, and links to that page of
        the publisher&apos;s PDF. Later reports restate earlier years: the charts use the latest
        report for each year and list the earlier values that differ. The publishers define their
        samples differently, so their counts are shown side by side, not reconciled.{" "}
        {reports.length.toLocaleString("en-US")} reports, {facts.toLocaleString("en-US")} facts,{" "}
        {publishers} publishers.
        {dropped ? ` ${dropped} report rows could not be read and are left out.` : ""}
      </Callout>
      <ReportChart
        chart="filings"
        reports={byId}
        title="Securities class action filings per year, as each publisher counts them"
        notes={[
          "Each publisher defines its own sample in its reports, so the two lines differ and are not reconciled.",
          "NERA's counts for 2001–2003 include the IPO allocation (laddering) and analyst cases, which its 2003 report notes affected filing rates in those years.",
          "The Cornerstone Research line is the count of class action filings printed in each report's table of filings by year.",
          "Each year's value comes from the latest report that prints it.",
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ReportChart
          chart="dollarLoss"
          reports={byId}
          title="Disclosure and Maximum Dollar Loss of the year's filings"
          notes={[
            "Disclosure Dollar Loss is the fall in the defendant's market capitalization around the end of the class period; Maximum Dollar Loss is the fall from its class-period peak to just after the class period, as the reports define them.",
            "Drawn in the inflation-adjusted dollars of the latest report; values other reports print in another dollar basis are not mixed into the lines.",
          ]}
        />
        <ReportChart
          chart="cohorts"
          reports={byId}
          title="Share of each year's core federal filings resolved within one, two and three years"
          notes={[
            "A cohort is the core federal filings of one year. Resolved is the report's total of the cohort settled, dismissed or otherwise ended within the window, cumulative.",
            "Dashed segments are cohorts whose window had not ended by the report's data year.",
          ]}
          partialText="Dashed values are incomplete: the window had not ended when the report was written."
        />
        <ReportChart
          chart="settlements"
          reports={byId}
          kind="bar"
          title="Securities class action settlements per year"
          notes={[
            "Number of settlements in the year as Cornerstone Research's settlement reports count them.",
            "A later midyear report can print a restated count for the previous year; that value is the one drawn.",
          ]}
        />
        <ReportChart
          chart="settlementSize"
          reports={byId}
          title="Median and average settlement per year"
          notes={[
            "From the settlement percentiles table of the latest report that prints it, in that report's inflation-adjusted dollars.",
            "The average is pulled up by a few very large settlements; the median is the middle settlement of the year.",
          ]}
        />
        <ReportChart
          chart="accounting"
          reports={byId}
          title="Accounting and non-accounting class action filings per year"
          notes={[
            "Accounting cases are filings with accounting allegations as Cornerstone Research defines them in its accounting reports.",
            "A year with no point is not printed by any report in this set.",
          ]}
        />
        <ReportChart
          chart="sp500"
          reports={byId}
          title="Share of S&P 500 companies sued in core federal filings, per year"
          notes={[
            "The share of S&P 500 companies that were defendants in a core federal filing in the year, as printed in the filings reports.",
          ]}
        />
      </div>
      <ReportFacts reports={reports} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ charts

function chartStatus(
  q: { isLoading: boolean; isError: boolean; refetch: () => unknown },
  drawn: number,
): ChartStatus {
  if (q.isLoading) return { kind: "loading" };
  if (q.isError) return { kind: "error", onRetry: () => void q.refetch() };
  if (!drawn)
    return { kind: "empty", reason: "No report in this set prints these values by year." };
  return { kind: "ready" };
}

function ReportChart({
  chart,
  reports,
  title,
  notes,
  kind = "line",
  partialText,
}: {
  chart: ChartId;
  reports: ReadonlyMap<string, CraReport>;
  title: string;
  notes: string[];
  kind?: "line" | "bar";
  partialText?: string;
}) {
  const q = useQuery({
    queryKey: ["cra-chart", chart],
    queryFn: () => getCraChartFacts({ data: { chart } }),
    staleTime: STALE,
  });
  const results = useMemo(
    () => (q.data ? CHARTS[chart].map((spec) => buildSeries(q.data.facts, reports, spec)) : []),
    [q.data, chart, reports],
  );
  const first = results.find((r) => r.points.length);
  // Lines of one chart share a unit and dollar basis; a line printed in another one is not drawn beside them.
  const drawn = results.filter(
    (r) => r.points.length && first && r.unit === first.unit && r.basis === first.basis,
  );
  const mismatched = results.filter((r) => r.points.length).length - drawn.length;
  const keys = yearKeys(drawn);
  const unit = first?.unit ?? "";
  const formatter = unitFormatter(unit);
  const countUnit = unit === "percent" || unit.startsWith("usd") ? undefined : unit;
  const axis = { keys, label: (k: string) => k, tick: (k: string) => k };
  const series = drawn.map((r) => ({ id: r.spec.id, label: r.spec.label, points: trendPoints(r) }));
  const used = uniqueReports(drawn);
  const shown = used.slice(0, Math.max(3, drawn.length));
  const partial = drawn.some((r) => r.points.some((p) => p.partial));
  const otherBasis = drawn.reduce((n, r) => n + r.otherBasis, 0);
  const footnotes = [
    used.length > shown.length
      ? `Values for some years come from ${used.length - shown.length} earlier report${used.length - shown.length === 1 ? "" : "s"}; Show data names the report and page of every value.`
      : null,
    otherBasis
      ? `${otherBasis} value${otherBasis === 1 ? "" : "s"} other reports print in another dollar basis or unit ${otherBasis === 1 ? "is" : "are"} not drawn; ${otherBasis === 1 ? "it is" : "they are"} in each report's facts below.`
      : null,
    mismatched ? "A line printed in another unit or dollar basis is left out of this chart." : null,
    q.data?.dropped ? `${q.data.dropped} rows could not be read and are left out.` : null,
  ].filter((x): x is string => !!x);
  const status = chartStatus(q, drawn.length);
  const ariaLabel = `${kind === "bar" ? "Bar" : "Line"} chart: ${title}, ${keys[0] ?? ""}–${keys.at(-1) ?? ""}.`;
  return (
    <ChartFrame
      title={title}
      unit={first ? unitWords(unit, first.basis) : undefined}
      period={keys.length ? `${keys[0]}–${keys.at(-1)}` : undefined}
      sources={shown.flatMap((r) => (r.pdfUrl ? [{ label: reportShort(r), url: r.pdfUrl }] : []))}
      status={status}
      partialNotice={
        q.data?.truncated
          ? "Not every value could be loaded; the lines may be incomplete."
          : partial
            ? (partialText ?? "Values marked * are for an incomplete period.")
            : undefined
      }
      notes={notes}
      footnotes={footnotes}
      table={drawn.length ? chartTable(title, keys, drawn, formatter) : undefined}
      minHeight={200}
    >
      {drawn.length > 1 ? (
        <ChartLegend
          items={drawn.map((r, i) => ({ id: r.spec.id, label: r.spec.label, color: seriesVar(i) }))}
        />
      ) : null}
      {kind === "bar" ? (
        <BarTrend
          series={series}
          axis={axis}
          formatter={formatter}
          unit={countUnit}
          ariaLabel={ariaLabel}
        />
      ) : (
        <LineTrend
          series={series}
          axis={axis}
          formatter={formatter}
          unit={countUnit}
          ariaLabel={ariaLabel}
          directLabels={false}
        />
      )}
      <Restated results={drawn} formatter={formatter} />
    </ChartFrame>
  );
}

/** Reports behind the drawn lines: the latest report of each line first, then the earlier ones. */
function uniqueReports(results: readonly SeriesResult[]): CraReport[] {
  const out = new Map<string, CraReport>();
  const ordered = [
    ...results.flatMap((r) => r.reports.slice(0, 1)),
    ...results.flatMap((r) => r.reports.slice(1)),
  ];
  for (const rep of ordered) if (!out.has(rep.id)) out.set(rep.id, rep);
  return [...out.values()];
}

function PageLink({ fact, children }: { fact: CraFact; children: ReactNode }) {
  if (!fact.sourceUrl) return <>{children}</>;
  return (
    <a href={fact.sourceUrl} target="_blank" rel="noreferrer" className={link}>
      {children}
    </a>
  );
}

function chartTable(
  title: string,
  keys: readonly string[],
  results: readonly SeriesResult[],
  formatter: ReturnType<typeof unitFormatter>,
): TableSpec {
  const multi = results.length > 1;
  const at = results.map((r) => new Map(r.points.map((p) => [p.period, p])));
  return {
    caption: title,
    columns: [
      { label: "Year" },
      ...results.flatMap((r) => [
        { label: multi ? r.spec.label : "Value", align: "right" as const },
        {
          label: r.reports[0]
            ? `Printed in (${shortPublisher(r.reports[0].publisher)})`
            : "Printed in",
          align: "left" as const,
        },
      ]),
    ],
    rows: keys.map((k) => ({
      key: k,
      cells: [
        `${k}${at.some((m) => m.get(k)?.partial) ? "*" : ""}`,
        ...at.flatMap((m) => {
          const p = m.get(k);
          if (!p) return ["Not recorded", "Not recorded"];
          return [
            formatter.full(p.value),
            <PageLink key="l" fact={p.fact}>
              {p.report.edition}, {pageText(p.fact)}
            </PageLink>,
          ];
        }),
      ],
    })),
  };
}

function Restated({
  results,
  formatter,
}: {
  results: readonly SeriesResult[];
  formatter: ReturnType<typeof unitFormatter>;
}) {
  const multi = results.length > 1;
  const all = results.flatMap((r) => r.restated.map((x) => ({ line: r.spec.label, x })));
  if (!all.length) return null;
  return (
    <details className="mt-1 text-[11px] leading-4 text-muted-foreground">
      <summary className="cursor-pointer select-none text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        Earlier reports printed {all.length} of these values differently
      </summary>
      <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto pl-4">
        {all.map(({ line, x }) => (
          <li key={`${line}-${x.period}`} className="list-disc">
            <span className="text-foreground">
              {x.period}
              {multi ? `, ${line}` : ""}:
            </span>{" "}
            {formatter.full(x.latest.value)} in{" "}
            <PageLink fact={x.latest.fact}>{x.latest.report.edition}</PageLink> (drawn);{" "}
            {x.earlier.map((e, i) => (
              <span key={e.fact.id}>
                {i ? "; " : ""}
                {formatter.full(e.value)} in <PageLink fact={e.fact}>{e.report.edition}</PageLink>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ------------------------------------------------------------------------------------------------ facts per report

function ReportFacts({ reports }: { reports: CraReport[] }) {
  const groups = useMemo(() => groupReports(reports), [reports]);
  const [id, setId] = useState(() => defaultReport(reports)?.id ?? reports[0]?.id ?? "");
  const [offset, setOffset] = useState(0);
  const report = reports.find((r) => r.id === id) ?? null;
  const hasFacts = (report?.facts ?? 0) > 0;
  const q = useQuery({
    queryKey: ["cra-report-facts", id, offset],
    queryFn: () => getCraReportFacts({ data: { report: id, offset } }),
    enabled: !!report && hasFacts,
    placeholderData: keepPreviousData,
    staleTime: STALE,
  });
  const total = q.data?.report === id ? (q.data.total ?? null) : null;
  const rows = q.data?.report === id ? q.data.facts : [];
  const end = offset + rows.length;
  const pick = (
    <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-muted-foreground">
      Report
      <select
        value={id}
        onChange={(e) => {
          setId(e.target.value);
          setOffset(0);
        }}
        className="h-8 w-full max-w-[22rem] rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {groups.map((g) => (
          <optgroup key={g.family} label={g.label}>
            {g.reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} ({(r.facts ?? 0).toLocaleString("en-US")} facts)
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
  return (
    <Panel
      id="research-report-facts"
      title="Facts printed in each report"
      subtitle="Every value taken from the selected report, with the table or sentence and the page it is printed on."
      actions={pick}
    >
      {report ? <ReportHead report={report} /> : null}
      {!report ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">Choose a report.</p>
      ) : !hasFacts ? (
        <p role="status" className="px-3 py-4 text-xs leading-5 text-muted-foreground">
          No facts were taken from this report: {report.status ?? "Not recorded"}.
        </p>
      ) : q.isError ? (
        <div role="alert" className="space-y-2 px-3 py-4 text-xs">
          <p className="text-destructive">The facts of this report could not be loaded.</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void q.refetch()}>
            Retry
          </Button>
        </div>
      ) : !q.data || q.data.report !== id ? (
        <p role="status" aria-busy className="px-3 py-4 text-xs text-muted-foreground">
          Loading the facts of this report…
        </p>
      ) : (
        <>
          <FactsTable report={report} facts={rows} busy={q.isFetching} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
            <p aria-live="polite">
              {rows.length
                ? `Facts ${(offset + 1).toLocaleString("en-US")}–${end.toLocaleString("en-US")}${total != null ? ` of ${total.toLocaleString("en-US")}` : ""}`
                : "No facts on this page."}
              {q.data.dropped ? ` · ${q.data.dropped} rows could not be read and are left out` : ""}
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={offset === 0 || q.isFetching}
                onClick={() => setOffset(Math.max(0, offset - FACTS_PAGE))}
              >
                <ChevronLeft className="size-3" aria-hidden />
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={q.isFetching || total == null || end >= total}
                onClick={() => setOffset(offset + FACTS_PAGE)}
              >
                Next
                <ChevronRight className="size-3" aria-hidden />
              </Button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function ReportHead({ report }: { report: CraReport }) {
  return (
    <div className="space-y-0.5 border-b border-border/60 px-3 py-2 text-xs leading-5">
      <p>
        <span className="text-muted-foreground">Source of every fact below: </span>
        <strong className="font-medium">{report.publisher}</strong>, {report.title}
      </p>
      <p className="text-muted-foreground">
        {report.date ? `Dated ${report.date}` : "Date not recorded"}
        {report.date && report.dateBasis ? ` (${report.dateBasis})` : ""}
        {report.pages != null ? ` · ${report.pages} pages` : ""}
        {report.pdfUrl ? (
          <>
            {" · "}
            <a
              href={report.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(link, "inline-flex items-center gap-0.5")}
            >
              Publisher&apos;s PDF
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </>
        ) : null}
        {report.landingUrl ? (
          <>
            {" · "}
            <a
              href={report.landingUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(link, "inline-flex items-center gap-0.5")}
            >
              Report page
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}

function periodText(f: CraFact): string {
  return [f.period, f.aggregate || null, f.partial ? "incomplete period" : null]
    .filter(Boolean)
    .join(" · ");
}

function FactsTable({
  report,
  facts,
  busy,
}: {
  report: CraReport;
  facts: CraFact[];
  busy: boolean;
}) {
  return (
    <div
      role="region"
      aria-label={`Facts printed in ${report.title}`}
      tabIndex={0}
      className={cn(
        "max-h-[28rem] overflow-auto focus-visible:outline-2 focus-visible:outline-ring",
        busy && "opacity-70",
      )}
    >
      <table className="w-full min-w-[46rem] border-collapse text-[11px]">
        <caption className="sr-only">
          Facts printed in {report.title}, by {report.publisher}
        </caption>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-border text-left text-muted-foreground">
            <th scope="col" className="px-3 py-1 font-medium">
              Measure
            </th>
            <th scope="col" className="px-3 py-1 font-medium">
              Breakdown
            </th>
            <th scope="col" className="px-3 py-1 font-medium">
              Period
            </th>
            <th scope="col" className="px-3 py-1 text-right font-medium">
              Value as printed
            </th>
            <th scope="col" className="px-3 py-1 font-medium">
              Unit
            </th>
            <th scope="col" className="px-3 py-1 font-medium">
              Printed in
            </th>
            <th scope="col" className="px-3 py-1 font-medium">
              Page
            </th>
          </tr>
        </thead>
        <tbody>
          {facts.map((f) => (
            <tr key={f.id} className="border-b border-border/50 align-top last:border-0">
              <th scope="row" className="px-3 py-0.5 text-left font-normal">
                {f.seriesLabel}
              </th>
              <td className="px-3 py-0.5 text-muted-foreground">
                {[f.dimension, f.scope].filter(Boolean).join(" · ") || "None"}
              </td>
              <td className="px-3 py-0.5 tabular-nums">{periodText(f)}</td>
              <td className="px-3 py-0.5 text-right tabular-nums">{f.valueText}</td>
              <td className="px-3 py-0.5 text-muted-foreground">{unitWords(f.unit, f.basis)}</td>
              <td className="px-3 py-0.5 text-muted-foreground">
                {f.method === "text" ? "Stated in the text" : f.table || "Not recorded"}
              </td>
              <td className="whitespace-nowrap px-3 py-0.5">
                <PageLink fact={f}>{pageText(f)}</PageLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
