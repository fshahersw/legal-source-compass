import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HowToRead, type Measure } from "@/components/analysis/HowToRead";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import type { BdOverview } from "@/lib/external/regulatoryRecords.functions";
import { axisTick, LoadingBlock, Panel, SourceLink, StateNote, tooltipStyle } from "../parts";
import {
  adviserCountSeries,
  bdAxis,
  bdMonthlySeries,
  firstNonZeroYear,
  fmtInt,
  monthLabel,
  raumSeries,
  registrationTrendsQuery,
} from "./regulatoryView";

const BD_PAGE =
  "https://www.sec.gov/foia/frequently-requested-documents/company-information-about-active-broker-dealers";
const IA_STATS_PAGE =
  "https://www.sec.gov/data-research/statistics-data-visualizations/investment-adviser-statistics";

const MEASURES: Measure[] = [
  {
    term: "Active broker-dealers",
    means:
      "Rows in the SEC's monthly 'Company Information About Active Broker-Dealers' file (one row per CIK), for the month named on the SEC page.",
    caveat:
      "Months with no file on the SEC page are drawn as gaps, never as zero. The list is a snapshot of firms the SEC shows as active, not a count of registrations or branches.",
  },
  {
    term: "Registered and exempt reporting advisers",
    means:
      "SEC Division of Investment Management Tab.1.1 subtotals from Form ADV filings, one value per reporting year.",
    caveat:
      "Exempt reporting advisers are drawn from the first year the table publishes a value above 0; the table publishes 0 for earlier years.",
  },
  {
    term: "Regulatory assets under management",
    means:
      "Tab.2.1 total: the aggregate Form ADV Item 5.F.(2) regulatory assets under management reported by SEC-registered advisers, in trillions of U.S. dollars.",
    caveat:
      "As reported by the advisers; not audited or adjusted. A figure is the sum of what advisers reported for that year.",
  },
];

function ChartCard({
  title,
  subtitle,
  source,
  children,
  table,
}: {
  title: string;
  subtitle: string;
  source: ReactNode;
  children: ReactNode;
  table: ReactNode;
}) {
  return (
    <Panel title={title} subtitle={subtitle} footnote={source}>
      <div className="h-56 px-1 pb-1 pt-2">{children}</div>
      <details className="border-t border-border/60">
        <summary className="cursor-pointer list-none px-3 py-1.5 text-xs font-medium hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          Show data
        </summary>
        <div className="max-h-60 overflow-auto px-2 pb-2">{table}</div>
      </details>
    </Panel>
  );
}

function bdTicks(overview: BdOverview): string[] {
  const out: string[] = [];
  for (const p of bdMonthlySeries(overview)) {
    const [y, m] = p.month.split("-");
    if (m === "01" && Number(y) % 3 === 0) out.push(p.month);
  }
  return out;
}

