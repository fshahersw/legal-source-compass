import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { axis } from "@/components/courts/courtStatsData";
import type { ClbClusterYear, ClbCoverageYear } from "@/lib/external/clbCourt.functions";
import {
  fmtDec,
  fmtInt,
  fmtPct,
  shareOf,
  tick,
  type DecadeVoteRow,
  type YearRow,
} from "./clbFormat";

const MARGIN = { top: 6, right: 8, bottom: 0, left: 0 };
const GRID = { stroke: "var(--border)", vertical: false, strokeDasharray: "3 3" } as const;
const LEGEND = { fontSize: 11 } as const;
const CURSOR = { fill: "var(--muted)", opacity: 0.45 } as const;

function TipBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface px-2 py-1.5 text-xs shadow-sm">
      <p className="mb-0.5 font-semibold">{title}</p>
      <div className="space-y-px tabular-nums">{children}</div>
    </div>
  );
}

function TipLine({ name, value }: { name: string; value: string }) {
  return (
    <p className="flex justify-between gap-4">
      <span className="text-muted-foreground">{name}</span>
      <span className="font-mono">{value}</span>
    </p>
  );
}

function rowOf<T>(props: TooltipProps<number, string>): T | null {
  if (!props.active || !props.payload?.length) return null;
  return (props.payload[0]?.payload as T | undefined) ?? null;
}

function DocketYearTip(props: TooltipProps<number, string> & { split: boolean }) {
  const r = rowOf<YearRow>(props);
  if (!r) return null;
  return (
    <TipBox title={r.partial ? `${r.yr} (partial year)` : String(r.yr)}>
      <TipLine name="Dockets filed" value={fmtInt(r.dockets)} />
      {props.split ? (
        <>
          <TipLine name="Civil-numbered" value={fmtInt(r.civil)} />
          <TipLine name="Criminal-numbered" value={fmtInt(r.criminal)} />
          <TipLine name="Other" value={fmtInt(r.other)} />
        </>
      ) : null}
      <TipLine
        name="With a termination date"
        value={`${fmtInt(r.terminated)} (${fmtPct(shareOf(r.terminated, r.dockets))})`}
      />
      <TipLine
        name="From RECAP"
        value={`${fmtInt(r.recap)} (${fmtPct(shareOf(r.recap, r.dockets))})`}
      />
    </TipBox>
  );
}

