import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CircleSlash, RefreshCw, RotateCw, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  describeFreshness,
  formatUtcDateTime,
  SOURCE_LABELS,
  type FreshnessResult,
  type FreshnessTone,
} from "@/lib/ingest/freshness";
import { freshnessQuery } from "./freshnessQuery";

export type FreshnessTableState =
  { kind: "loading" } | { kind: "error" } | { kind: "ready"; result: FreshnessResult };

/** Sources page: which datasets update themselves on a schedule, when each last updated, and any problem. */
export function FreshnessTable({ className }: { className?: string }) {
  const q = useQuery(freshnessQuery);
  const state: FreshnessTableState = q.isPending
    ? { kind: "loading" }
    : q.isError
      ? { kind: "error" }
      : { kind: "ready", result: q.data };
  return (
    <FreshnessTableView state={state} onRetry={() => void q.refetch()} className={className} />
  );
}

const STATUS_TEXT: Record<FreshnessTone, string> = {
  ok: "Up to date",
  warning: "Overdue",
  error: "Last update failed",
  muted: "Not updated yet",
};

const STATUS_CLASS: Record<FreshnessTone, string> = {
  ok: "text-foreground",
  warning: "text-warning-foreground",
  error: "text-destructive",
  muted: "text-muted-foreground",
};

const STATUS_ICON: Record<FreshnessTone, typeof RefreshCw> = {
  ok: RefreshCw,
  warning: AlertTriangle,
  error: XCircle,
  muted: CircleSlash,
};

/** Presentational table for an already-known state (also used by the preview and tests). */
export function FreshnessTableView({
  state,
  onRetry,
  className,
}: {
  state: FreshnessTableState;
  onRetry?: () => void;
  className?: string | undefined;
}) {
  return (
    <section
      aria-labelledby="freshness-heading"
      className={cn(
        "min-w-0 overflow-hidden rounded-md border border-border bg-surface",
        className,
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border/70 px-3 py-2">
        <h2 id="freshness-heading" className="text-sm font-semibold leading-5">
          Scheduled updates
        </h2>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Datasets refreshed from the publisher's official API on a schedule · times in UTC
        </p>
      </header>
      <Body state={state} onRetry={onRetry} />
    </section>
  );
}

function Body({
  state,
  onRetry,
}: {
  state: FreshnessTableState;
  onRetry?: (() => void) | undefined;
}) {
  if (state.kind === "loading")
    return (
      <div role="status" aria-label="Loading update status" className="space-y-2 px-3 py-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    );
  if (state.kind === "error")
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-3 text-xs">
        <span className="text-muted-foreground">The update status could not be read just now.</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <RotateCw className="size-3" aria-hidden />
            Try again
          </button>
        ) : null}
      </div>
    );
  const { result } = state;
  if (result.ledger === "not_installed")
    return (
      <div className="px-3 py-3 text-xs">
        <p role="status" className="text-muted-foreground">
          Scheduled updates are not recorded yet. These datasets will refresh from their publishers
          once the schedule is switched on:
        </p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-foreground/90">
          {Object.entries(SOURCE_LABELS).map(([id, s]) => (
            <li key={id}>
              {s.label} <span className="text-muted-foreground">· {s.publisher}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  if (!result.rows.length)
    return (
      <p role="status" className="px-3 py-3 text-xs text-muted-foreground">
        No datasets are set to update on a schedule.
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="border-b border-border/70 text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-1.5 font-medium">
              Dataset
            </th>
            <th scope="col" className="px-3 py-1.5 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-1.5 font-medium">
              Last successful update
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">
              New records
            </th>
            <th scope="col" className="px-3 py-1.5 font-medium">
              Note
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {result.rows.map((row) => {
            const d = describeFreshness(row);
            const Icon = STATUS_ICON[d.tone];
            return (
              <tr key={row.source} className="align-top">
                <th scope="row" className="px-3 py-1.5 font-normal">
                  <span className="block font-medium text-foreground">{row.label}</span>
                  {row.publisher ? (
                    <span className="block text-[11px] text-muted-foreground">{row.publisher}</span>
                  ) : null}
                </th>
                <td className={cn("whitespace-nowrap px-3 py-1.5", STATUS_CLASS[d.tone])}>
                  <span className="inline-flex items-center gap-1">
                    <Icon className="size-3 shrink-0" aria-hidden />
                    {STATUS_TEXT[d.tone]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                  {row.lastSuccessAt ? (
                    formatUtcDateTime(row.lastSuccessAt)
                  ) : (
                    <span className="text-muted-foreground">Not recorded</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {row.newRecords !== null ? (
                    row.newRecords.toLocaleString("en-US")
                  ) : (
                    <span className="text-muted-foreground">Not recorded</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {row.message ??
                    (row.lastRunAt ? `Last checked ${formatUtcDateTime(row.lastRunAt)}` : "")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
