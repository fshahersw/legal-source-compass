/**
 * ChartCard: the slot every chart sits in. The title is the takeaway in plain words ("Consumer complaints to the CFPB
 * rose most, +99.1% on 2024"); the subtitle names the measure, unit, geography and period; the legend sits above the
 * plot; "View data" opens the values in a DataDrawer (table, source, CSV); the footer is one source line with the
 * "About this data" popover. Loading, error and empty states keep the card's height.
 *
 *   <ChartCard title="…takeaway…" subtitle="Percent change, latest complete period vs the one before"
 *     data={{ title: "…", columns, rows, rowKey }} source={{ source: {…}, about: <p>…</p> }}>
 *     <RankedBars … />
 *   </ChartCard>
 */
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardFooter, SourceFooter, type SourceFooterProps } from "./Card";
import { DataDrawer, type DataDrawerProps } from "./DataDrawer";
import { EmptyState } from "./EmptyState";
import { ChartSkeleton } from "./Skeletons";
import { ChartExplorer } from "@/components/charts/explore/ChartExplorer";

export function ChartCard<T>({
  title,
  subtitle,
  actions,
  legend,
  data,
  source,
  state = "ready",
  height = 220,
  emptyText = "Not recorded for this period.",
  errorText = "This chart could not be loaded.",
  onRetry,
  id,
  className,
  children,
}: {
  /** The takeaway, in plain words. */
  title: ReactNode;
  /** Measure, unit, geography, period. */
  subtitle?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  legend?: ReactNode | undefined;
  /** The values behind the chart, for the "View data" drawer. */
  data?: Omit<DataDrawerProps<T>, "mode" | "trigger"> | undefined;
  source?: SourceFooterProps | undefined;
  state?: "ready" | "loading" | "error" | "empty" | undefined;
  /** Height of the plot area while loading or empty, so the card never jumps. */
  height?: number | undefined;
  emptyText?: ReactNode | undefined;
  errorText?: ReactNode | undefined;
  onRetry?: (() => void) | undefined;
  id?: string | undefined;
  className?: string | undefined;
  children?: ReactNode | undefined;
}) {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <Card
      as="figure"
      id={id}
      aria-labelledby={titleId}
      className={cn("m-0 flex flex-col", className)}
    >
      <figcaption className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-3.5 pb-2.5">
        <div className="min-w-0 flex-[1_1_14rem]">
          <h3 id={titleId} className="text-label font-semibold text-foreground">
            {title}
          </h3>
          {subtitle ? <p className="mt-0.5 text-meta text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions || (data && state === "ready") ? (
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {actions}
            {data && state === "ready" && data.rows.length > 1 ? (
              <ChartExplorer title={data.title} columns={data.columns} rows={data.rows} />
            ) : null}
            {data && state === "ready" ? <DataDrawer {...data} /> : null}
          </div>
        ) : null}
      </figcaption>
      {legend && state === "ready" ? <div className="px-4 pb-2">{legend}</div> : null}
      <div className="min-w-0 flex-1 px-4 pb-4">
        {state === "loading" ? (
          <ChartSkeleton height={height} />
        ) : state === "error" ? (
          <EmptyState
            tone="error"
            compact
            title={errorText}
            className="h-full"
            action={
              onRetry ? (
                <Button size="sm" variant="outline" onClick={onRetry}>
                  Retry
                </Button>
              ) : undefined
            }
          />
        ) : state === "empty" ? (
          <div style={{ minHeight: height }} className="flex">
            <EmptyState compact title={emptyText} className="flex-1" />
          </div>
        ) : (
          children
        )}
      </div>
      {source ? (
        <CardFooter>
          <SourceFooter {...source} className="flex-1" />
        </CardFooter>
      ) : null}
    </Card>
  );
}
