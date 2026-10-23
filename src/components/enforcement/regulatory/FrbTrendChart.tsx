import { useMemo } from "react";
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
import type { FrbOverview } from "@/lib/external/regulatoryRecords.functions";
import { axisTick, Panel, SourceLink, tooltipStyle } from "../parts";
import { dayLabel, fmtInt, FRB_CHART_GROUPS, frbYearRows, OTHER_FAMILIES } from "./regulatoryView";

const MEASURES: Measure[] = [
  {
    term: "Actions",
    means:
      "Rows in the Board's enforcement-actions list, counted in the calendar year of the effective date. One row is one banking organization or one individual named in an action, so a single order naming several parties is several rows.",
    caveat: "A count of listed rows, not of orders, and not a measure of penalties.",
  },
  {
    term: "Action families",
    means: `Grouped by the first action name in the Board's own type text (a combination such as "Cease and Desist Order, Civil Money Penalty" counts once, under the first). "All other families" combines ${OTHER_FAMILIES.map((f) => f.toLowerCase()).join(", ")}.`,
  },
  {
    term: "Partial year",
    means:
      "The last year is marked with an asterisk: it ends at the latest effective date in the list, not at December 31.",
    caveat: "Do not compare a partial year with complete years.",
  },
  {
    term: "Public record",
    means:
      "Formal actions have been public since August 1989 (Section 19 letters since 2008). Earlier actions are not public, so the chart starts in 1989.",
  },
];

export function FrbTrendChart({ overview }: { overview: FrbOverview }) {
  const rows = useMemo(() => frbYearRows(overview), [overview]);
  return (
    <Panel
      title="Federal Reserve enforcement actions by year and family"
      subtitle={`Rows in the Board's list by effective year, ${overview.firstEffectiveDate.slice(0, 4)} to ${overview.latestEffectiveDate.slice(0, 4)}* · ${fmtInt(overview.actions)} rows`}
      footnote={
        <>
          Source:{" "}
          <SourceLink href="https://www.federalreserve.gov/supervisionreg/enforcementactions.htm">
            Federal Reserve Board, Enforcement Actions
          </SourceLink>
          . Unit: rows of the list. Period: effective dates {dayLabel(overview.firstEffectiveDate)}{" "}
          to {dayLabel(overview.latestEffectiveDate)} (*{overview.partialYear} is partial). Nothing
          is estimated.
        </>
      }
    >
      <div
        className="h-64 px-1 pb-1 pt-2"
        role="img"
        aria-label="Stacked bars: Federal Reserve enforcement actions by effective year and action family"
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
              labelFormatter={(l) => `Effective in ${String(l)}`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
            {FRB_CHART_GROUPS.map((g, i) => (
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
      <details className="group border-t border-border/60">
        <summary className="cursor-pointer list-none px-3 py-1.5 text-xs font-medium hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          Show data
          <span className="font-normal text-muted-foreground">
            {" "}
            · {rows.length} years × {FRB_CHART_GROUPS.length} groups
          </span>
        </summary>
        <div className="max-h-72 overflow-auto px-2 pb-2">
          <table className="w-full text-xs">
            <caption className="sr-only">
              Federal Reserve enforcement actions by effective year and action family
            </caption>
            <thead className="sticky top-0 bg-surface text-left text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-2 py-1 font-medium">
                  Year
                </th>
                {FRB_CHART_GROUPS.map((g) => (
                  <th key={g} scope="col" className="px-2 py-1 text-right font-medium">
                    {g}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1 text-right font-medium">
                  All rows
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-mono">
              {rows.map((r) => (
                <tr key={r.year}>
                  <th scope="row" className="px-2 py-0.5 text-left font-medium">
                    {r.label}
                  </th>
                  {FRB_CHART_GROUPS.map((g) => (
                    <td key={g} className="px-2 py-0.5 text-right">
                      {fmtInt(r[g])}
                    </td>
                  ))}
                  <td className="px-2 py-0.5 text-right">{fmtInt(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <div className="border-t border-border/60 p-2">
        <HowToRead measures={MEASURES} />
      </div>
    </Panel>
  );
}
