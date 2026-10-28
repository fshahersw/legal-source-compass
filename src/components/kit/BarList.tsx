/**
 * BarList: a ranked list read as a bar chart, for a card (top states, largest moves). Each row is the full label
 * (right-aligned against the bars, wrapping rather than truncating), a 10 px bar with a 2 px rounded data end scaled to
 * the largest magnitude, and the value as printed in strong ink right after the bar end. Signed values grow from a
 * centre zero line (positive right in chart slot 1, negative left in chart slot 2, the palette's diverging pair) with
 * the value in its own column. With `highlight`, that row keeps the accent and the others turn the neutral base grey.
 * The list is the accessible text (bars are decoration), so no separate table is needed for screen readers. Rows with
 * a link open their page. A value of null is not drawn as zero: the row says "Not recorded".
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

/** Room kept at the end of the bar track for the printed value (non-diverging rows). */
const VALUE_ROOM = "4.75rem";

export function BarList({
  items,
  ariaLabel,
  diverging = false,
  highlight,
  labelWidth = "40%",
  className,
}: {
  items: readonly BarListItem[];
  ariaLabel: string;
  diverging?: boolean | undefined;
  /** Id of the row to emphasise; the others are drawn in the neutral base grey. */
  highlight?: string | null | undefined;
  /** Width of the label column (CSS length or percentage of the list). */
  labelWidth?: string | undefined;
  className?: string | undefined;
}) {
  const maxAbs = Math.max(0, ...items.map((i) => (i.value === null ? 0 : Math.abs(i.value))));
  const columns = diverging
    ? `minmax(0, ${labelWidth}) minmax(0, 1fr) auto`
    : `minmax(0, ${labelWidth}) minmax(0, 1fr)`;
  return (
    <ol
      aria-label={ariaLabel}
      style={chartTokens}
      className={cn("m-0 list-none space-y-1 p-0", className)}
    >
      {items.map((item) => {
        const extent = barExtent(item.value, maxAbs, diverging);
        const muted = highlight != null && highlight !== item.id;
        const focus = highlight != null && highlight === item.id;
        const label = (
          <span
            className={cn(
              "min-w-0 text-[12px] leading-4",
              focus ? "font-semibold text-foreground" : "text-foreground/80",
              muted && "text-muted-foreground",
            )}
          >
            {item.label}
            {item.note ? (
              <span className="ml-1.5 text-meta font-normal text-muted-foreground">
                {item.note}
              </span>
            ) : null}
          </span>
        );
        const fill = muted
          ? "var(--chart-base)"
          : diverging && (item.value ?? 0) < 0
            ? "var(--chart-2)"
            : "var(--chart-1)";
        const value =
          item.value === null ? (
            <span className="text-[11.5px] font-normal text-muted-foreground">Not recorded</span>
          ) : (
            <span
              className={cn(
                "text-[11.5px] font-semibold tabular-nums",
                muted ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {item.display}
            </span>
          );
        return (
          <li
            key={item.id}
            className="grid min-h-[22px] items-center gap-x-2.5"
            style={{ gridTemplateColumns: columns }}
          >
            <div className="min-w-0 text-right">
              {item.to ? (
                <Link
                  to={item.to as never}
                  {...(item.search ? { search: item.search as never } : {})}
                  {...(item.hash ? { hash: item.hash } : {})}
                  className="rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {label}
                </Link>
              ) : (
                label
              )}
            </div>
            {diverging ? (
              <>
                <div className="relative h-[14px]" aria-hidden>
                  <span className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
                  {extent ? (
                    <span
                      className={cn(
                        "absolute top-[2px] h-[10px]",
                        (item.value ?? 0) < 0 ? "rounded-l-[2px]" : "rounded-r-[2px]",
                      )}
                      style={{
                        left: `${extent.left}%`,
                        width: `max(${extent.width}%, 2px)`,
                        background: fill,
                      }}
                    />
                  ) : null}
                </div>
                <div className="min-w-12 text-right">{value}</div>
              </>
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                {extent ? (
                  <span
                    aria-hidden
                    className="h-[10px] shrink-0 rounded-r-[2px]"
                    style={{
                      width: `max(2px, calc((100% - ${VALUE_ROOM}) * ${(extent.width / 100).toFixed(4)}))`,
                      background: fill,
                    }}
                  />
                ) : null}
                {value}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
