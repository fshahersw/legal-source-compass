import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { axisTick, Segmented, tooltipStyle } from "@/components/enforcement/parts";
import { numTick } from "@/components/enforcement/listDisplay";
import type { AgencyTrends } from "@/lib/external/agencyProfile.functions";
import { adminBands, TYPE_LABEL, yearRows } from "./agencyView";

export const SERIES_COLORS = {
  RULE: FDA_COLORS[0],
  PRORULE: FDA_COLORS[2],
  NOTICE: FDA_COLORS[1],
  PRESDOCU: FDA_COLORS[4],
  ALL: FDA_COLORS[3],
  significant: FDA_COLORS[4],
} as const;

const SHORT: Record<string, string> = {
  clinton: "Clinton",
  bush: "Bush",
  obama: "Obama",
  trump1: "Trump I",
  biden: "Biden",
  trump2: "Trump II",
};

type View = "rules" | "NOTICE" | "ALL" | "PRESDOCU";

/**
 * Documents per calendar year with administration bands. A band marks the administration in office on July 1 of
 * each year (terms begin January 20); the current year is partial and drawn lighter.
 */
export function ActivityChart({
  trends,
  from = 1995,
  views = ["rules", "NOTICE", "ALL"],
  height = 240,
}: {
  trends: AgencyTrends;
  from?: number;
  views?: View[];
  height?: number;
}) {
  const [view, setView] = useState<View>(views[0] ?? "rules");
  const rows = useMemo(() => yearRows(trends, from), [trends, from]);
  const bands = useMemo(() => adminBands(rows, trends.byAdministration), [rows, trends]);
  const options: { id: View; label: string }[] = views.map((v) => ({
    id: v,
    label: v === "rules" ? "Rules" : TYPE_LABEL[v],
  }));
  const bars: ("RULE" | "PRORULE" | "NOTICE" | "ALL" | "PRESDOCU")[] =
    view === "rules" ? ["RULE", "PRORULE"] : [view];
  const empty = rows.every((r) => bars.every((b) => r[b] === 0));
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2">
        {options.length > 1 ? (
          <Segmented label="Document type" value={view} options={options} onChange={setView} />
        ) : (
          <span />
        )}
        <span className="text-[11px] text-muted-foreground">
          Shaded bands: administration in office for most of the year · {trends.partialYear} to{" "}
          {trends.asOf} (partial)
        </span>
      </div>
      {empty ? (
        <p className="px-3 py-8 text-center text-xs text-muted-foreground">
          No {view === "rules" ? "rules or proposed rules" : TYPE_LABEL[view].toLowerCase()}{" "}
          recorded for this agency since {from}.
        </p>
      ) : (
        <div className="px-1 pb-1" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 18, right: 12, bottom: 0, left: -6 }}>
              {bands.map((b) => (
                <ReferenceArea
                  key={`${b.key}-${b.x1}`}
                  x1={b.x1}
                  x2={b.x2}
                  ifOverflow="extendDomain"
                  fill="var(--muted-foreground)"
                  fillOpacity={b.index % 2 ? 0.035 : 0.09}
                  strokeOpacity={0}
                  label={{
                    value: SHORT[b.key] ?? b.label,
                    position: "insideTop",
                    fontSize: 10,
                    fill: "var(--muted-foreground)",
                    offset: -14,
                  }}
                />
              ))}
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="year" tick={axisTick} interval="preserveStartEnd" minTickGap={14} />
              <YAxis tick={axisTick} tickFormatter={numTick} width={48} allowDecimals={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => [value.toLocaleString("en-US"), name]}
                labelFormatter={(label: string) =>
                  label === trends.partialYear ? `${label} (to ${trends.asOf})` : label
                }
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {bars.map((b) => (
                <Bar
                  key={b}
                  dataKey={b}
                  name={TYPE_LABEL[b]}
                  fill={SERIES_COLORS[b]}
                  isAnimationActive={false}
                  maxBarSize={14}
                >
                  {rows.map((r) => (
                    <Cell key={r.year} fillOpacity={r.partial ? 0.4 : 1} />
                  ))}
                </Bar>
              ))}
              {view === "rules" ? (
                <Line
                  dataKey="significant"
                  name="Significant final rules"
                  stroke={SERIES_COLORS.significant}
                  strokeDasharray="4 3"
                  dot={false}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
