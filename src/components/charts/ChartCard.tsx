/**
 * ChartCard for the chart layer: the kit's card chrome (src/components/kit/ChartCard: takeaway title, measure
 * subtitle, "View data" drawer with CSV, one "Source · period · as of" footer line with the Partial pill and the
 * "About this data" popover, loading / error / empty states) with the chart layer's props, plus an optional strip of
 * key figures above the chart and a data-quality notice. Charts render inside it; the chrome is never duplicated here.
 *
 *   <ChartCard title="Product liability filings peaked at 241,438 in FY2020; 45,713 in FY2025"
 *     subtitle="Cases filed in U.S. district courts · Table C-11 · FY2014–FY2025"
 *     table={periodTable(rows, "year", series, fmt, { caption: "…" })}
 *     sources={[{ label: "Judicial Business", url }]} period="FY2014–FY2025" about={<p>…</p>}>
 *     <TrendColumns … />
 *   </ChartCard>
 */
import type { ReactNode } from "react";
import { ChartCard as KitChartCard } from "@/components/kit/ChartCard";
import { DeltaPill as KitDeltaPill } from "@/components/kit/KpiCard";
import { cn } from "@/lib/utils";
import { chartTokens } from "./palette";
import { tableDrawer, type TableColumn, type TableSpec } from "./tableData";

export type { TableColumn, TableSpec };

export type ChartSource = { label: string; url: string };

export type ChartStatus =
  | { kind: "loading" }
  | { kind: "error"; message?: string | undefined; onRetry?: (() => void) | undefined }
  | { kind: "empty"; reason: string }
  | { kind: "ready" };

export type KpiItem = {
  label: string;
  value: ReactNode;
  /** Short qualifier under the value ("FY2025", "vs national 15.1%"). */
  detail?: ReactNode;
  /** Change pill; direction only (neutral tone: a rise is not good or bad by itself). */
  delta?: { text: string; direction: "up" | "down" | "flat" } | undefined;
};

export type ChartCardProps = {
  /** The takeaway in plain words, computed from the plotted values; a neutral description when none is reliable. */
  title: string;
  /** Measure, unit, geography and period ("Product liability filings · cases · FY2014–FY2025"). */
  subtitle?: ReactNode;
  /** Key figures between the header and the chart. */
  kpis?: readonly KpiItem[] | undefined;
  status?: ChartStatus | undefined;
  /** Values behind the chart: the "View data" drawer (table, source, CSV). */
  table?: TableSpec | undefined;
  sources?: readonly ChartSource[] | undefined;
  /** Period shown in the footer ("FY2014–FY2025"). */
  period?: string | undefined;
  /** Data date the source states. */
  asOf?: string | undefined;
  /** A note printed as small print under the chart (a source sentence or a method note written as text). */
  footer?: ReactNode;
  /** "About this data" popover: method, caveats. */
  about?: ReactNode;
  /** Heading of the popover (default "About this data"). */
  aboutTitle?: string | undefined;
  /** Partial-period note: the footer shows the "Partial" pill with this note in its popover. */
  partial?: string | undefined;
  /** Shown above the chart when part of the data could not be read or one value dominates. */
  notice?: ReactNode;
  /** Small print under the chart (asterisk notes that must stay visible). */
  footnotes?: readonly ReactNode[] | undefined;
  /** Controls in the header (a select, a segmented toggle). */
  actions?: ReactNode;
  /**
   * "editorial": a bold takeaway headline under a small accent rule, a one-line subtitle (measure, unit, period) and
   * the source line, for the page's lead charts. The default card is the quieter working card.
   */
  variant?: "default" | "editorial" | undefined;
  /** Kept for callers; the kit card's title is an h3. */
  headingLevel?: "h2" | "h3" | "h4";
  id?: string | undefined;
  className?: string | undefined;
  /** Kept for callers; the kit card pads its body. */
  padded?: boolean | undefined;
  /** Height reserved while loading or empty. */
  minHeight?: number | undefined;
  children?: ReactNode;
};