/** Dockets by filing year, stacked civil-numbered / criminal-numbered / other (one series when no split). */
export function DocketYearChart({ rows, split }: { rows: YearRow[]; split: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={MARGIN} barCategoryGap={1}>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="label"
          tick={axis}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={18}
        />
        <YAxis tick={axis} tickFormatter={tick} width={42} tickLine={false} axisLine={false} />
        <Tooltip content={<DocketYearTip split={split} />} cursor={CURSOR} />
        {split ? <Legend wrapperStyle={LEGEND} iconSize={9} /> : null}
        {split ? (
          <Bar
            dataKey="civil"
            name="Civil-numbered"
            stackId="y"
            fill={FDA_COLORS[0]}
            isAnimationActive={false}
          />
        ) : null}
        {split ? (
          <Bar
            dataKey="criminal"
            name="Criminal-numbered"
            stackId="y"
            fill={FDA_COLORS[2]}
            isAnimationActive={false}
          />
        ) : null}
        <Bar
          dataKey="other"
          name={split ? "Other" : "Dockets"}
          stackId="y"
          fill={split ? FDA_COLORS[5] : FDA_COLORS[0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

type CoverageRow = ClbCoverageYear & { label: string };

function CoverageTip(props: TooltipProps<number, string>) {
  const r = rowOf<CoverageRow>(props);
  if (!r) return null;
  return (
    <TipBox title={`FY${r.fy}`}>
      <TipLine name="CourtListener civil-numbered" value={fmtInt(r.clCivilDockets)} />
      <TipLine name="FJC civil filings" value={fmtInt(r.fjcFilings)} />
      <TipLine name="Ratio" value={`${fmtDec(r.ratio, 3)}×`} />
    </TipBox>
  );
}

/** CourtListener civil-numbered dockets and FJC civil filings per fiscal year, with their ratio. */
export function CoverageChart({ years }: { years: readonly ClbCoverageYear[] }) {
  const rows: CoverageRow[] = years.map((y) => ({ ...y, label: `'${String(y.fy).slice(2)}` }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ ...MARGIN, right: 4 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={1} />
        <YAxis
          yAxisId="n"
          tick={axis}
          tickFormatter={tick}
          width={42}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="r"
          orientation="right"
          domain={[0, "auto"]}
          tick={axis}
          tickFormatter={(v: number) => `${v.toFixed(1)}×`}
          width={38}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<CoverageTip />} />
        <Legend wrapperStyle={LEGEND} iconType="plainline" />
        <Line
          yAxisId="n"
          dataKey="clCivilDockets"
          name="CourtListener civil-numbered dockets"
          stroke={FDA_COLORS[0]}
          strokeWidth={2}
          dot={{ r: 2 }}
          isAnimationActive={false}
        />
        <Line
          yAxisId="n"
          dataKey="fjcFilings"
          name="FJC civil filings"
          stroke={FDA_COLORS[1]}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="r"
          dataKey="ratio"
          name="Ratio (right axis)"
          stroke={FDA_COLORS[2]}
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function ClusterYearTip(props: TooltipProps<number, string>) {
  const r = rowOf<ClbClusterYear>(props);
  if (!r) return null;
  return (
    <TipBox title={String(r.yr)}>
      <TipLine name="Opinion clusters" value={fmtInt(r.clusters)} />
      <TipLine
        name="Cited at least once"
        value={`${fmtInt(r.cited)} (${fmtPct(shareOf(r.cited, r.clusters))})`}
      />
    </TipBox>
  );
}

/** Opinion clusters by the year of their filing date. */
export function ClusterYearChart({ years }: { years: readonly ClbClusterYear[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={years as ClbClusterYear[]} margin={MARGIN} barCategoryGap={1}>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="yr"
          tick={axis}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={18}
        />
        <YAxis tick={axis} tickFormatter={tick} width={42} tickLine={false} axisLine={false} />
        <Tooltip content={<ClusterYearTip />} cursor={CURSOR} />
        <Bar
          dataKey="clusters"
          name="Opinion clusters"
          fill={FDA_COLORS[0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function VoteTip(props: TooltipProps<number, string>) {
  const r = rowOf<DecadeVoteRow>(props);
  if (!r) return null;
  return (
    <TipBox title={`${r.label} · ${fmtInt(r.withVotes)} decisions with a vote split`}>
      <TipLine name="Unanimous" value={`${fmtInt(r.unanimous)} (${fmtPct(r.unanimousPct, 0)})`} />
      <TipLine name="5–4" value={`${fmtInt(r.fiveFour)} (${fmtPct(r.fiveFourPct, 0)})`} />
      <TipLine name="Other splits" value={`${fmtInt(r.other)} (${fmtPct(r.otherPct, 0)})`} />
    </TipBox>
  );
}

/** Vote classes by decade as a 100% stacked bar (Supreme Court Database linked decisions only). */
export function VoteChart({ rows }: { rows: readonly DecadeVoteRow[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows as DecadeVoteRow[]} margin={MARGIN} barCategoryGap={2}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={1} />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tick={axis}
          tickFormatter={(v: number) => `${v}%`}
          width={44}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<VoteTip />} cursor={CURSOR} />
        <Legend wrapperStyle={LEGEND} iconSize={9} />
        <Bar
          dataKey="unanimousPct"
          name="Unanimous"
          stackId="v"
          fill={FDA_COLORS[0]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="otherPct"
          name="Other splits"
          stackId="v"
          fill={FDA_COLORS[5]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="fiveFourPct"
          name="5–4"
          stackId="v"
          fill={FDA_COLORS[2]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function OralTip(props: TooltipProps<number, string>) {
  const r = rowOf<{ yr: number; n: number }>(props);
  if (!r) return null;
  return (
    <TipBox title={`Added in ${r.yr}`}>
      <TipLine name="Recordings" value={fmtInt(r.n)} />
    </TipBox>
  );
}

/** Oral-argument recordings by the year each was created in CourtListener. */
export function OralYearChart({ years }: { years: readonly { yr: number; n: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={years as { yr: number; n: number }[]} margin={MARGIN} barCategoryGap={2}>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="yr"
          tick={axis}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis tick={axis} tickFormatter={tick} width={42} tickLine={false} axisLine={false} />
        <Tooltip content={<OralTip />} cursor={CURSOR} />
        <Bar dataKey="n" name="Recordings" fill={FDA_COLORS[1]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
