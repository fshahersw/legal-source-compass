import { useId, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MoreToggle } from "@/components/enforcement/parts";
import { fmtInt, shareText } from "./clbFormat";

/** One collapsible section of a panel. The body mounts only when open, so charts measure real widths. */
export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const uid = useId();
  const bodyId = `${uid}-body`;
  return (
    <section aria-label={title} className="border-t border-border/70">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
            aria-hidden
          />
          <span className="shrink-0 text-xs font-semibold">{title}</span>
          {summary ? (
            <span className="min-w-0 truncate text-[11px] font-normal text-muted-foreground">
              {summary}
            </span>
          ) : null}
        </button>
      </h3>
      {open ? (
        <div id={bodyId} className="min-w-0 px-3 pb-3 pt-1">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export type BarRow = {
  key: string;
  label: string;
  count: number;
  sharePct: number | null;
  /** Full text for the hover title (for example the source bit mask). */
  title?: string | undefined;
  /** Court id whose page the label links to; the caller sets it only for a link verified as exact. */
  courtId?: string | undefined;
};

/**
 * Counts as bars, each with its stated share. Bars are scaled to the largest shown count, or, when
 * `whole` is given, to that whole (so a bar's length is the row's share of the stated denominator).
 */
export function ShareBars({
  heading,
  rows,
  note,
  limit = 8,
  noun,
  whole,
}: {
  heading: string;
  rows: readonly BarRow[];
  /** Names the denominator of the shares, so a percentage is never read against the wrong whole. */
  note?: ReactNode;
  limit?: number;
  noun?: string;
  /** The total the shares are of; bar lengths are then proportions of it. */
  whole?: number | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const uid = useId();
  if (!rows.length) return null;
  const shown = expanded ? rows : rows.slice(0, limit);
  const max = Math.max(1, ...shown.map((r) => r.count));
  const scale = whole != null && whole > 0 ? whole : max;
  return (
    <div className="min-w-0">
      <h4 className="text-xs font-medium">{heading}</h4>
      {note ? <p className="mb-1.5 text-[11px] leading-4 text-muted-foreground">{note}</p> : null}
      <ul id={uid} className="space-y-1.5">
        {shown.map((r) => (
          <li key={r.key} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 break-words leading-4" title={r.title ?? r.label}>
                {r.courtId ? (
                  <Link
                    to="/courts/$id"
                    params={{ id: r.courtId }}
                    className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {fmtInt(r.count)}
                {r.sharePct != null ? ` · ${shareText(r)}` : ""}
              </span>
            </div>
            <div className="mt-0.5 h-1 rounded-sm bg-muted" aria-hidden>
              <div
                className="h-1 rounded-sm bg-primary/80"
                style={{
                  width: `${Math.min(100, (r.count / scale) * 100)}%`,
                  ...(whole != null && r.count > 0 ? { minWidth: "2px" } : {}),
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <MoreToggle
        total={rows.length}
        limit={limit}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        controls={uid}
        noun={noun}
      />
    </div>
  );
}

/** A labelled figure in a compact definition list. */
export function Fact({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-4 text-muted-foreground">{label}</dt>
      <dd className="break-words font-mono text-[13px] font-semibold tabular-nums leading-5">
        {value}
      </dd>
      {note ? <dd className="text-[11px] leading-4 text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

/** A name that links to an internal record or, failing that, to an external page; plain text otherwise. */
export function RecordLink({
  dataset,
  id,
  children,
}: {
  dataset: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <Link
      to="/records/$dataset/$id"
      params={{ dataset, id }}
      className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
    </Link>
  );
}

/** Caption + chart frame with a text alternative for the chart. */
export function ChartFrame({
  caption,
  label,
  height = "h-44",
  children,
  footnote,
}: {
  caption: string;
  /** Text alternative describing what the chart shows. */
  label: string;
  height?: string;
  children: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <figure className="min-w-0">
      <figcaption className="text-xs font-medium">{caption}</figcaption>
      <div role="img" aria-label={label} className={cn("w-full", height)}>
        {children}
      </div>
      {footnote ? (
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{footnote}</p>
      ) : null}
    </figure>
  );
}
