import { useId, useState, lazy, Suspense } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ExternalLink,
  Minus,
  RefreshCw,
  Table2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BlockDef } from "@/lib/analytics/registry";
import {
  changeDirection,
  formatChange,
  formatCount,
  formatValue,
  longDate,
  type TrendBlockData,
} from "@/lib/analytics/trend";
import { chartTokens } from "@/components/charts/palette";
import { seriesColor, tableRows } from "./chartData";
import { analyticsBlockQuery } from "./blockQuery";

// The chart library is loaded on demand, so the page shell and every block's text appear first.
const TrendChart = lazy(() => import("./TrendChart").then((m) => ({ default: m.TrendChart })));

export type CardState =
  | { kind: "loading" }
  | { kind: "error"; onRetry: () => void }
  | { kind: "empty"; reason: string }
  | { kind: "ok"; block: TrendBlockData };

/** One block, loading its own data so a slow or failing source never holds back the others. */
export function TrendCard({ def }: { def: BlockDef }) {
  const q = useQuery(analyticsBlockQuery(def.id));
  const state: CardState = q.isPending
    ? { kind: "loading" }
    : q.isError
      ? { kind: "error", onRetry: () => void q.refetch() }
      : q.data.status === "ok"
        ? { kind: "ok", block: q.data.data }
        : { kind: "empty", reason: q.data.reason };
  return <TrendCardView def={def} state={state} />;
}

