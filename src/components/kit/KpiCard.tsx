/**
 * KPI cards: label, value (sans, tabular figures), unit, a delta pill with a direction icon, an optional mini trend,
 * a footnote, a partial-period pill and a source footer.
 *
 *   <KpiCard label="Federal civil cases filed" value="303,716" unit="cases" meta="United States, FY2025"
 *     delta={{ value: 4.4, text: "+4.4%", detail: "+12,700 vs FY2024" }}
 *     trend={<Sparkline … width={128} height={36} />}
 *     partial="FY2026 is a partial period (277k so far) and is not the latest value."
 *     source={{ source: { label: "FJC Integrated Database", href }, about: <p>…</p> }} />
 *
 *   <KpiGrid columns={6}>{…KpiCard as="li"…}</KpiGrid>   // a row of separate cards
 *   <KpiStrip items={[…KpiCard props…]} />              // one card, cells divided by hairlines
 *
 * The delta pill is neutral (grey) unless the metric has an agreed good direction (`goodDirection`), so a rise in
 * filings, recalls or complaints is never painted good or bad by default. A value of null reads "Not recorded".
 */
import type { ElementType, ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Card, CardFooter, SourceFooter, type SourceFooterProps } from "./Card";
import {
  deltaDirection,
  deltaTone,
  directionLabel,
  formatSigned,
  formatSignedPercent,
  type GoodDirection,
} from "./format";
import { PartialPill } from "./StatusPill";
import { TONE_CLASS, pillBase } from "./styles";

export type KpiDelta = {
  /** Signed change; only its sign is used for the direction (absolute or percent). */
  value: number | null;
  /** Pill text as the data model prints it ("+4.4%"); formatted from `value` when absent. */
  text?: string | null | undefined;
  /** How `value` is printed when `text` is absent. */
  kind?: "percent" | "absolute" | undefined;
  /** The rest of the change beside the pill ("+12,700 vs FY2024"). */
  detail?: ReactNode | undefined;
  /** The agreed good direction of this metric; absent keeps the pill neutral. */
  goodDirection?: GoodDirection | null | undefined;
};

export function DeltaPill({
  delta,
  className,
}: {
  delta: KpiDelta;
  className?: string | undefined;
}) {
  const direction = deltaDirection(delta.value);
  const tone = deltaTone(direction, delta.goodDirection);
  const text =
    delta.text ??
    (delta.value == null
      ? ""
      : delta.kind === "absolute"
        ? formatSigned(delta.value)
        : formatSignedPercent(delta.value));
  const Icon =
    direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;
  if (!text) return null;
  return (
    <span
      className={cn(
        pillBase,
        TONE_CLASS[tone === "good" ? "good" : tone === "bad" ? "critical" : "neutral"],
        "tabular-nums",
        className,
      )}
    >
      {direction ? <Icon className="size-3 shrink-0" aria-hidden strokeWidth={2.25} /> : null}
      <span className="sr-only">{directionLabel(direction)} </span>
      {text}
    </span>
  );
}

export type KpiCardProps = {
  label: ReactNode;
  /** The figure as printed ("303,716", "$3.94 billion"); null or undefined shows "Not recorded". */
  value?: ReactNode | undefined;
  unit?: ReactNode | undefined;
  /** One line under the value: entity and period ("United States, FY2025"). */
  meta?: ReactNode | undefined;
  delta?: KpiDelta | null | undefined;
  /** Why no change is shown, when there is no delta. */
  deltaNote?: ReactNode | undefined;
  footnote?: ReactNode | undefined;
  /** Partial-period note: shows the "Partial" pill with the note in its popover. */
  partial?: ReactNode | undefined;
  /** Mini trend slot (e.g. a Sparkline at least 120 × 32). */
  trend?: ReactNode | undefined;
  /** Header action, e.g. an "Open chart" link. */
  action?: ReactNode | undefined;
  /** Footer line; omit for a card without a footer. */
  source?: SourceFooterProps | null | undefined;
  state?: "ready" | "loading" | "error" | "empty" | undefined;
  /** Message for the empty state ("No national value is published."). */
  emptyText?: ReactNode | undefined;
  errorText?: ReactNode | undefined;
  onRetry?: (() => void) | undefined;
  size?: "md" | "sm" | undefined;
  as?: ElementType | undefined;
  className?: string | undefined;
  /** Renders without the card chrome (used by KpiStrip cells). */
  bare?: boolean | undefined;
  /** Accessible label for the value region in the loading state. */
  loadingLabel?: string | undefined;
  /** Element of the label: a paragraph by default, a heading where KPIs are a document section of their own. */
  labelAs?: "p" | "h3" | "h4" | undefined;
};

function Value({ value, unit, size }: { value: ReactNode; unit: ReactNode; size: "md" | "sm" }) {
  if (value == null || value === "")
    return <p className="text-sm font-medium text-muted-foreground">Not recorded</p>;
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <span className={cn(size === "md" ? "text-kpi" : "text-kpi-sm", "tabular-nums")}>
        {value}
      </span>
      {unit ? <span className="text-meta text-muted-foreground">{unit}</span> : null}
    </p>
  );
}

