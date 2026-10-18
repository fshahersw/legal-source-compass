import type { MouseEvent, ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Takeaway } from "./analysisFormat";
import { jumpToSection } from "./jumpToSection";

/**
 * Three to five short, number-backed statements computed from the data the page already loaded, each
 * linking to the section its figure comes from. Renders nothing when fewer than two are usable.
 */
export function KeyTakeaways({
  items,
  scope,
  note,
  className,
  title = "Key takeaways",
}: {
  items: readonly Takeaway[];
  /** What the figures cover, e.g. "FY2025 · United States". */
  scope?: string | undefined;
  note?: ReactNode;
  className?: string;
  title?: string;
}) {
  if (items.length < 2) return null;
  const onJump = (anchor: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (jumpToSection(anchor)) e.preventDefault();
  };
  return (
    <section
      aria-label={title}
      className={cn("min-w-0 rounded-md border border-border bg-surface", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border/70 px-3 py-1.5">
        <h3 className="text-sm font-semibold leading-5">{title}</h3>
        {scope ? <span className="text-[11px] text-muted-foreground">{scope}</span> : null}
      </div>
      <ul className="divide-y divide-border/60">
        {items.map((t) => (
          <li
            key={t.id}
            className="grid items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5 text-xs sm:grid-cols-[7.5rem_minmax(0,1fr)_auto]"
          >
            <span className="break-words font-mono text-[13px] font-semibold tabular-nums">
              {t.figure}
            </span>
            <span className="min-w-0 leading-4">{t.text}</span>
            {t.anchor ? (
              <a
                href={`#${t.anchor}`}
                onClick={onJump(t.anchor)}
                className="inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {t.anchorLabel ?? "See the data"}
                <ArrowDown className="size-3" aria-hidden />
              </a>
            ) : (
              <span aria-hidden />
            )}
          </li>
        ))}
      </ul>
      {note ? (
        <div className="border-t border-border/60 px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
          {note}
        </div>
      ) : null}
    </section>
  );
}