function DetailLink({ def, className }: { def: BlockDef; className?: string }) {
  return (
    <Link
      to={def.detail.to as never}
      {...(def.detail.search ? { search: def.detail.search as never } : {})}
      className={cn(
        "inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      {def.detail.label}
      <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}

function Frame({
  def,
  period,
  children,
  busy,
}: {
  def: BlockDef;
  period?: string | undefined;
  children: React.ReactNode;
  busy?: boolean;
}) {
  return (
    <section
      id={`block-${def.id}`}
      aria-labelledby={`block-${def.id}-title`}
      {...(busy ? { "aria-busy": true } : {})}
      className="flex min-w-0 scroll-mt-4 flex-col rounded-md border border-border bg-surface"
      style={chartTokens}
    >
      <header className="border-b border-border/70 px-3 py-2">
        <h3 id={`block-${def.id}-title`} className="text-sm font-semibold leading-5">
          {def.title}
        </h3>
        {period ? <p className="text-[11px] leading-4 text-muted-foreground">{period}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Latest({ block }: { block: TrendBlockData }) {
  const latest = block.latest;
  if (!latest)
    return (
      <p className="px-3 pt-2 text-xs text-muted-foreground">
        No complete period is recorded, so no latest value is shown.
      </p>
    );
  const change = latest.change;
  const direction = change ? changeDirection(change) : null;
  const Arrow = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;
  return (
    <div className="px-3 pt-2">
      <p className="text-[11px] leading-4 text-muted-foreground">
        {latest.seriesLabel}, {latest.period}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-xl font-semibold leading-7 tabular-nums">
          {formatValue(latest.value, block.format)}
        </span>
        {block.format === "count" ? (
          <span className="text-xs text-muted-foreground">{block.unit}</span>
        ) : null}
      </p>
      {change ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Arrow className="size-3 shrink-0" aria-hidden />
          <span>{formatChange(change, block.format)}</span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{latest.changeNote}</p>
      )}
    </div>
  );
}

function Legend({ block }: { block: TrendBlockData }) {
  if (block.series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 pt-2 text-[11px] text-muted-foreground">
      {block.series.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={
              block.chart === "line"
                ? "inline-block h-0.5 w-3 rounded-full"
                : "inline-block size-2 rounded-[2px]"
            }
            style={{ background: seriesColor(i) }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function DataTable({ block, measure }: { block: TrendBlockData; measure: string }) {
  const rows = tableRows(block);
  return (
    <div
      role="region"
      aria-label={`Data table: ${measure}`}
      tabIndex={0}
      className="max-h-56 overflow-auto border-t border-border/70 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <table className="w-full border-collapse text-[11px]">
        <caption className="sr-only">
          {measure}, {block.period}. Values are {block.unit}; a period the source does not record is
          marked Not recorded.
        </caption>
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left text-muted-foreground">
            <th scope="col" className="px-3 py-1 font-medium">
              Period
            </th>
            {block.series.map((s) => (
              <th key={s.id} scope="col" className="px-2 py-1 text-right font-medium">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period} className="border-b border-border/50 last:border-0">
              <th scope="row" className="px-3 py-0.5 text-left font-normal">
                {r.period}
              </th>
              {r.cells.map((c, i) => (
                <td
                  key={block.series[i]!.id}
                  className={cn(
                    "px-2 py-0.5 text-right tabular-nums",
                    c === "Not recorded" && "text-muted-foreground",
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Loaded({ def, block }: { def: BlockDef; block: TrendBlockData }) {
  const [showData, setShowData] = useState(false);
  const tableId = useId();
  const partial = block.series.some((s) => s.points.some((p) => p.partial));
  return (
    <>
      <Latest block={block} />
      <Legend block={block} />
      <div className="px-2 pt-1">
        <Suspense fallback={<Skeleton className="mx-1 h-40" aria-label="Loading chart" />}>
          <TrendChart block={block} measure={def.measure} />
        </Suspense>
      </div>
      {partial || block.gaps > 0 ? (
        <p className="px-3 pb-1 text-[11px] leading-4 text-muted-foreground">
          {partial ? "* Partial period: drawn dashed or hatched." : null}
          {partial && block.gaps > 0 ? " " : null}
          {block.gaps > 0
            ? `${formatCount(block.gaps)} period${block.gaps === 1 ? "" : "s"} not recorded, left as gaps (not zero).`
            : null}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 pb-2">
        <button
          type="button"
          aria-expanded={showData}
          aria-controls={tableId}
          onClick={() => setShowData((v) => !v)}
          className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Table2 className="size-3" aria-hidden />
          {showData ? "Hide data" : "Show data"}
        </button>
        <DetailLink def={def} />
      </div>
      <div id={tableId} hidden={!showData}>
        {showData ? <DataTable block={block} measure={def.measure} /> : null}
      </div>
      {block.notes.length ? (
        <details className="border-t border-border/70 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
          <summary className="cursor-pointer select-none text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            How to read this
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {block.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <footer className="mt-auto border-t border-border/70 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
        <p>
          Source:{" "}
          <a
            href={block.source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"
          >
            {block.source.label}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </p>
        <p>
          Period: {block.period}
          {block.asOf ? ` · data through ${longDate(block.asOf)}` : ""}
        </p>
      </footer>
    </>
  );
}

/** Presentational card: every state (loading, error, empty, loaded) of one block. */
export function TrendCardView({ def, state }: { def: BlockDef; state: CardState }) {
  if (state.kind === "loading")
    return (
      <Frame def={def} busy>
        <div className="space-y-2 px-3 py-2" role="status" aria-label={`Loading ${def.measure}`}>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Frame>
    );
  if (state.kind === "error")
    return (
      <Frame def={def}>
        <div role="alert" className="space-y-2 px-3 py-3 text-xs">
          <p className="text-destructive">
            This block could not be read just now. The other blocks are unaffected.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" variant="outline" onClick={state.onRetry}>
              <RefreshCw className="size-3" aria-hidden />
              Retry
            </Button>
            <DetailLink def={def} />
          </div>
        </div>
      </Frame>
    );
  if (state.kind === "empty")
    return (
      <Frame def={def}>
        <div role="status" className="space-y-2 px-3 py-3 text-xs text-muted-foreground">
          <p>{state.reason}</p>
          <DetailLink def={def} />
        </div>
      </Frame>
    );
  return (
    <Frame def={def} period={`${capitalize(state.block.unit)} · ${state.block.period}`}>
      <Loaded def={def} block={state.block} />
    </Frame>
  );
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
