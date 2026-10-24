/**
 * BarList: a ranked list read as a bar chart, for a card (top states, largest moves). Each row is the full label, the
 * value as printed, and a thin bar with rounded ends scaled to the largest magnitude; signed values grow from a centre
 * zero line (positive right in chart slot 1, negative left in chart slot 2, the palette's diverging pair). Labels never
 * truncate; the list is the accessible text (bars are decoration), so no separate table is needed for screen readers.
 * Rows with a link open their page. A value of null is not drawn as zero: the row says "Not recorded".
 *
 *   <BarList ariaLabel="Largest moves" diverging items={[{ id, label, value: 99.1, display: "+99.1%", to, search }]} />
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { chartTokens } from "@/components/charts/palette";
import { cn } from "@/lib/utils";
import { barExtent } from "./bars";

export type BarListItem = {
  id: string;
  label: ReactNode;
  value: number | null;
  /** The value as printed ("617.9", "+99.1%"). */
  display: string;
  /** Muted text after the label (rank, comparison). */
  note?: ReactNode | undefined;
  to?: string | undefined;
  search?: Record<string, unknown> | undefined;
  hash?: string | undefined;
};

export function BarList({
  items,
  ariaLabel,
  diverging = false,
  highlight,
  className,
}: {
  items: readonly BarListItem[];
  ariaLabel: string;
  diverging?: boolean | undefined;
  /** Id of the row to emphasise; the others are muted. */
  highlight?: string | null | undefined;
  className?: string | undefined;
}) {
  const maxAbs = Math.max(0, ...items.map((i) => (i.value === null ? 0 : Math.abs(i.value))));
  return (
    <ol
      aria-label={ariaLabel}
      style={chartTokens}
      className={cn("m-0 list-none space-y-2.5 p-0", className)}
    >
      {items.map((item) => {
        const extent = barExtent(item.value, maxAbs, diverging);
        const muted = highlight != null && highlight !== item.id;
        const label = (
          <span className="min-w-0 text-[13px] leading-5 text-foreground">
            {item.label}
            {item.note ? (
              <span className="ml-1.5 text-meta text-muted-foreground">{item.note}</span>
            ) : null}
          </span>
        );
        return (
          <li key={item.id} className={cn("min-w-0", muted && "opacity-60")}>
            <div className="flex items-baseline justify-between gap-3">
              {item.to ? (
                <Link
                  to={item.to as never}
                  {...(item.search ? { search: item.search as never } : {})}
                  {...(item.hash ? { hash: item.hash } : {})}
                  className="min-w-0 rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {label}
                </Link>
              ) : (
                label
              )}
              <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">
                {item.value === null ? (
                  <span className="font-normal text-muted-foreground">Not recorded</span>
                ) : (
                  item.display
                )}
              </span>
            </div>
            <div className="relative mt-1 h-1.5 rounded-full bg-muted" aria-hidden>
              {diverging ? (
                <span className="absolute inset-y-[-2px] left-1/2 w-px bg-border-strong" />
              ) : null}
              {extent ? (
                <span
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    left: `${extent.left}%`,
                    width: `max(${extent.width}%, 2px)`,
                    background:
                      diverging && (item.value ?? 0) < 0 ? "var(--chart-2)" : "var(--chart-1)",
                  }}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
