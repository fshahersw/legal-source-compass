import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CircleSlash, Clock, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  describeFreshness,
  formatUtcDateTime,
  SOURCE_LABELS,
  sourceForDataset,
  type FreshnessRow,
  type FreshnessTone,
} from "@/lib/ingest/freshness";
import { freshnessQuery } from "./freshnessQuery";

export type FreshnessBadgeState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "not_recorded"; label: string }
  | { kind: "row"; row: FreshnessRow };

/**
 * "Updated <date> · <source>" for a dataset that updates itself on a schedule. Renders nothing for datasets that are not
 * self-updating, so it can sit on any dataset header.
 */
export function FreshnessBadge({ dataset, className }: { dataset: string; className?: string }) {
  const source = sourceForDataset(dataset);
  const q = useQuery({ ...freshnessQuery, enabled: source !== null });
  if (!source) return null;
  const label = SOURCE_LABELS[source]!.label;
  let state: FreshnessBadgeState;
  if (q.isPending) state = { kind: "loading" };
  else if (q.isError) state = { kind: "error" };
  else {
    const row = q.data.rows.find((r) => r.source === source);
    state = row ? { kind: "row", row } : { kind: "not_recorded", label };
  }
  return <FreshnessBadgeView state={state} className={className} />;
}

const TONE: Record<FreshnessTone, string> = {
  ok: "border-border text-muted-foreground",
  warning: "border-warning/40 bg-warning/10 text-warning-foreground",
  error: "border-destructive/40 bg-destructive/5 text-destructive",
  muted: "border-border text-muted-foreground",
};

const ICON: Record<FreshnessTone, typeof Clock> = {
  ok: RefreshCw,
  warning: AlertTriangle,
  error: XCircle,
  muted: CircleSlash,
};

/** Presentational badge for an already-known state (also used by the preview and tests). */
export function FreshnessBadgeView({
  state,
  className,
}: {
  state: FreshnessBadgeState;
  className?: string | undefined;
}) {
  const base =
    "inline-flex max-w-full items-center gap-1 rounded-sm border bg-surface px-1.5 py-0.5 text-[11px] leading-4";
  if (state.kind === "loading")
    return (
      <span
        role="status"
        aria-label="Loading update status"
        className={cn(base, "border-border text-muted-foreground", className)}
      >
        <Clock className="size-3 shrink-0" aria-hidden />
        <span className="h-2.5 w-24 animate-pulse rounded-sm bg-muted" />
      </span>
    );
  if (state.kind === "error")
    return (
      <span
        role="status"
        className={cn(base, "border-border text-muted-foreground", className)}
        title="The update status could not be read just now."
      >
        <Clock className="size-3 shrink-0" aria-hidden />
        Update status unavailable
      </span>
    );
  if (state.kind === "not_recorded")
    return (
      <span
        className={cn(base, "border-border text-muted-foreground", className)}
        title="Scheduled updates are not recorded for this dataset yet."
      >
        <CircleSlash className="size-3 shrink-0" aria-hidden />
        <span className="truncate">Updates not recorded · {state.label}</span>
      </span>
    );
  const { row } = state;
  const d = describeFreshness(row);
  const Icon = ICON[d.tone];
  const detail = [
    d.note,
    row.lastSuccessAt ? `Last successful update: ${formatUtcDateTime(row.lastSuccessAt)}.` : null,
    row.newRecords !== null ? `New records in that update: ${row.newRecords}.` : null,
    row.publisher ? `Source: ${row.publisher}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cn(base, TONE[d.tone], className)} title={detail}>
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">
        {d.text} · {row.label}
      </span>
      {d.tone === "error" && row.lastSuccessAt ? (
        <span className="shrink-0">· last update failed</span>
      ) : null}
      {d.tone === "warning" ? <span className="shrink-0">· overdue</span> : null}
      <span className="sr-only">{detail}</span>
    </span>
  );
}
