/**
 * Skeletons sized like the content they stand in for, so nothing shifts when data arrives.
 *
 *   <KpiCardSkeleton />            // one KPI card (label, value, delta, footer)
 *   <CardSkeleton lines={3} />     // a card with a title and text lines
 *   <ListSkeleton rows={6} />      // rows of a card list
 *   <ChartSkeleton height={240} /> // a chart card body
 */
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { cardClass } from "./styles";

export function KpiCardSkeleton({
  trend = false,
  footer = true,
  className,
  label = "Loading figure",
}: {
  trend?: boolean | undefined;
  footer?: boolean | undefined;
  className?: string | undefined;
  label?: string | undefined;
}) {
  return (
    <div
      className={cn(cardClass, "flex flex-col", className)}
      role="status"
      aria-label={label}
      aria-busy
    >
      <div className="space-y-2.5 px-4 pt-3.5 pb-4">
        <Skeleton className="h-4 w-2/3" />
        <div className="flex items-end justify-between gap-3">
          <Skeleton className="h-8 w-28" />
          {trend ? <Skeleton className="h-9 w-32" /> : null}
        </div>
        <Skeleton className="h-4 w-40" />
      </div>
      {footer ? (
        <div className="mt-auto border-t border-border px-4 py-2.5">
          <Skeleton className="h-3.5 w-3/5" />
        </div>
      ) : null}
    </div>
  );
}

export function CardSkeleton({
  lines = 3,
  className,
  label = "Loading",
}: {
  lines?: number | undefined;
  className?: string | undefined;
  label?: string | undefined;
}) {
  return (
    <div
      className={cn(cardClass, "space-y-2.5 p-4", className)}
      role="status"
      aria-label={label}
      aria-busy
    >
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function ListSkeleton({
  rows = 5,
  className,
  label = "Loading list",
}: {
  rows?: number | undefined;
  className?: string | undefined;
  label?: string | undefined;
}) {
  return (
    <ul
      className={cn("m-0 list-none divide-y divide-border p-0", className)}
      role="status"
      aria-label={label}
      aria-busy
    >
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-2.5">
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <Skeleton className="h-3.5 w-12" />
        </li>
      ))}
    </ul>
  );
}

export function ChartSkeleton({
  height = 240,
  className,
  label = "Loading chart",
}: {
  height?: number | undefined;
  className?: string | undefined;
  label?: string | undefined;
}) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-label={label} aria-busy>
      {/* a plain block: a skeleton never draws a shape that could be read as a trend */}
      <Skeleton className="w-full rounded-lg" style={{ height }} />
      <Skeleton className="h-3 w-1/3" />
    </div>
  );
}
