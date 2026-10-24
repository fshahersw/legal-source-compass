/**
 * SectionIndex: a compact sticky in-page index (anchor links with scroll-spy) for one long page; it replaces a row of
 * tabs. Each item points at a section id on the page (Section's `id`); the active item follows the scroll position
 * (rule in scrollspy.ts) and is marked aria-current="location". Plain anchors, so links, back/forward and deep links
 * (#id) work as usual.
 *
 *   <SectionIndex label="On this page" items={[{ id: "headlines", label: "Headlines" }, { id: "moves", label: "What moved" }]} />
 *   <Section id="headlines" title="Headlines">…</Section>
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { activeSection } from "./scrollspy";

export type SectionIndexItem = { id: string; label: string };

/** Distance from the viewport top at which a section counts as reached (just under the sticky index). */
const READING_LINE = 96;

export function SectionIndex({
  items,
  label = "On this page",
  className,
}: {
  items: readonly SectionIndexItem[];
  label?: string | undefined;
  className?: string | undefined;
}) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const stripRef = useRef<HTMLDivElement>(null);
  const ids = items.map((i) => i.id).join("|");

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const tops = ids.split("|").map((id) => {
        const el = document.getElementById(id);
        return { id, top: el ? el.getBoundingClientRect().top : null };
      });
      const doc = document.documentElement;
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
      setActive(activeSection(tops, READING_LINE, atBottom));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ids]);

  // keep the active link in view inside the strip (never scrolls the page)
  useEffect(() => {
    const strip = stripRef.current;
    const link = active ? strip?.querySelector<HTMLElement>(`[data-index-id="${active}"]`) : null;
    if (!strip || !link) return;
    const box = strip.getBoundingClientRect();
    const r = link.getBoundingClientRect();
    if (r.left < box.left) strip.scrollLeft -= box.left - r.left + 12;
    else if (r.right > box.right) strip.scrollLeft += r.right - box.right + 12;
  }, [active]);

  if (!items.length) return null;
  return (
    <nav
      aria-label={label}
      className={cn(
        "sticky top-0 z-20 -mx-[var(--workspace-gutter)] -mt-[var(--page-pad-top,0px)] border-b border-border bg-background/90 px-[var(--workspace-gutter)] backdrop-blur supports-[backdrop-filter]:bg-background/75",
        className,
      )}
    >
      <div ref={stripRef} className="flex items-center gap-0.5 overflow-x-auto py-2">
        {items.map((item) => {
          const on = item.id === active;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              data-index-id={item.id}
              aria-current={on ? "location" : undefined}
              onClick={() => setActive(item.id)}
              className={cn(
                "inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[13px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                on
                  ? "bg-surface font-medium text-foreground shadow-xs ring-1 ring-border"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {item.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
