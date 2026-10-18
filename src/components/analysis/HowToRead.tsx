import { Fragment, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Measure = {
  term: string;
  /** What the figure counts or divides. */
  means: ReactNode;
  /** The limit on reading it: counts vs rates, sampled vs census, partial years. */
  caveat?: ReactNode;
};

/**
 * Collapsed-by-default reference for the measures on a page: each term with what it counts and the
 * one caveat that matters. Native <details>, so it is keyboard- and screen-reader-operable.
 */
export function HowToRead({
  measures,
  notes,
  title = "How to read this",
  className,
  defaultOpen = false,
}: {
  measures: readonly Measure[];
  /** Longer method or source text that used to sit in a footnote; kept reachable, not deleted. */
  notes?: ReactNode;
  title?: string;
  className?: string;
  defaultOpen?: boolean;
}) {
  if (!measures.length && !notes) return null;
  return (
    <details
      open={defaultOpen}
      className={cn("group min-w-0 rounded-md border border-border bg-surface", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        {title}
        {measures.length ? (
          <span className="font-normal text-muted-foreground">
            · {measures.length} {measures.length === 1 ? "measure" : "measures"} defined
          </span>
        ) : null}
      </summary>
      {measures.length ? (
        <dl className="grid gap-x-4 gap-y-1.5 border-t border-border/60 px-3 py-2 text-xs md:grid-cols-[11rem_minmax(0,1fr)]">
          {measures.map((m) => (
            <Fragment key={m.term}>
              <dt className="font-medium">{m.term}</dt>
              <dd className="min-w-0 leading-4 text-muted-foreground">
                {m.means}
                {m.caveat ? (
                  <>
                    {" "}
                    <span className="font-medium text-foreground">Limit:</span> {m.caveat}
                  </>
                ) : null}
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      {notes ? (
        <div className="border-t border-border/60 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
          {notes}
        </div>
      ) : null}
    </details>
  );
}
