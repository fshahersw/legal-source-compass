import { ExternalLink, Lock } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A titled block of a matter page. */
export function Panel({
  id,
  title,
  note,
  aside,
  children,
  className,
}: {
  id?: string;
  title: string;
  note?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn(
        "scroll-mt-44 rounded-lg border border-border bg-surface shadow-card",
        className,
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2
            id={id ? `${id}-title` : undefined}
            className="font-display text-[15px] font-semibold leading-tight"
          >
            {title}
          </h2>
          {note ? (
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{note}</p>
          ) : null}
        </div>
        {aside ? (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            {aside}
          </div>
        ) : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function NotRecorded() {
  return <span className="text-muted-foreground">Not recorded</span>;
}

/** A label/value pair for dl grids; unknown values render as "Not recorded". */
export function Fact({ label, children }: { label: string; children?: ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-[13px] leading-snug">
        {empty ? <NotRecorded /> : children}
      </dd>
    </div>
  );
}

export function StatTile({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-display text-[22px] leading-none tabular-nums">{value}</div>
      {note ? (
        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{note}</div>
      ) : null}
    </div>
  );
}

/** What a list is and is not; every source-limited list carries one. */
export function Scope({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      role="note"
      className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground"
    >
      {title ? <span className="mr-1 font-semibold text-foreground">{title}.</span> : null}
      {children}
    </div>
  );
}

/** Held means status is unconfirmed or restricted: listed, never linked. */
export function HeldBadge({ reason }: { reason?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning-foreground"
      title={
        reason ?? "Held: the seal or availability status is not confirmed, so no link is provided."
      }
    >
      <Lock className="size-3" aria-hidden />
      Held
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning";
  title?: string | undefined;
}) {
  const tones = {
    neutral: "border-border bg-muted text-muted-foreground",
    primary: "border-primary/25 bg-primary/10 text-primary",
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/50 bg-warning/10 text-warning-foreground",
  } as const;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium leading-tight",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function LinkOut({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-md border border-border bg-background p-0.5 text-[12px]"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2.5 py-1 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
            value === o.value
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Prev/next over a server-paged or client-paged list. `total` null means unknown. */
export function RangePager({
  offset,
  pageSize,
  shown,
  total,
  capped,
  onOffset,
}: {
  offset: number;
  pageSize: number;
  shown: number;
  total: number | null;
  capped?: boolean;
  onOffset: (offset: number) => void;
}) {
  const from = shown ? offset + 1 : 0;
  const to = offset + shown;
  const hasNext = total !== null ? to < total : shown >= pageSize;
  return (
    <nav
      aria-label="Pagination"
      className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground"
    >
      <span>
        {shown ? (
          <>
            Showing{" "}
            <span className="font-medium text-foreground tabular-nums">
              {from.toLocaleString()}–{to.toLocaleString()}
            </span>
            {total !== null ? (
              <>
                {" "}
                of{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {total.toLocaleString()}
                  {capped ? "+" : ""}
                </span>
              </>
            ) : null}
          </>
        ) : (
          "No rows"
        )}
      </span>
      <span className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={offset === 0}
          onClick={() => onOffset(Math.max(0, offset - pageSize))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!hasNext}
          onClick={() => onOffset(offset + pageSize)}
        >
          Next
        </Button>
      </span>
    </nav>
  );
}

export const selectClass =
  "h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <p role="status" className="py-6 text-center text-[13px] text-muted-foreground">
      Loading {what}…
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
      {children}
    </p>
  );
}

/** Table shell: horizontal scroll on narrow screens, compact rows. `narrow` drops the minimum width for small tables. */
export function DataTable({
  caption,
  children,
  narrow = false,
}: {
  caption: string;
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    // `relative` keeps absolutely positioned descendants (sr-only text) inside the scroller instead of widening the page.
    <div className="relative overflow-x-auto rounded-md border border-border">
      <table className={cn("w-full border-collapse text-[12px]", narrow ? "" : "min-w-[40rem]")}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const th =
  "whitespace-nowrap bg-muted/60 px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
export const td = "border-t border-border px-2.5 py-1.5 align-top";
