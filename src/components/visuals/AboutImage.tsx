import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { creditLinkClass } from "./ImageCredit";

export type AboutImageLink = { label: string; href: string };

/**
 * An info button ("About this image") that opens the longer notes recorded for an image: the registry's branding
 * note, the source's policy page and the like. Prop-driven so any layout can place it beside a credit line; it is a
 * real button, so it opens with Enter or Space, Escape closes it and focus returns to it. Renders nothing when there
 * is nothing to say.
 */
export function AboutImage({
  notes = [],
  links = [],
  title = "About this image",
  className,
}: {
  notes?: readonly ReactNode[];
  links?: readonly AboutImageLink[];
  title?: string;
  className?: string;
}) {
  if (!notes.length && !links.length) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={title}
          title={title}
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded-full align-text-bottom text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-3 text-[12px] leading-snug"
      >
        <p className="m-0 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {title}
        </p>
        {notes.map((note, i) => (
          <p key={i} className="m-0 [overflow-wrap:anywhere]">
            {note}
          </p>
        ))}
        {links.length ? (
          <ul className="m-0 list-none space-y-1 p-0">
            {links.map((l) => (
              <li key={l.href}>
                <a href={l.href} target="_blank" rel="noreferrer" className={creditLinkClass}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
