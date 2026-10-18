import { useState, type MouseEvent, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { Takeaway } from "@/components/analysis/analysisFormat";
import { cn } from "@/lib/utils";
import { openAndJump } from "./openSection";

/**
 * Shared building blocks for the state page's data panels. The panels sit in a 19rem column on wide screens and
 * full width below that, so wide layouts switch on the panel's own width (`@container`), not the viewport's.
 */

/**
 * A collapsed section (native <details>). Its body mounts only while open, so charts measure a real width and a
 * closed section costs nothing.
 */
export function PanelSection({
  id,
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  id?: string;
  title: string;
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      id={id}
      open={defaultOpen ? true : undefined}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group scroll-mt-4 border-t border-border/70"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        <span className="min-w-0 flex-1">{title}</span>
        {hint ? (
          <span className="shrink-0 text-[10.5px] font-normal text-muted-foreground">{hint}</span>
        ) : null}
      </summary>
      {open ? <div className="space-y-3 px-3 pb-3 pt-1">{children}</div> : null}
    </details>
  );
}

/** Two columns in a narrow panel; `wide` columns once the panel is wide (3 for six or three stats, 4 for four). */
export function StatGrid({
  label,
  children,
  wide = 3,
}: {
  label: string;
  children: ReactNode;
  wide?: 3 | 4;
}) {
  return (
    <div className="overflow-hidden border-t border-border/70">
      <dl
        aria-label={label}
        className={cn(
          "-mb-px -mr-px grid grid-cols-2",
          wide === 4 ? "@xl:grid-cols-4" : "@xl:grid-cols-3",
        )}
      >
        {children}
      </dl>
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="min-w-0 border-b border-r border-border/70 bg-surface px-3 py-1.5">
      <dt className="text-[10.5px] leading-tight text-muted-foreground">{label}</dt>
      <dd className="break-words font-mono text-[13px] font-semibold leading-snug">{value}</dd>
      {note ? <dd className="text-[10.5px] leading-tight text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[10.5px] leading-snug text-muted-foreground", className)}>{children}</p>
  );
}

/** One line per takeaway: figure, what it measures, and a link that opens the section it comes from. */
export function TakeawayList({
  items,
  scope,
}: {
  items: readonly Takeaway[];
  scope?: string | undefined;
}) {
  if (items.length < 2) return null;
  const jump = (anchor: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (openAndJump(anchor)) e.preventDefault();
  };
  return (
    <section aria-label="Key takeaways">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-3 pt-2">
        <h3 className="text-xs font-semibold">Key takeaways</h3>
        {scope ? <span className="text-[10.5px] text-muted-foreground">{scope}</span> : null}
      </div>
      <ul className="divide-y divide-border/60 pb-1">
        {items.map((t) => (
          <li key={t.id} className="px-3 py-1.5 text-xs leading-4">
            <span className="font-mono text-[13px] font-semibold tabular-nums">{t.figure}</span>{" "}
            <span className="text-muted-foreground">{t.text}</span>
            {t.anchor ? (
              <>
                {" "}
                <a
                  href={`#${t.anchor}`}
                  onClick={jump(t.anchor)}
                  className="whitespace-nowrap text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {t.anchorLabel ?? "See the data"}
                </a>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export type Column<T> = {
  id: string;
  header: string;
  align?: "left" | "right";
  cell: (row: T) => ReactNode;
  /**
   * In the compact list: the left title, the right-hand value, or a labelled detail on the second line. A cell
   * that returns null is not applicable for that row: the table shows a dash and the list leaves the detail out.
   */
  role?: "title" | "value" | "detail";
};

/**
 * A table where the panel is wide and a two-line list where it is narrow, built from one column definition so the
 * two layouts always carry the same figures.
 */
export function ResponsiveTable<T>({
  caption,
  rows,
  columns,
  rowKey,
}: {
  caption: string;
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
}) {
  const title = columns.find((c) => c.role === "title") ?? columns[0];
  const value = columns.find((c) => c.role === "value");
  if (!title) return null;
  const details = columns.filter((c) => c !== title && c !== value);
  return (
    <>
      <div className="hidden overflow-x-auto @xl:block">
        <table className="w-full text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={cn("px-2 py-1.5 font-medium", c.align === "right" && "text-right")}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cn(
                      "px-2 py-1",
                      c.align === "right" && "text-right font-mono",
                      c === title && "max-w-72",
                    )}
                  >
                    {c.cell(r) ?? <span aria-label="Not applicable">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border/60 @xl:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="py-1.5">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 break-words">{title.cell(r)}</span>
              {value ? <span className="shrink-0 font-mono">{value.cell(r)}</span> : null}
            </div>
            {details.length ? (
              <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">
                {details.map((c) => {
                  const cell = c.cell(r);
                  return cell == null ? null : (
                    <span key={c.id} className="mr-2.5 inline-block">
                      {c.header} <span className="tabular-nums text-foreground">{cell}</span>
                    </span>
                  );
                })}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

export function PanelState({
  tone = "muted",
  children,
  action,
}: {
  tone?: "muted" | "error";
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center gap-x-2 px-3 py-3 text-xs",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
      {action}
    </div>
  );
}

/** Retry control used by the panels' error and partial states. */
export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      Retry
    </button>
  );
}
