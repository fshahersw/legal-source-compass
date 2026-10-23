import { useMemo, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HowToRead, type Measure } from "@/components/analysis/HowToRead";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import type { OversightTrend } from "@/lib/external/oversight.functions";
import { axisTick, Panel, SourceLink, tooltipStyle } from "../parts";
import {
  ALL_OTHER,
  fmtInt,
  fmtUsd,
  moneyYearRows,
  recsYearRows,
  reportYearRows,
  topTypes,
} from "./oversightView";

const SOURCE = "https://www.oversight.gov/reports/federal";

function ShowData({
  caption,
  head,
  rows,
  summary,
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
  summary: string;
}) {
  return (
    <details className="group border-t border-border/60">
      <summary className="cursor-pointer list-none px-3 py-1.5 text-xs font-medium hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        Show data
        <span className="font-normal text-muted-foreground"> · {summary}</span>
      </summary>
      <div className="max-h-64 overflow-auto px-2 pb-2">
        <table className="w-full text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-surface text-left text-[11px] text-muted-foreground">
            <tr>
              {head.map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={i === 0 ? "px-2 py-1 font-medium" : "px-2 py-1 text-right font-medium"}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60 font-mono">
            {rows.map((cells, r) => (
              <tr key={r}>
                {cells.map((c, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="px-2 py-0.5 text-left font-medium">
                      {c}
                    </th>
                  ) : (
                    <td key={i} className="px-2 py-0.5 text-right">
                      {c}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const reportMeasures = (asOfLabel: string): Measure[] => [
  {
    term: "Reports",
    means:
      "Reports listed on Oversight.gov, counted in the calendar year of the report date the OIG gave. One row of the listing is one report, whatever its type.",
    caveat:
      "A count of listed reports. A year with no bar has no listed report; it does not show the office published none. Reports with no report date are left out of the yearly bars.",
  },
  {
    term: "Types",
    means:
      "The report type as the OIG filed it (Audit, Inspection / Evaluation, Investigation and so on). The four largest are drawn separately; the rest are grouped.",
  },
  {
    term: "Partial year",
    means: `The last year is marked with an asterisk: the list ends at ${asOfLabel}, not at December 31.`,
    caveat: "Do not compare a partial year with complete years.",
  },
];

export function ReportsByYearChart({
  trend,
  title,
  className = "",
  tall = false,
}: {
  trend: OversightTrend;
  title: string;
  className?: string;
  tall?: boolean;
}) {
  const types = useMemo(() => topTypes(trend.totals.types), [trend]);
  const rows = useMemo(() => reportYearRows(trend, types), [trend, types]);
  const groups = [...types, ALL_OTHER];
  const first = rows[0]?.year;
  const last = rows[rows.length - 1]?.year;
  if (!rows.length)
    return (
      <Panel title={title} className={className}>
        <p className="px-3 py-3 text-xs text-muted-foreground">
          No listed report has a report date, so there is nothing to chart by year.
        </p>
      </Panel>
    );
  return (
    <Panel
      title={title}
      className={className}
      subtitle={`Listed reports by calendar year of the report date, ${first}${last && last !== first ? ` to ${last}` : ""}${rows.some((r) => r.partial) ? "*" : ""} · ${fmtInt(trend.totals.dated)} dated reports`}
      footnote={
        <>
          Source: <SourceLink href={SOURCE}>Oversight.gov, report listing</SourceLink> (CIGIE).
          Unit: reports. Data as of {trend.asOf ?? "Not recorded"}. Nothing is estimated.
        </>
      }
    >
      <div
        className={tall ? "h-64 px-1 pb-1 pt-2" : "h-52 px-1 pb-1 pt-2"}
        role="img"
        aria-label={`Stacked bars: ${title}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={14}
            />
            <YAxis
              width={40}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name) => [Number(v).toLocaleString("en-US"), String(name)]}
              labelFormatter={(l) => `Report year ${String(l)}`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
            {groups.map((g, i) => (
              <Bar
                key={g}
                dataKey={g}
                stackId="a"
                fill={FDA_COLORS[i % FDA_COLORS.length]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ShowData
        caption={title}
        head={["Year", ...groups, "All reports"]}
        summary={`${rows.length} years × ${groups.length} groups`}
        rows={[...rows]
          .reverse()
          .map((r) => [r.label, ...groups.map((g) => fmtInt(r[g] as number)), fmtInt(r.total)])}
      />
      <div className="border-t border-border/60 p-2">
        <HowToRead measures={reportMeasures(trend.asOf ?? "the latest listed date")} />
      </div>
    </Panel>
  );
}

export function RecsByYearChart({
  trend,
  title,
  className = "",
}: {
  trend: OversightTrend;
  title: string;
  className?: string;
}) {
  const rows = useMemo(() => recsYearRows(trend).filter((r) => r.recsReports > 0), [trend]);
  if (!rows.length) return null;
  return (
    <Panel
      title={title}
      className={className}
      subtitle="Recommendations the OIG states on its listed reports, by report year · as reported, not audited"
      footnote={
        <>
          Source: <SourceLink href={SOURCE}>Oversight.gov, report listing</SourceLink>. Unit:
          recommendations. A report that states no number adds nothing and is not counted as zero.
        </>
      }
    >
      <div className="h-44 px-1 pb-1 pt-2" role="img" aria-label={`Bars: ${title}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={14}
            />
            <YAxis
              width={44}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, _name, item) => {
                const p = item.payload as { recsReports: number; reports: number };
                return [
                  `${Number(v).toLocaleString("en-US")} (stated on ${p.recsReports} of ${p.reports} reports)`,
                  "Recommendations",
                ];
              }}
              labelFormatter={(l) => `Report year ${String(l)}`}
            />
            <Bar dataKey="recs" fill={FDA_COLORS[1]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ShowData
        caption={title}
        head={["Year", "Recommendations", "Reports stating a count", "Reports in year"]}
        summary={`${rows.length} years`}
        rows={[...rows]
          .reverse()
          .map((r) => [r.label, fmtInt(r.recs), fmtInt(r.recsReports), fmtInt(r.reports)])}
      />
    </Panel>
  );
}

export function MoneyByYearChart({
  trend,
  className = "",
}: {
  trend: OversightTrend;
  className?: string;
}) {
  const money = trend.money;
  const rows = useMemo(
    () => (money ? moneyYearRows(money.years, trend.asOf).filter((r) => r.reports > 0) : []),
    [money, trend.asOf],
  );
  const shown = rows.filter((r) => r.questionedCosts != null || r.fundsBetterUse != null);
  if (!money || !shown.length) return null;
  return (
    <Panel
      title="Dollar findings the OIG states, by report year"
      className={className}
      subtitle="Questioned costs and funds for better use, summed over reports that state them · as reported, not audited"
      footnote={
        <>
          Source:{" "}
          {money.sourceUrl ? (
            <SourceLink href={money.sourceUrl}>{money.source}</SourceLink>
          ) : (
            money.source
          )}
          . Unit: dollars. Excluded: {money.excludes.join(", ") || "none"} (they total other
          reports). A year with no stated amount is a gap, not zero. {money.note ?? ""}
        </>
      }
    >
      <div
        className="h-44 px-1 pb-1 pt-2"
        role="img"
        aria-label="Bars: dollar findings by report year"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={shown} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={14}
            />
            <YAxis
              width={64}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => fmtUsd(v)}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name) => [fmtUsd(Number(v)), String(name)]}
              labelFormatter={(l) => `Report year ${String(l)}`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
            <Bar
              dataKey="questionedCosts"
              name="Questioned costs"
              fill={FDA_COLORS[0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="fundsBetterUse"
              name="Funds for better use"
              fill={FDA_COLORS[2]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ShowData
        caption="Dollar findings the OIG states, by report year"
        head={["Year", "Questioned costs", "Funds for better use", "Reports", "State an amount"]}
        summary={`${shown.length} years`}
        rows={[...shown]
          .reverse()
          .map((r) => [
            r.label,
            fmtUsd(r.questionedCosts),
            fmtUsd(r.fundsBetterUse),
            fmtInt(r.reports),
            `${r.questionedReports} / ${r.betterUseReports}`,
          ])}
      />
    </Panel>
  );
}
