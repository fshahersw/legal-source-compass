/**
 * The frame every SVG-kit chart sits in: a title that says what is counted, the unit and period, its states (loading,
 * empty, error, partial), a Chart / Table toggle, "How to read this" notes and the source links. It is a ChartCard
 * (see ChartCard.tsx) with the kit's original props, so both kinds of chart share one look.
 */
import type { ReactNode } from "react";
import {
  ChartCard,
  SourceLinks,
  type ChartSource,
  type ChartStatus,
  type KpiItem,
  type TableSpec,
} from "./ChartCard";
import { SeriesLegend } from "./recharts/content";

export { SourceLinks };
export type { ChartSource, ChartStatus, TableSpec };

export type ChartFrameProps = {
  /** The takeaway, or what is counted, e.g. "Federal civil cases filed, by state". */
  title: string;
  /** Unit of the values ("cases", "deaths per 100,000 residents"). */
  unit?: string | undefined;
  /** Period shown ("2014–2024", "As of October 1, 2026"). */
  period?: string | undefined;
  /** Replaces the "Unit · period" subtitle (use when the title is a takeaway and the measure needs naming). */
  subtitle?: string | undefined;
  sources: readonly ChartSource[];
  status: ChartStatus;
  /** Shown above the chart when part of the data could not be read or is incomplete. */
  partialNotice?: string | undefined;
  /** "How to read this": one short sentence each (in the About popover). */
  notes?: readonly string[] | undefined;
  /** Small print under the chart (partial periods, gaps, n). */
  footnotes?: readonly string[] | undefined;
  table?: TableSpec | undefined;
  /** Key figures between the header and the chart. */
  kpis?: readonly KpiItem[] | undefined;
  /** Controls in the header (toggles, a select). */
  actions?: ReactNode;
  /** Data date the source states ("data through June 30, 2026"). */
  asOf?: string | undefined;
  headingLevel?: "h2" | "h3";
  id?: string | undefined;
  className?: string | undefined;
  /** Height reserved while loading, so the layout does not jump. */
  minHeight?: number | undefined;
  children?: ReactNode;
};

export function ChartFrame({
  title,
  unit,
  period,
  subtitle,
  sources,
  status,
  partialNotice,
  notes,
  footnotes,
  table,
  kpis,
  actions,
  asOf,
  headingLevel = "h3",
  id,
  className,
  minHeight = 200,
  children,
}: ChartFrameProps) {
  const meta = subtitle ?? [unit ? capitalize(unit) : null, period].filter(Boolean).join(" · ");
  return (
    <ChartCard
      title={title}
      subtitle={meta || undefined}
      status={status}
      table={table}
      kpis={kpis}
      sources={sources}
      period={period}
      asOf={asOf}
      notice={partialNotice}
      footnotes={footnotes}
      actions={actions}
      headingLevel={headingLevel}
      id={id}
      className={className}
      minHeight={minHeight}
      aboutTitle="How to read this"
      about={
        notes?.length ? (
          <ul>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : undefined
      }
    >
      {children}
    </ChartCard>
  );
}

/** Legend for two or more series: a short line (lines) or a swatch (bars, areas) beside each label. */
export function ChartLegend({
  items,
  mark = "line",
  className,
}: {
  items: readonly { id: string; label: string; color: string; dashed?: boolean | undefined }[];
  mark?: "line" | "swatch";
  className?: string | undefined;
}) {
  return <SeriesLegend items={items} mark={mark} className={className ?? "pb-1.5"} />;
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
