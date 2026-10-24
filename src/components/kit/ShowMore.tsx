/**
 * "Show more" disclosures for long blocks: the first items stay on the page, the rest one click away (nothing is
 * removed from the page's data, only from the first view).
 *
 *   <ShowMore items={tiles} initial={3} noun="figures" render={(shown) => <KpiGrid>{shown.map(…)}</KpiGrid>} />
 *   <ShowMoreText lines={3}>{long caveat paragraph}</ShowMoreText>
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const toggleClass =
  "inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

export function ShowMore<T>({
  items,
  initial = 3,
  noun = "items",
  render,
  className,
}: {
  items: readonly T[];
  initial?: number | undefined;
  /** Plural noun for the button ("Show all 7 figures"). */
  noun?: string | undefined;
  render: (shown: readonly T[]) => ReactNode;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const limit = Math.max(0, Math.floor(initial));
  const extra = items.length - limit;
  const shown = open || extra <= 0 ? items : items.slice(0, limit);
  return (
    <div className={cn("min-w-0", className)}>
      <div id={id}>{render(shown)}</div>
      {extra > 0 ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className={cn(toggleClass, "mt-3")}
        >
          <ChevronDown
            className={cn("size-3.5 transition-transform", open && "rotate-180")}
            aria-hidden
          />
          {open ? "Show fewer" : `Show all ${items.length.toLocaleString("en-US")} ${noun}`}
        </button>
      ) : null}
    </div>
  );
}

/** Long prose clamped to a few lines, with "Show more" only when the text is actually cut. */
export function ShowMoreText({
  lines = 3,
  children,
  className,
}: {
  lines?: 2 | 3 | 4 | 6 | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (el && !open) setCut(el.scrollHeight > el.clientHeight + 1);
  }, [children, open]);
  const clamp = { 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4", 6: "line-clamp-6" }[
    lines
  ];
  return (
    <div className={cn("min-w-0", className)}>
      <div id={id} ref={ref} className={cn(!open && clamp)}>
        {children}
      </div>
      {cut || open ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className={cn(toggleClass, "mt-1")}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