/** Key figures of one chart: label, value, an optional neutral change pill and a qualifier, divided by hairlines. */
export function ChartKpis({ items, className }: { items: readonly KpiItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <dl
      className={cn(
        "m-0 mb-3 grid gap-px overflow-hidden rounded-lg border border-border bg-border",
        items.length >= 4
          ? "grid-cols-2 lg:grid-cols-4"
          : items.length === 3
            ? "grid-cols-1 sm:grid-cols-3"
            : items.length === 2
              ? "grid-cols-2"
              : "grid-cols-1",
        className,
      )}
    >
      {items.map((k) => (
        <div key={k.label} className="min-w-0 bg-card px-3 py-2">
          <dt className="truncate text-meta text-muted-foreground" title={k.label}>
            {k.label}
          </dt>
          <dd className="m-0 mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-kpi-sm text-foreground">{k.value}</span>
            {k.delta ? (
              <KitDeltaPill
                delta={{
                  value: k.delta.direction === "up" ? 1 : k.delta.direction === "down" ? -1 : 0,
                  text: k.delta.text,
                }}
              />
            ) : null}
          </dd>
          {k.detail ? <dd className="m-0 text-meta text-muted-foreground">{k.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** "Source: A; B" as plain links, for places outside a card footer. */
export function SourceLinks({ sources }: { sources: readonly ChartSource[] }) {
  if (!sources.length) return <span>Source: Not recorded</span>;
  return (
    <span>
      {sources.length === 1 ? "Source: " : "Sources: "}
      {sources.map((s, i) => (
        <span key={`${s.url}-${i}`}>
          {i > 0 ? "; " : ""}
          <a
            href={s.url}
            target={s.url.startsWith("/") ? undefined : "_blank"}
            rel={s.url.startsWith("/") ? undefined : "noreferrer"}
            className="underline-offset-2 hover:underline"
          >
            {s.label}
          </a>
        </span>
      ))}
    </span>
  );
}

export function ChartCard({
  title,
  subtitle,
  kpis,
  status = { kind: "ready" },
  table,
  sources,
  period,
  asOf,
  footer,
  about,
  aboutTitle,
  partial,
  notice,
  footnotes,
  actions,
  variant = "default",
  id,
  className,
  minHeight = 200,
  children,
}: ChartCardProps) {
  const state =
    status.kind === "loading"
      ? "loading"
      : status.kind === "error"
        ? "error"
        : status.kind === "empty"
          ? "empty"
          : "ready";
  const sourceProp =
    sources && sources.length ? sources.map((s) => ({ label: s.label, href: s.url })) : undefined;
  const hasFooter = sourceProp !== undefined || period || asOf || about || partial;
  return (
    <KitChartCard
      title={
        variant === "editorial" ? (
          <>
            <span aria-hidden className="mb-2 block h-[3px] w-9 rounded-full bg-brand" />
            <span className="block text-[15px] font-bold leading-[1.3] tracking-[-0.01em] text-foreground">
              {title}
            </span>
          </>
        ) : (
          title
        )
      }
      subtitle={
        variant === "editorial" && subtitle ? (
          <span className="mt-0.5 block text-[13px] leading-5">{subtitle}</span>
        ) : (
          subtitle
        )
      }
      actions={actions}
      id={id}
      className={className}
      state={state}
      height={minHeight}
      emptyText={status.kind === "empty" ? status.reason : undefined}
      errorText={status.kind === "error" ? status.message : undefined}
      onRetry={status.kind === "error" ? status.onRetry : undefined}
      data={table ? tableDrawer(table) : undefined}
      source={
        hasFooter
          ? {
              source: sourceProp,
              period,
              asOf,
              about,
              aboutTitle,
              partial,
            }
          : undefined
      }
    >
      <div className="min-w-0" style={chartTokens}>
        {kpis?.length ? <ChartKpis items={kpis} /> : null}
        {notice ? (
          <div
            role="note"
            className="mb-3 rounded-md bg-warning/10 px-2.5 py-1.5 text-meta text-foreground ring-1 ring-warning/40"
          >
            {notice}
          </div>
        ) : null}
        {children}
        {footer ? <div className="pt-2 text-meta text-muted-foreground">{footer}</div> : null}
        {footnotes?.length ? (
          <div className="space-y-0.5 pt-2 text-[11px] leading-4 text-muted-foreground">
            {footnotes.map((f, i) => (
              <p key={i} className="m-0">
                {f}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </KitChartCard>
  );
}
