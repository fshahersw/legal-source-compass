import { useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { int } from "@/components/analysis/analysisFormat";
import { numTick } from "@/components/enforcement/listDisplay";
import { axisTick, MoreToggle, tooltipStyle } from "@/components/enforcement/parts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { barWidth, NOT_RECORDED, pct } from "./collectionFormat";
import { CourtLink } from "./CollectionParts";

// -------------------------------------------------------------------------------------------- bar chart by year

export type BarSeries = { key: string; label: string; color: string };
export type BarRow = {
  /** The tick and tooltip title: "2025", "2026*" or "1980s". */
  label: string;
  /** Drawn at half strength, starred, and named as not comparable. */
  partial?: boolean;
  /** Drawn at half strength: a year whose count is too small to read as the level of activity. */
  thin?: boolean;
  values: Record<string, number | null>;
};

function BarLegend({ series, note }: { series: readonly BarSeries[]; note?: ReactNode }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 pt-2 text-[11px]">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-sm"
            style={{ background: s.color }}
          />
          <span className="text-muted-foreground">{s.label}</span>
        </li>
      ))}
      {note ? <li className="text-muted-foreground">{note}</li> : null}
    </ul>
  );
}

/** Stacked (or single) bars by year, decade or similar label; partial and thin periods are drawn lighter and starred. */
export function YearBars({
  rows,
  series,
  subject,
  note,
  height = "h-56",
  stacked = true,
}: {
  rows: readonly BarRow[];
  series: readonly BarSeries[];
  /** What the bars count, for the accessible description. */
  subject: string;
  note?: ReactNode;
  height?: string;
  stacked?: boolean;
}) {
  const data = rows.map((r) => ({ ...r.values, label: r.label, partial: r.partial, thin: r.thin }));
  const first = rows[0]?.label;
  const last = rows.at(-1)?.label;
  return (
    <div>
      <BarLegend series={series} note={note} />
      <div
        className={`${height} p-2`}
        role="img"
        aria-label={`Bars of ${subject}${first && last ? `, ${first} to ${last}` : ""}${rows.some((r) => r.partial) ? "; the last period is partial and drawn lighter" : ""}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" minTickGap={14} />
            <YAxis tick={axisTick} tickFormatter={numTick} width={48} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={(p) => {
                const row = p.payload?.[0]?.payload as
                  | (Record<string, unknown> & { label: string; partial?: boolean; thin?: boolean })
                  | undefined;
                if (!p.active || !row) return null;
                const nums = series.map((s) => row[s.key] as number | null | undefined);
                const total = nums.every((n) => n != null)
                  ? nums.reduce<number>((a, n) => a + (n ?? 0), 0)
                  : null;
                return (
                  <div
                    className="rounded-md border border-border bg-surface text-foreground shadow-sm"
                    style={tooltipStyle}
                  >
                    <p className="font-medium">
                      {row.label}
                      {row.partial ? " (partial year)" : ""}
                      {row.thin ? " (thin coverage)" : ""}
                    </p>
                    {series.map((s) => (
                      <p key={s.key} className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="size-2 rounded-sm"
                          style={{ background: s.color }}
                        />
                        <span className="text-muted-foreground">{s.label}</span>
                        <span className="ml-auto pl-3 font-mono">
                          {row[s.key] == null ? NOT_RECORDED : int(row[s.key] as number)}
                        </span>
                      </p>
                    ))}
                    {series.length > 1 && total != null ? (
                      <p className="flex border-t border-border/60 pt-0.5">
                        <span className="text-muted-foreground">Total</span>
                        <span className="ml-auto pl-3 font-mono">{int(total)}</span>
                      </p>
                    ) : null}
                  </div>
                );
              }}
            />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                {...(stacked ? { stackId: "all" } : {})}
                isAnimationActive={false}
              >
                {rows.map((r) => (
                  <Cell key={r.label} fillOpacity={r.partial || r.thin ? 0.45 : 1} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------- lists of courts

export type CourtShareRow = {
  courtId: string;
  name: string;
  href: string | null;
  count: number;
  /** Share of the stated denominator; the bar is scaled to the largest on the list. */
  sharePct: number | null;
};

export type BarListRow = {
  key: string;
  label: ReactNode;
  /** Plain-text label for the tooltip. */
  title: string;
  count: number;
  /** Share of the stated denominator; the bar is scaled to the largest on the list. */
  sharePct: number | null;
};

/**
 * Rows of label, bar, share and count. The count column grows to its widest number, so an eight-digit count never
 * runs over the next panel; a long label wraps to two lines instead of being cut.
 */
export function BarList({
  rows,
  caption,
  countLabel,
  shareLabel,
  limit = 8,
  id,
  noun,
}: {
  rows: readonly BarListRow[];
  caption: string;
  countLabel: string;
  shareLabel: string;
  limit?: number;
  id: string;
  noun: string;
}) {
  const [all, setAll] = useState(false);
  if (!rows.length)
    return (
      <p className="p-3 text-xs text-muted-foreground">
        {caption} is {NOT_RECORDED}.
      </p>
    );
  const shown = all ? rows : rows.slice(0, limit);
  const max = Math.max(...rows.map((r) => r.sharePct ?? 0), 0);
  return (
    <div className="p-3" id={id}>
      <ul
        className="grid grid-cols-[minmax(0,1fr)_minmax(1.5rem,3.5rem)_3rem_minmax(3.75rem,auto)] gap-x-2 gap-y-1.5 text-xs"
        aria-label={caption}
      >
        {shown.map((r) => (
          <li key={r.key} className="col-span-4 grid grid-cols-subgrid items-center">
            <span className="line-clamp-2 break-words leading-4" title={r.title}>
              {r.label}
            </span>
            <span className="h-2.5 rounded-sm bg-muted" aria-hidden>
              <span
                className="block h-2.5 rounded-sm"
                style={{ width: `${barWidth(r.sharePct, max)}%`, background: FDA_COLORS[3] }}
              />
            </span>
            <span className="text-right font-mono" title={shareLabel}>
              {r.sharePct == null ? NOT_RECORDED : pct(r.sharePct)}
            </span>
            <span className="text-right font-mono text-muted-foreground" title={countLabel}>
              {int(r.count)}
            </span>
          </li>
        ))}
      </ul>
      <MoreToggle
        total={rows.length}
        limit={limit}
        expanded={all}
        onToggle={() => setAll((v) => !v)}
        controls={id}
        noun={noun}
      />
    </div>
  );
}

/** A list of plain labelled rows (the caseload page's ShareRow shape) as bars. */
export function ShareBars({
  rows,
  caption,
  countLabel,
  limit = 8,
  id,
}: {
  rows: readonly { key: string; label: string; count: number | null; sharePct: number | null }[];
  caption: string;
  countLabel: string;
  limit?: number;
  id: string;
}) {
  const ordered = [...rows]
    .flatMap((r) => (r.count == null ? [] : [{ ...r, count: r.count }]))
    .sort((a, b) => (b.sharePct ?? -1) - (a.sharePct ?? -1) || b.count - a.count);
  return (
    <BarList
      id={id}
      caption={caption}
      countLabel={countLabel}
      shareLabel="Share of the stated total"
      limit={limit}
      noun="rows"
      rows={ordered.map((r) => ({
        key: r.key,
        title: r.label,
        label: r.label,
        count: r.count,
        sharePct: r.sharePct,
      }))}
    />
  );
}

/** Courts with a count and a share, as bars. A court is a link only when its record's own link says so. */
export function CourtShareList({
  rows,
  caption,
  countLabel,
  shareLabel,
  limit = 8,
  id,
}: {
  rows: readonly CourtShareRow[];
  caption: string;
  countLabel: string;
  shareLabel: string;
  limit?: number;
  id: string;
}) {
  return (
    <BarList
      id={id}
      caption={caption}
      countLabel={countLabel}
      shareLabel={shareLabel}
      limit={limit}
      noun="courts"
      rows={rows.map((r) => ({
        key: r.courtId,
        title: r.name,
        label: (
          <CourtLink courtId={r.courtId} href={r.href}>
            {r.name}
          </CourtLink>
        ),
        count: r.count,
        sharePct: r.sharePct,
      }))}
    />
  );
}

// -------------------------------------------------------------------------------------------- correlation mark

/** A rank correlation on a -1 to +1 axis with its 95% interval; the numbers are always printed beside it. */
export function RhoMark({
  rho,
  low,
  high,
  label,
}: {
  rho: number;
  low: number;
  high: number;
  label: string;
}) {
  const x = (v: number) => 4 + ((Math.max(-1, Math.min(1, v)) + 1) / 2) * 112;
  return (
    <svg
      viewBox="0 0 120 16"
      width="120"
      height="16"
      role="img"
      aria-label={label}
      className="text-primary"
    >
      <line x1="4" x2="116" y1="8" y2="8" stroke="var(--border)" strokeWidth="1" />
      <line x1={x(0)} x2={x(0)} y1="3" y2="13" stroke="var(--muted-foreground)" strokeWidth="1" />
      <line x1={x(low)} x2={x(high)} y1="8" y2="8" stroke="currentColor" strokeWidth="2" />
      <line x1={x(low)} x2={x(low)} y1="5" y2="11" stroke="currentColor" strokeWidth="1.5" />
      <line x1={x(high)} x2={x(high)} y1="5" y2="11" stroke="currentColor" strokeWidth="1.5" />
      <circle cx={x(rho)} cy="8" r="3" fill="currentColor" />
    </svg>
  );
}
