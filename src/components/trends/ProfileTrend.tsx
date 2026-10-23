/**
 * Trend cards on profile pages. They are the Analytics hub's own card (title that says what is counted, latest value,
 * chart, "Show data" table, "How to read this", source link, period), mounted where the number lives: a card either
 * reads its block from the server (`ProfileTrend`), draws a block the page already shaped (`StaticTrend`), or draws one
 * of the hub's registered blocks (`HubTrend`). Every state is the hub's: loading, error with retry, empty with a reason.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendCard, TrendCardView, type CardState } from "@/components/analytics/hub/TrendCard";
import { blockDef, type BlockDef } from "@/lib/analytics/registry";
import type { TrendBlockData } from "@/lib/analytics/trend";
import { cn } from "@/lib/utils";
import { profileDef, type ProfileKind } from "@/lib/trends/profile";
import { profileTrendQuery } from "./trendDefs";

/** One card read from the server for one profile (an MDL number). */
export function ProfileTrend({ kind, id }: { kind: ProfileKind; id: string | number }) {
  const key = String(id);
  const def = profileDef(kind, key);
  const q = useQuery(profileTrendQuery(kind, key));
  const state: CardState = q.isPending
    ? { kind: "loading" }
    : q.isError
      ? { kind: "error", onRetry: () => void q.refetch() }
      : q.data.status === "ok"
        ? { kind: "ok", block: q.data.data }
        : { kind: "empty", reason: q.data.reason };
  return <TrendCardView def={def} state={state} />;
}

/** A card for a block the page shaped itself from data it already holds. */
export function StaticTrend({
  def,
  block,
  emptyReason,
}: {
  def: BlockDef;
  block: TrendBlockData | null;
  emptyReason: string;
}) {
  return (
    <TrendCardView
      def={def}
      state={block ? { kind: "ok", block } : { kind: "empty", reason: emptyReason }}
    />
  );
}

/** One of the hub's registered blocks (the national series), on a page about one of its sources. */
export function HubTrend({ id }: { id: string }) {
  const def = blockDef(id);
  return def ? <TrendCard def={def} /> : null;
}

/** The card grid: one column on a phone, two at tablet width, three where there is room. */
export function TrendGrid({
  children,
  className,
  columns = 3,
}: {
  children: ReactNode;
  className?: string;
  columns?: 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 items-start gap-3 sm:grid-cols-2",
        columns === 3 ? "xl:grid-cols-3" : "",
        className,
      )}
    >
      {children}
    </div>
  );
}
