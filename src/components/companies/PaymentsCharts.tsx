/** Chart primitives and formatters for the CMS Open Payments views (no data access here). */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { cn } from "@/lib/utils";
import { median } from "@/lib/external/openPayments.functions";

export const GENERAL_COLOR = FDA_COLORS[0];
export const RESEARCH_COLOR = FDA_COLORS[1];
export const MAUDE_COLOR = FDA_COLORS[2];
const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltipStyle = {
  fontSize: 12,
  borderRadius: 4,
  borderColor: "var(--border)",
  backgroundColor: "var(--surface)",
};

/** Compact dollars: $3.92B, $41.2M, $812K, $940. Null reads "Not recorded". */
export function usd(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not recorded";
  const a = Math.abs(value);
  if (a >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(value / 1e6).toFixed(digits)}M`;
  if (a >= 1e4) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
export const fullUsd = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "Not recorded";
export const int = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US")
    : "Not recorded";
export const pct = (value: number | null | undefined, digits = 0) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(digits)}%`
    : "Not recorded";

const SHORT_NATURE: Record<string, string> = {
  "Compensation for services other than consulting, including serving as faculty or as a speaker at a venue other than a continuing education program":
    "Speaker / faculty, non-CE venue",
  "Compensation for serving as faculty or as a speaker for a non-accredited and noncertified continuing education program":
    "Faculty / speaker, unaccredited CE",
  "Compensation for serving as faculty or as a speaker for an accredited or certified continuing education program":
    "Faculty / speaker, accredited CE",
  "Compensation for serving as faculty or as a speaker for a medical education program":
    "Faculty / speaker, medical education",
  "Space rental or facility fees (teaching hospital only)": "Space rental / facility fees",
  "Current or prospective ownership or investment interest": "Ownership or investment interest",
  "Long term medical supply or device loan": "Long-term device or supply loan",
};
export const shortNature = (label: string) => SHORT_NATURE[label] ?? label;

export type YearRow = {
  year: number;
  general: number | null;
  research: number | null;
  archive: boolean;
};

/** General and research dollars by program year with the series median as a reference line. */
export function YearBars({
  rows,
  show = "both",
  height = 220,
}: {
  rows: YearRow[];
  show?: "both" | "general" | "research";
  height?: number;
}) {
  const key = show === "research" ? "research" : "general";
  const mid = median(rows.flatMap((r) => (r[key] == null ? [] : [r[key] as number])));
  return (
    <div className="px-1 pt-2">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} />
          <YAxis
            width={52}
            tick={axis}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => usd(v, 0)}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: number, name: string) => [fullUsd(value), name]}
            labelFormatter={(label, payload) =>
              `Program year ${label}${payload?.[0]?.payload?.archive ? " · archived detail file" : ""}`
            }
          />
          <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />
          {show !== "research" ? (
            <Bar
              dataKey="general"
              name="General payments"
              fill={GENERAL_COLOR}
              isAnimationActive={false}
            >
              {rows.map((r) => (
                <Cell key={r.year} fillOpacity={r.archive ? 0.55 : 1} />
              ))}
            </Bar>
          ) : null}
          {show !== "general" ? (
            <Bar
              dataKey="research"
              name="Research payments"
              fill={RESEARCH_COLOR}
              isAnimationActive={false}
            >
              {rows.map((r) => (
                <Cell key={r.year} fillOpacity={r.archive ? 0.55 : 1} />
              ))}
            </Bar>
          ) : null}
          {mid != null ? (
            <ReferenceLine y={mid} stroke="var(--muted-foreground)" strokeDasharray="4 3" />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
      {mid != null ? (
        <p className="px-2 text-[11px] text-muted-foreground">
          Dashed line: median {show === "research" ? "research" : "general"} year, {usd(mid)}
        </p>
      ) : null}
    </div>
  );
}

/** Inline SVG sparkline for dense table rows (no chart library cost per row). */
export function SparkBars({
  values,
  className,
  label,
}: {
  values: (number | null)[];
  className?: string;
  label: string;
}) {
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  const w = 4,
    gap = 1.5,
    h = 18;
  return (
    <svg
      viewBox={`0 0 ${values.length * (w + gap)} ${h}`}
      className={cn("h-[18px] w-[60px]", className)}
      role="img"
      aria-label={label}
    >
      {values.map((v, i) => {
        const bh = max > 0 && v ? Math.max(1, (v / max) * h) : 0;
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={h - bh}
            width={w}
            height={bh}
            rx={0.5}
            fill={GENERAL_COLOR}
            fillOpacity={i < 2 ? 0.55 : 1}
          />
        );
      })}
    </svg>
  );
}

export type ShareRow = { key: string; label: string; amount: number; compare?: number | null };

