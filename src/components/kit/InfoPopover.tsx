/**
 * InfoPopover: the "About this data" popover. A small, keyboard-reachable info button that opens the method text,
 * caveats, partial-period notes and links which used to sit inline as prose. Nothing is deleted: the prose moves here.
 *
 *   <InfoPopover>Counts are …</InfoPopover>                      // icon button, accessible name "About this data"
 *   <InfoPopover label="How these are chosen" showLabel>…</InfoPopover>   // icon + visible text
 *   <InfoPopover trigger={<StatusPill>Partial</StatusPill>}>…</InfoPopover>  // any element as the trigger
 */
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function InfoPopover({
  label = "About this data",
  title,
  children,
  showLabel = false,
  trigger,
  side = "bottom",
  align = "end",
  className,
  contentClassName,
}: {
  /** Accessible name of the trigger (and its visible text with `showLabel`). */
  label?: string | undefined;
  /** Heading inside the popover; defaults to the label. */
  title?: string | undefined;
  children: ReactNode;
  showLabel?: boolean | undefined;
  /** A custom trigger element, rendered inside the trigger button. */
  trigger?: ReactNode | undefined;
  side?: "top" | "right" | "bottom" | "left" | undefined;
  align?: "start" | "center" | "end" | undefined;
  className?: string | undefined;
  contentClassName?: string | undefined;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={showLabel ? undefined : label}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          trigger ? "p-0" : showLabel ? "h-6 px-1 text-xs" : "size-6 justify-center",
          className,
        )}
      >
        {trigger ?? (
          <>
            <Info className="size-3.5" aria-hidden strokeWidth={2} />
            {showLabel ? <span>{label}</span> : null}
          </>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className={cn(
          "max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto p-3.5 text-xs leading-5 text-foreground/90",
          contentClassName,
        )}
      >
        <p className="mb-1.5 text-[13px] font-semibold text-foreground">{title ?? label}</p>
        <div className="space-y-2 [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