function BrokerDealerChart({ overview }: { overview: BdOverview }) {
  const rows = useMemo(() => bdMonthlySeries(overview), [overview]);
  const axis = useMemo(() => bdAxis(rows), [rows]);
  const gaps = overview.missingMonths;
  return (
    <ChartCard
      title="Active broker-dealers on the SEC list, by month"
      subtitle={`Rows in each monthly file, ${monthLabel(overview.firstMonth)} to ${monthLabel(overview.latestMonth)} · ${fmtInt(overview.files)} files`}
      source={
        <>
          Source:{" "}
          <SourceLink href={BD_PAGE}>
            SEC, Company Information About Active Broker-Dealers
          </SourceLink>
          . Unit: broker-dealers (rows) per monthly file. The vertical axis starts at{" "}
          {fmtInt(axis.lo)}, not zero.{" "}
          {gaps.length
            ? `No file is listed for ${gaps.length} months (${gaps.map(monthLabel).join(", ")}); they are gaps in the line.`
            : "Every month has a file."}
        </>
      }
      table={
        <table className="w-full text-xs">
          <caption className="sr-only">Active broker-dealers per monthly SEC file</caption>
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-1 font-medium">
                Month
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                Broker-dealers listed
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60 font-mono">
            {[...rows].reverse().map((r) => (
              <tr key={r.month}>
                <th scope="row" className="px-2 py-0.5 text-left font-medium">
                  {monthLabel(r.month)}
                </th>
                <td className="px-2 py-0.5 text-right">
                  {r.count == null ? (
                    <span className="font-sans text-muted-foreground">Not recorded (no file)</span>
                  ) : (
                    fmtInt(r.count)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            ticks={bdTicks(overview)}
            tickFormatter={(m: string) => m.slice(0, 4)}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            width={44}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            domain={[axis.lo, axis.hi]}
            ticks={axis.ticks}
            tickFormatter={(v: number) => fmtInt(v)}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v) => [Number(v).toLocaleString("en-US"), "Broker-dealers"]}
            labelFormatter={(l) => monthLabel(String(l))}
          />
          <Line
            dataKey="count"
            name="Broker-dealers"
            stroke={FDA_COLORS[0]}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function SecRegistrationTrends({ className }: { className?: string }) {
  const q = useQuery(registrationTrendsQuery);
  const d = q.data;
  const counts = useMemo(() => adviserCountSeries(d?.advisersByYear ?? null), [d]);
  const raum = useMemo(() => raumSeries(d?.raumByYear ?? null), [d]);
  const eraStart = firstNonZeroYear(counts.era);
  const adviserRows = useMemo(() => {
    if (!counts.ria) return [];
    return counts.ria.map((p, i) => {
      const era = counts.era?.[i]?.value ?? null;
      return {
        year: String(p.year),
        ria: p.value,
        era: eraStart != null && p.year >= eraStart ? era : null,
      };
    });
  }, [counts, eraStart]);
  if (q.isLoading)
    return (
      <div className={className}>
        <LoadingBlock label="Loading SEC registration trends" />
      </div>
    );
  if (q.isError)
    return (
      <div className={className}>
        <StateNote
          tone="error"
          action={
            <button type="button" className="underline" onClick={() => void q.refetch()}>
              Retry
            </button>
          }
        >
          SEC registration trends could not be loaded.
        </StateNote>
      </div>
    );
  if (!d || (!d.bd && !adviserRows.length && !raum))
    return (
      <div className={className}>
        <StateNote>
          SEC broker-dealer and investment-adviser trends have not been published yet.
        </StateNote>
      </div>
    );
  return (
    <div className={className}>
      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
        {d.bd ? (
          <BrokerDealerChart overview={d.bd} />
        ) : (
          <StateNote>The broker-dealer monthly series is not available.</StateNote>
        )}
        {adviserRows.length ? (
          <ChartCard
            title="SEC-registered and exempt reporting investment advisers, by year"
            subtitle={`Advisers per Form ADV reporting year, ${adviserRows[0]?.year} to ${adviserRows[adviserRows.length - 1]?.year}`}
            source={
              <>
                Source:{" "}
                <SourceLink href={IA_STATS_PAGE}>
                  SEC Division of Investment Management, Investment Adviser Statistics
                </SourceLink>
                , Tab.1.1 subtotals. Unit: advisers. Exempt reporting advisers are drawn from{" "}
                {eraStart ?? "the first year with a value above 0"}; the table publishes 0 for
                earlier years.
              </>
            }
            table={
              <table className="w-full text-xs">
                <caption className="sr-only">
                  Registered and exempt reporting advisers by year
                </caption>
                <thead className="text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1 font-medium">
                      Year
                    </th>
                    <th scope="col" className="px-2 py-1 text-right font-medium">
                      SEC-registered
                    </th>
                    <th scope="col" className="px-2 py-1 text-right font-medium">
                      Exempt reporting
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 font-mono">
                  {[...adviserRows].reverse().map((r) => (
                    <tr key={r.year}>
                      <th scope="row" className="px-2 py-0.5 text-left font-medium">
                        {r.year}
                      </th>
                      <td className="px-2 py-0.5 text-right">
                        {r.ria == null ? "Not recorded" : fmtInt(r.ria)}
                      </td>
                      <td className="px-2 py-0.5 text-right">
                        {r.era == null ? "Not recorded" : fmtInt(r.era)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={adviserRows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="year"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
                />
                <YAxis
                  width={44}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => fmtInt(v)}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v, name) => [Number(v).toLocaleString("en-US"), String(name)]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                <Line
                  dataKey="ria"
                  name="SEC-registered advisers"
                  stroke={FDA_COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="era"
                  name="Exempt reporting advisers"
                  stroke={FDA_COLORS[2]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        ) : null}
        {raum ? (
          <ChartCard
            title="Regulatory assets under management reported by SEC-registered advisers"
            subtitle={`Aggregate Form ADV Item 5.F.(2) amount, $ trillions, ${raum[0]?.year} to ${raum[raum.length - 1]?.year}`}
            source={
              <>
                Source:{" "}
                <SourceLink href={IA_STATS_PAGE}>
                  SEC Division of Investment Management, Investment Adviser Statistics
                </SourceLink>
                , Tab.2.1 total. Unit: trillions of U.S. dollars, as reported by the advisers.
              </>
            }
            table={
              <table className="w-full text-xs">
                <caption className="sr-only">
                  Aggregate regulatory assets under management by year
                </caption>
                <thead className="text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1 font-medium">
                      Year
                    </th>
                    <th scope="col" className="px-2 py-1 text-right font-medium">
                      $ trillions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 font-mono">
                  {[...raum].reverse().map((r) => (
                    <tr key={r.year}>
                      <th scope="row" className="px-2 py-0.5 text-left font-medium">
                        {r.year}
                      </th>
                      <td className="px-2 py-0.5 text-right">
                        {r.value == null ? "Not recorded" : r.value.toLocaleString("en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={raum.map((p) => ({ year: String(p.year), value: p.value }))}
                margin={{ top: 6, right: 12, bottom: 0, left: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="year"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
                />
                <YAxis
                  width={44}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${v}T`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => [
                    `$${Number(v).toLocaleString("en-US")} trillion`,
                    "Regulatory AUM",
                  ]}
                />
                <Bar
                  dataKey="value"
                  name="Regulatory AUM ($ trillions)"
                  fill={FDA_COLORS[1]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        ) : null}
      </div>
      <div className="mt-3">
        <HowToRead measures={MEASURES} />
      </div>
    </div>
  );
}