/** Horizontal share bars; an optional comparison share is drawn as a tick. */
export function ShareBars({
  rows,
  total,
  compareLabel,
  limit = 8,
}: {
  rows: ShareRow[];
  total: number;
  compareLabel?: string | undefined;
  limit?: number;
}) {
  if (!rows.length || total <= 0)
    return <p className="px-3 py-6 text-xs text-muted-foreground">Not recorded</p>;
  const shown = rows.slice(0, limit);
  const max = Math.max(...shown.map((r) => r.amount / total), ...shown.map((r) => r.compare ?? 0));
  return (
    <ul className="space-y-1.5 px-3 py-2">
      {shown.map((r) => {
        const share = r.amount / total;
        return (
          <li key={r.key} className="text-[11px]">
            <span className="flex justify-between gap-2">
              <span className="truncate" title={r.label}>
                {shortNature(r.label)}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground">
                {usd(r.amount)} · {pct(share)}
              </span>
            </span>
            <span className="relative mt-0.5 block h-1.5 rounded-full bg-muted">
              <span
                className="block h-full rounded-full"
                style={{ width: `${(share / max) * 100}%`, background: GENERAL_COLOR }}
              />
              {r.compare != null ? (
                <span
                  className="absolute -top-0.5 h-2.5 w-0.5 bg-foreground"
                  style={{ left: `calc(${(r.compare / max) * 100}% - 1px)` }}
                  title={`${compareLabel ?? "Comparison"}: ${pct(r.compare, 1)}`}
                />
              ) : null}
            </span>
          </li>
        );
      })}
      {rows.length > limit ? (
        <li className="text-[11px] text-muted-foreground">
          {rows.length - limit} smaller categories not shown ·{" "}
          {usd(rows.slice(limit).reduce((a, r) => a + r.amount, 0))}
        </li>
      ) : null}
    </ul>
  );
}

export type ScatterPoint = {
  id: string;
  name: string;
  payments: number;
  reports: number;
  /** MAUDE name coverage for the period (attributed / same-name reports). */
  coverage: number | null;
  /** Meets the coverage and report-count test; only these enter r and the outlier flags. */
  eligible: boolean;
  flagged: boolean;
};

/** Power-of-ten domain and ticks that cover every positive value (for log axes). */
function decades(values: number[]): { domain: [number, number]; ticks: number[] } {
  const v = values.filter((x) => x > 0);
  if (!v.length) return { domain: [1, 10], ticks: [1, 10] };
  const lo = Math.floor(Math.log10(Math.min(...v)));
  const hi = Math.max(lo + 1, Math.ceil(Math.log10(Math.max(...v))));
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => 10 ** (lo + i));
  // Pad half a decade on each side so points on a power of ten (e.g. 1 report) are not clipped by the frame.
  return { domain: [10 ** (lo - 0.3), 10 ** (hi + 0.3)], ticks };
}

/** Log-log scatter of general payments against MAUDE reports. */
export function PaymentsScatter({
  points,
  onPick,
}: {
  points: ScatterPoint[];
  onPick?: (id: string) => void;
}) {
  const plain = points.filter((p) => p.eligible && !p.flagged);
  const flagged = points.filter((p) => p.eligible && p.flagged);
  const excluded = points.filter((p) => !p.eligible);
  const xDomain = decades(points.map((p) => p.payments));
  const yDomain = decades(points.map((p) => p.reports));
  return (
    <div className="h-80 px-2 py-2">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: 14 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="payments"
            name="General payments"
            scale="log"
            domain={xDomain.domain}
            ticks={xDomain.ticks}
            allowDataOverflow
            tick={axis}
            tickFormatter={(v: number) => usd(v, 0)}
            label={{
              value: "General payments (log)",
              position: "insideBottom",
              offset: -10,
              fontSize: 11,
              fill: "var(--muted-foreground)",
            }}
          />
          <YAxis
            type="number"
            dataKey="reports"
            name="MAUDE reports"
            scale="log"
            domain={yDomain.domain}
            ticks={yDomain.ticks}
            allowDataOverflow
            tick={axis}
            width={56}
            label={{
              value: "MAUDE reports, lower bound (log)",
              angle: -90,
              position: "insideLeft",
              offset: -6,
              style: { textAnchor: "middle", fontSize: 11, fill: "var(--muted-foreground)" },
            }}
            tickFormatter={(v: number) =>
              new Intl.NumberFormat("en-US", { notation: "compact" }).format(v)
            }
          />
          <ZAxis range={[44, 44]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              const d = payload?.[0]?.payload as ScatterPoint | undefined;
              if (!d) return null;
              return (
                <div className="rounded border border-border bg-surface px-2 py-1 text-xs shadow-sm">
                  <div className="font-medium">{d.name}</div>
                  <div>General payments: {fullUsd(d.payments)}</div>
                  <div>MAUDE reports: ≥{int(d.reports)}</div>
                  <div>
                    Name coverage: {pct(d.coverage, 1)}
                    {d.eligible ? "" : " · not used for r"}
                  </div>
                </div>
              );
            }}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} verticalAlign="top" />
          <Scatter
            name="Excluded from r: coverage < 80% or < 50 reports"
            data={excluded}
            fill="var(--muted-foreground)"
            fillOpacity={0.35}
            isAnimationActive={false}
            onClick={(d: { id?: string }) => d?.id && onPick?.(d.id)}
            cursor="pointer"
          />
          <Scatter
            name="Used for r"
            data={plain}
            fill={GENERAL_COLOR}
            isAnimationActive={false}
            onClick={(d: { id?: string }) => d?.id && onPick?.(d.id)}
            cursor="pointer"
          />
          <Scatter
            name="Used for r · residual outlier"
            data={flagged}
            fill="var(--destructive)"
            isAnimationActive={false}
            onClick={(d: { id?: string }) => d?.id && onPick?.(d.id)}
            cursor="pointer"
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/** MAUDE reports per year (bars). */
export function ReportBars({
  rows,
  height = 150,
}: {
  rows: { year: number; reports: number }[];
  height?: number;
}) {
  return (
    <div style={{ height }} className="px-1 pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={axis} tickLine={false} axisLine={false} />
          <YAxis
            width={44}
            tick={axis}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tickFormatter={(v: number) =>
              new Intl.NumberFormat("en-US", { notation: "compact" }).format(v)
            }
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: number) => [int(value), "MAUDE reports received"]}
            labelFormatter={(label) => `Received in ${label}`}
          />
          <Bar dataKey="reports" fill={MAUDE_COLOR} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
