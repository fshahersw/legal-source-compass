/**
 * Layout primitives of the analyst-console pages: a 12-column panel grid, a span helper, a compact section heading
 * and a plain data table in the console style. Pure presentation; every figure comes from the caller.
 */
import type { ReactNode } from "react";
import type { ChartStatus } from "@/components/charts";
import { cn } from "@/lib/utils";

export type Span = 3 | 4 | 5 | 6 | 7 | 8 | 12;

const SPAN: Record<Span, string> = {
  3: "col-span-12 sm:col-span-6 xl:col-span-3",
  4: "col-span-12 lg:col-span-6 xl:col-span-4",
  5: "col-span-12 xl:col-span-5",
  6: "col-span-12 xl:col-span-6",
  7: "col-span-12 xl:col-span-7",
  8: "col-span-12 xl:col-span-8",
  12: "col-span-12",
};

export function ConsoleGrid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("grid grid-cols-12 gap-3", className)}>{children}</div>;
}

export function Cell({
  span,
  className,
  children,
}: {
  span: Span;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("min-w-0 [&>*]:h-full", SPAN[span], className)}>{children}</div>;
}

/** Small-caps label, a heading and one line of context, above a group of panels. */
export function ConsoleHeading({
  id,
  eyebrow,
  title,
  description,
  actions,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pt-2">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow m-0">{eyebrow}</p> : null}
        <h2 id={id} className="m-0 text-heading text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="m-0 mt-0.5 max-w-[90ch] text-[12.5px] leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type ConsoleColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  className?: string;
};

/** Dense table: uppercase small headers, hairline rows, right-aligned figures. */
export function ConsoleTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty = "Not recorded.",
}: {
  columns: readonly ConsoleColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  caption: string;
  empty?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px] tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "whitespace-nowrap border-b border-border px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground",
                  c.align === "right" ? "text-right" : "text-left",
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r) => (
              <tr key={rowKey(r)} className="hover:bg-muted/60">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "border-b border-border/60 px-2 py-1.5 align-middle",
                      c.align === "right" ? "text-right" : "text-left",
                      c.className,
                    )}
                  >
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-2 py-6 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Chart status from a react-query result and whether a view could be built. */
export function queryStatus(
  q: { isLoading: boolean; isError: boolean; refetch: () => unknown },
  ready: boolean,
  emptyReason: string,
): ChartStatus {
  if (q.isLoading) return { kind: "loading" };
  if (q.isError) return { kind: "error", onRetry: () => void q.refetch() };
  if (!ready) return { kind: "empty", reason: emptyReason };
  return { kind: "ready" };
}

/** Thin inline bar for table cells (share of the row's maximum). */
export function InlineBar({ value, max }: { value: number | null; max: number }) {
  const pct = value != null && max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span aria-hidden className="block h-1.5 min-w-16 rounded-full bg-muted">
      <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
    </span>
  );
}
