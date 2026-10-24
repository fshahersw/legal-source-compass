/**
 * Insights KPI tiles on the kit's KpiCard: latest complete value, the change as a neutral delta pill, a readable
 * sparkline (128 × 36), partial-period pill, source footer and "Open chart". Shared by the /insights page and the
 * Overview's headline row (HeadlineTiles), which read the same Analytics hub blocks through the same query cache.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { analyticsBlockQuery } from "@/components/analytics/hub/blockQuery";
import { Sparkline } from "@/components/charts/Sparkline";
import { KpiCard, KpiGrid } from "@/components/kit/KpiCard";
import { cn } from "@/lib/utils";
import { HEADLINE_BLOCKS, hubTileState, type TileState } from "./hubTiles";
import { kpiDelta } from "./kpiDelta";
import type { Kpi } from "./kpis";

/**
 * "Open chart" link. `compact` is an icon button for narrow cards, so the title keeps the width; "auto" shows the
 * icon below 22 rem of card width and the text link from there (the card is a container; see KpiCard `auto`).
 */
export function KpiLink({
  kpi,
  compact = false,
  className,
}: {
  kpi: Kpi;
  compact?: boolean | "auto";
  className?: string;
}) {
  if (compact === "auto")
    return (
      <>
        <KpiLink kpi={kpi} compact className={cn("@[22rem]:hidden", className)} />
        <KpiLink kpi={kpi} className={cn("hidden @[22rem]:inline-flex", className)} />
      </>
    );
  return (
    <Link
      to={kpi.href.to as never}
      {...(kpi.href.search ? { search: kpi.href.search as never } : {})}
      {...(kpi.href.hash ? { hash: kpi.href.hash } : {})}
      aria-label={`Open chart: ${kpi.title}`}
      title={compact ? "Open chart" : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md text-[12px] font-medium text-brand hover:underline focus-visible:outline-2 focus-visible:outline-ring",
        compact ? "size-7 justify-center border border-border hover:bg-accent" : "px-1 py-0.5",
        className,
      )}
    >
      {compact ? (
        <ArrowUpRight className="size-3.5" aria-hidden />
      ) : (
        <>
          Open chart
          <ArrowRight className="size-3" aria-hidden />
        </>
      )}
    </Link>
  );
}

/**
 * One tile. By default the card measures itself: wide enough (22 rem) and the sparkline sits beside the value, narrower
 * and it takes its own row below, with the chart link as an icon, so a tile never crowds at three or four per row.
 */
export function KpiTile({
  state,
  trendPlacement = "auto",
}: {
  state: TileState;
  trendPlacement?: "side" | "below" | "auto";
}) {
  if (state.kind !== "ok")
    return (
      <KpiCard
        as="li"
        label={state.title}
        state={state.kind}
        loadingLabel={`Loading ${state.title}`}
        trend={null}
        errorText="Could not be read just now. The other tiles are unaffected."
        onRetry={state.kind === "error" ? state.retry : undefined}
        emptyText={state.kind === "empty" ? state.reason : undefined}
      />
    );
  const k = state.kpi;
  return (
    <KpiCard
      as="li"
      label={k.title}
      value={k.value}
      unit={k.value && /^[\d,.]+$/.test(k.value) ? k.unit : undefined}
      meta={[k.seriesLabel, k.periodText].filter(Boolean).join(", ") || undefined}
      delta={kpiDelta(k)}
      deltaNote={k.changeNote ?? undefined}
      partial={k.partialNote ?? undefined}
      trendPlacement={trendPlacement}
      trend={
        k.spark
          ? (slot) => (
              <Sparkline
                series={k.spark!.series}
                keys={k.spark!.keys}
                width={slot === "below" ? 200 : 128}
                height={36}
              />
            )
          : undefined
      }
      action={
        <KpiLink
          kpi={k}
          compact={trendPlacement === "auto" ? "auto" : trendPlacement === "below"}
        />
      }
      source={{ source: { label: k.source.label, href: k.source.url } }}
    />
  );
}

/** Starts after the first paint (and an idle moment), so the tiles never hold up the page above them. */
function useAfterFirstPaint(enabled: boolean) {
  const [ready, setReady] = useState(!enabled);
  useEffect(() => {
    if (!enabled) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) {
      w.requestIdleCallback(() => setReady(true));
      return;
    }
    const t = window.setTimeout(() => setReady(true), 200);
    return () => window.clearTimeout(t);
  }, [enabled]);
  return ready;
}

/** The headline KPI row (four live tiles); `deferred` starts the reads after the first paint. */
export function HeadlineTiles({
  deferred = false,
  label = "Headline figures",
}: {
  deferred?: boolean;
  label?: string;
}) {
  const ready = useAfterFirstPaint(deferred);
  const qs = useQueries({
    queries: HEADLINE_BLOCKS.map((id) => ({ ...analyticsBlockQuery(id), enabled: ready })),
  });
  return (
    <KpiGrid columns={4} label={label}>
      {HEADLINE_BLOCKS.map((id, i) => (
        <KpiTile key={id} state={hubTileState(id, qs[i]!)} />
      ))}
    </KpiGrid>
  );
}
