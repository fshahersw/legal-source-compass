import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, ChevronDown, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { dailyInsightQuery, formatDayKey } from "./insightQueries";
import type { Insight, InsightPoint, SectionInsight } from "@/lib/insights/types";

export type InsightVariant = "section" | "compact";

/**
 * The insight of the day for one analytics section: a few sentences, major points, caveat and sources, with the
 * other insights in the section's pool one click away. Every figure comes from a published corpus row (see
 * lib/insights); nothing is written by a model. The day comes from the server result, never from a client clock.
 */
export function DailyInsightCard({
  section,
  variant = "section",
  className,
}: {
  section: string;
  variant?: InsightVariant;
  className?: string;
}) {
  const q = useQuery(dailyInsightQuery(section));
  if (q.isLoading) return <InsightSkeleton className={className} />;
  const found = q.data?.sections.find((s) => s.section === section);
  if (q.isError || (q.data && !found))
    return <InsightError onRetry={() => void q.refetch()} className={className} />;
  if (!q.data || !found) return <InsightSkeleton className={className} />;
  return (
    <InsightPanel
      data={found}
      dayKey={q.data.dayKey}
      variant={variant}
      onRetry={() => void q.refetch()}
      className={className}
    />
  );
}

/** Presentational card for one already-loaded section (used by the hub, which loads every section in one request). */
export function InsightPanel({
  data,
  dayKey,
  variant,
  onRetry,
  className,
}: {
  data: SectionInsight;
  dayKey: string;
  variant: InsightVariant;
  onRetry: () => void;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const pick = data.pick;
  const label = `Insight of the day: ${data.title}`;
  const Headline = variant === "compact" ? "h3" : "h2";

  if (data.failed)
    return <InsightError onRetry={onRetry} className={className} title={data.title} />;

  if (!pick)
    return (
      <Shell label={label} className={className}>
        <Header data={data} dayKey={dayKey} variant={variant} />
        <p role="status" className="px-3 py-3 text-xs text-muted-foreground">
          No insight available for this section yet: the data behind it is not published.
        </p>
      </Shell>
    );

  return (
    <Shell label={label} className={className}>
      <Header data={data} dayKey={dayKey} variant={variant} />
      <article className="space-y-2 px-3 pb-2.5 pt-2">
        <Headline className="max-w-4xl text-sm font-semibold leading-5">{pick.headline}</Headline>
        <p className="max-w-4xl text-xs leading-5 text-foreground/90">{pick.summary.join(" ")}</p>
        <Points points={pick.points} />
        {pick.caveat ? (
          <p className="max-w-4xl text-[11px] leading-4 text-muted-foreground">
            Note: {pick.caveat}
          </p>
        ) : null}
        <Sources pick={pick} />
        {data.partial ? (
          <p role="status" className="text-[11px] leading-4 text-muted-foreground">
            Some data sources for this section could not be read just now; this insight is chosen
            from the rest.
          </p>
        ) : null}
      </article>
      <footer className="border-t border-border/70 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span>
            Insight {data.position} of {data.poolSize} for {data.title} · changes daily (UTC)
          </span>
          {data.headlines.length ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-0.5 rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Other insights in this section ({data.headlines.length})
              <ChevronDown
                className={cn("size-3 transition-transform", open && "rotate-180")}
                aria-hidden
              />
            </button>
          ) : null}
        </div>
        {data.headlines.length ? (
          <ul id={listId} hidden={!open} className="mt-1.5 list-disc space-y-0.5 pl-4">
            {data.headlines.map((h, i) => (
              <li key={`${i}-${h}`} className="text-foreground/80">
                {h}
              </li>
            ))}
          </ul>
        ) : null}
      </footer>
    </Shell>
  );
}

function Shell({
  label,
  className,
  children,
}: {
  label: string;
  className: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section
      role="region"
      aria-label={label}
      className={cn(
        "min-w-0 overflow-hidden rounded-md border border-border bg-surface",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function InsightError({
  onRetry,
  className,
  title,
}: {
  onRetry: () => void;
  className?: string | undefined;
  title?: string;
}) {
  return (
    <Shell label={`Insight of the day${title ? `: ${title}` : ""}`} className={className}>
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 px-3 py-3 text-xs text-destructive"
      >
        {title ? `${title}: the` : "The"} insight of the day could not be loaded.
        <button
          type="button"
          onClick={onRetry}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      </div>
    </Shell>
  );
}

export function InsightSkeleton({ className }: { className?: string | undefined }) {
  return (
    <section
      aria-busy="true"
      aria-label="Loading the insight of the day"
      className={cn(
        "min-h-44 space-y-2 rounded-md border border-border bg-surface px-3 py-3",
        className,
      )}
    >
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
    </section>
  );
}

function Header({
  data,
  dayKey,
  variant,
}: {
  data: SectionInsight;
  dayKey: string;
  variant: InsightVariant;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/70 px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <CalendarDays className="size-3.5 shrink-0" aria-hidden />
        {variant === "compact" ? (
          <span className="truncate text-xs font-semibold text-foreground">{data.title}</span>
        ) : (
          <span className="font-medium uppercase tracking-wide">Insight of the day</span>
        )}
        <span aria-hidden>·</span>
        <time dateTime={dayKey}>{formatDayKey(dayKey)} (UTC)</time>
      </div>
      {variant === "compact" ? (
        <Link
          to={data.href}
          className="inline-flex items-center gap-0.5 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {data.chartsLabel}
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function PointLabel({ point }: { point: InsightPoint }) {
  const cls =
    "break-words rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring";
  if (!point.href) return <>{point.label}</>;
  return point.href.startsWith("/") ? (
    <Link to={point.href} className={cls}>
      {point.label}
    </Link>
  ) : (
    <a href={point.href} target="_blank" rel="noreferrer" className={cls}>
      {point.label}
    </a>
  );
}

/** Drops exact repeats (same identity key), keeping the first occurrence and the original order. */
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function Points({ points }: { points: InsightPoint[] }) {
  return (
    <dl className="grid max-w-4xl grid-cols-1 gap-x-8 sm:grid-cols-2">
      {uniqueBy(points, (p) => `${p.label}|${p.value}|${p.note ?? ""}|${p.href ?? ""}`).map(
        (p, i) => (
          <div
            key={`${i}-${p.label}`}
            className="min-w-0 border-t border-border/60 py-1 first:border-t-0 sm:nth-[2]:border-t-0"
          >
            <dt className="break-words text-[11px] leading-4 text-muted-foreground">
              <PointLabel point={p} />
            </dt>
            <dd className="break-words font-mono text-[13px] font-semibold leading-5">
              {p.value}
              {p.note ? (
                <span className="ml-1.5 font-sans text-[11px] font-normal text-muted-foreground">
                  {p.note}
                </span>
              ) : null}
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

function Sources({ pick }: { pick: Insight }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] leading-4 text-muted-foreground">
      <span>Sources:</span>
      {uniqueBy(pick.sources, (s) => `${s.href}|${s.label}`).map((s, i) =>
        s.href.startsWith("/") ? (
          <Link
            key={`${i}-${s.href}`}
            to={s.href}
            className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {s.label}
          </Link>
        ) : (
          <a
            key={`${i}-${s.href}`}
            href={s.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {s.label}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ),
      )}
      {pick.dataThrough ? <span>Data through {pick.dataThrough}</span> : null}
    </p>
  );
}
