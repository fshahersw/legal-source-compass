/**
 * Litigation lead: federal civil filings and terminations by complete fiscal year in one panel, and the clearance
 * ratio (terminations per 100 filings) in an aligned panel below it with the 100% equal-flows line. Partial years are
 * left out, missing years stay gaps, and the headline uses the latest year that has a ratio.
 */
import { useQuery } from "@tanstack/react-query";
import { nationalQuery } from "@/components/courts/caseload/caseloadQueries";
import { ChartCard } from "@/components/kit/ChartCard";
import { LineTrend } from "@/components/charts/LineTrend";
import { metricFormatter } from "@/components/charts/format";
import { clearanceCallout, clearanceRows } from "./clearanceRate";

const SOURCE = {
  label: "Federal Judicial Center, Integrated Database",
  href: "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present",
};
const counts = metricFormatter("count");
const percent = metricFormatter("percent");
const pts = (v: number) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} points`;

export function ClearanceRateChart() {
  const query = useQuery(nationalQuery);
  const rows = clearanceRows(query.data?.years ?? []).slice(-20);
  const callout = clearanceCallout(rows);
  const axis = {
    keys: rows.map((r) => String(r.fy)),
    label: (k: string) => `FY${k}`,
    tick: (k: string) => k,
  };
  const source = {
    source: SOURCE,
    period: rows.length ? `FY${rows[0]?.fy}–FY${rows.at(-1)?.fy}` : undefined,
    about: (
      <p>
        Terminations divided by filings, times 100, in the same fiscal year (October 1 to September
        30). Above 100% means more cases closed than were filed that year; it is a flow comparison,
        not a measure of backlog or efficiency. The current, unfinished fiscal year is left out and
        missing years stay gaps.
      </p>
    ),
  };
  const title = callout
    ? `FY${callout.fy}: ${percent.full(callout.rate)} civil clearance ratio${
        callout.changePts !== null ? ` (${pts(callout.changePts)} on FY${callout.fy - 1})` : ""
      }`
    : "Civil filings and terminations";

  return (
    <ChartCard
      id="civil-clearance"
      title={title}
      subtitle={
        callout
          ? `Federal civil cases · complete fiscal years · ${callout.yearsAtOrAbove} of ${callout.yearsWithRate} years closed at least as many cases as were filed`
          : "Federal civil cases · complete fiscal years"
      }
      source={source}
      state={
        query.isPending ? "loading" : query.isError ? "error" : !rows.length ? "empty" : "ready"
      }
      onRetry={() => void query.refetch()}
      height={340}
      data={{
        title: "Civil filings, terminations and clearance ratio",
        rows,
        rowKey: (r) => String(r.fy),
        columns: [
          { key: "fy", label: "Fiscal year", value: (r) => r.fy },
          { key: "filings", label: "Filings (cases)", value: (r) => r.filings },
          { key: "terminations", label: "Terminations (cases)", value: (r) => r.terminations },
          {
            key: "rate",
            label: "Clearance (%)",
            value: (r) => (r.rate === null ? null : Math.round(r.rate * 10) / 10),
          },
        ],
        source,
      }}
    >
      <div className="space-y-3">
        <div>
          <p className="text-meta text-muted-foreground">Filings and terminations · cases</p>
          <LineTrend
            axis={axis}
            formatter={counts}
            height={180}
            ariaLabel="Federal civil filings and terminations by fiscal year"
            series={[
              {
                id: "filings",
                label: "Filings",
                points: rows.map((r) => ({ key: String(r.fy), value: r.filings })),
              },
              {
                id: "terminations",
                label: "Terminations",
                points: rows.map((r) => ({ key: String(r.fy), value: r.terminations })),
              },
            ]}
          />
        </div>
        <div className="border-t border-border pt-2">
          <p className="text-meta text-muted-foreground">Clearance ratio · 100% = equal flows</p>
          <LineTrend
            axis={axis}
            formatter={percent}
            height={150}
            ariaLabel="Civil clearance ratio with a 100 percent equal-flows reference"
            colorSlot={(_id, i) => (i === 0 ? 2 : 3)}
            series={[
              {
                id: "clearance",
                label: "Clearance",
                points: rows.map((r) => ({ key: String(r.fy), value: r.rate })),
              },
              {
                id: "reference",
                label: "Equal flows",
                points: rows.map((r) => ({ key: String(r.fy), value: 100 })),
              },
            ]}
          />
        </div>
      </div>
    </ChartCard>
  );
}