export function KpiCard({
  label,
  value,
  unit,
  meta,
  delta,
  deltaNote,
  footnote,
  partial,
  trend,
  action,
  source,
  state = "ready",
  emptyText,
  errorText = "Could not be read just now.",
  onRetry,
  size = "md",
  as = "div",
  className,
  bare = false,
  loadingLabel,
  labelAs: Label = "p",
}: KpiCardProps) {
  const Shell = bare ? (as as ElementType) : Card;
  const shellProps = bare ? {} : { as };
  const pad = size === "md" ? "px-4" : "px-3.5";
  const header = (
    <div
      className={cn(
        "flex items-start justify-between gap-2",
        pad,
        size === "md" ? "pt-3.5" : "pt-3",
      )}
    >
      <Label
        className="m-0 line-clamp-2 min-w-0 text-[13px] font-medium leading-5 text-foreground/80"
        title={typeof label === "string" ? label : undefined}
      >
        {label}
      </Label>
      {action && state === "ready" ? <div className="-mr-1 shrink-0">{action}</div> : null}
    </div>
  );
  if (state !== "ready")
    return (
      <Shell
        {...shellProps}
        className={cn("flex min-w-0 flex-col", className)}
        {...(state === "loading" ? { "aria-busy": true } : {})}
      >
        {header}
        <div className={cn(pad, "pb-4 pt-2")}>
          {state === "loading" ? (
            <div role="status" aria-label={loadingLabel ?? "Loading"} className="space-y-2">
              <Skeleton className={size === "md" ? "h-8 w-28" : "h-6 w-20"} />
              <Skeleton className="h-4 w-36" />
              {trend !== undefined ? <Skeleton className="h-8 w-full" /> : null}
            </div>
          ) : state === "error" ? (
            <div role="alert" className="space-y-1.5 text-meta text-status-critical-ink">
              <p>{errorText}</p>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1 rounded-md font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <RefreshCw className="size-3" aria-hidden />
                  Retry
                </button>
              ) : null}
            </div>
          ) : (
            <p role="status" className="text-meta text-muted-foreground">
              {emptyText ?? "Not recorded"}
            </p>
          )}
        </div>
      </Shell>
    );
  return (
    <Shell {...shellProps} className={cn("flex min-w-0 flex-col", className)}>
      {header}
      <div className={cn("flex items-end justify-between gap-3", pad, "pt-1.5")}>
        <div className="min-w-0">
          <Value value={value} unit={unit} size={size} />
        </div>
        {trend ? <div className="mb-1 shrink-0">{trend}</div> : null}
      </div>
      {delta || deltaNote ? (
        <div className={cn("mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1", pad)}>
          {delta ? <DeltaPill delta={delta} /> : null}
          {delta?.detail ? (
            <span className="text-meta text-muted-foreground tabular-nums">{delta.detail}</span>
          ) : null}
          {!delta && deltaNote ? (
            <span className="text-meta text-muted-foreground">{deltaNote}</span>
          ) : null}
        </div>
      ) : null}
      {meta || partial ? (
        <div className={cn("mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1", pad)}>
          {meta ? <span className="text-meta text-muted-foreground">{meta}</span> : null}
          {partial ? <PartialPill note={partial} /> : null}
        </div>
      ) : null}
      {footnote ? (
        <div className={cn("mt-1 text-meta text-muted-foreground", pad)}>{footnote}</div>
      ) : null}
      <div className={cn("mt-auto", size === "md" ? "pt-3.5" : "pt-3")} />
      {source ? (
        bare ? (
          <div className={cn(pad, "pb-3")}>
            <SourceFooter {...source} />
          </div>
        ) : (
          <CardFooter>
            <SourceFooter {...source} className="flex-1" />
          </CardFooter>
        )
      ) : null}
    </Shell>
  );
}

const GRID_COLS: Record<2 | 3 | 4 | 5 | 6, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
};

/** A row of separate KPI cards (children are KpiCards with as="li"). */
export function KpiGrid({
  columns = 4,
  label,
  className,
  children,
}: {
  columns?: 2 | 3 | 4 | 5 | 6 | undefined;
  label?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <ul
      aria-label={label}
      className={cn("m-0 grid list-none gap-3 p-0", GRID_COLS[columns], className)}
    >
      {children}
    </ul>
  );
}

/**
 * One card holding several KPIs as cells divided by hairlines. Cells grow to fill their row, so an uneven count
 * never leaves an empty cell.
 */
export function KpiStrip({
  items,
  label,
  className,
  cellBasis = "basis-[calc(50%-1px)] sm:basis-[calc(33.333%-1px)] xl:basis-[calc(16.666%-1px)]",
}: {
  items: readonly (KpiCardProps & { key: string })[];
  label?: string | undefined;
  className?: string | undefined;
  /** Tailwind basis classes for the cells (default: 2, 3 or 6 per row). */
  cellBasis?: string | undefined;
}) {
  return (
    <section
      aria-label={label}
      className={cn("overflow-hidden rounded-xl border border-border shadow-xs", className)}
    >
      <ul className="m-0 flex list-none flex-wrap gap-px bg-border p-0">
        {items.map(({ key, ...item }) => (
          <KpiCard
            key={key}
            size="sm"
            {...item}
            bare
            as="li"
            className={cn("min-w-0 grow bg-card", cellBasis, item.className)}
          />
        ))}
      </ul>
    </section>
  );
}
