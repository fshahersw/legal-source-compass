/**
 * Shared kit class names (kept apart from the components so fast refresh keeps working): the card surface, the soft
 * pill tones and the underline tab. Use them when a native element needs the kit look without the component.
 */

/** White card, hairline border, 12 px radius, soft shadow-xs. */
export const cardClass = "rounded-xl border border-border bg-card text-card-foreground shadow-xs";

export type StatusTone = "good" | "warning" | "serious" | "critical" | "info" | "neutral";

/** Tone classes for a soft pill; exported so other kit parts (delta pills) share them. */
export const TONE_CLASS: Record<StatusTone, string> = {
  good: "bg-status-good-soft text-status-good-ink ring-status-good-ring",
  warning: "bg-status-warning-soft text-status-warning-ink ring-status-warning-ring",
  serious: "bg-status-serious-soft text-status-serious-ink ring-status-serious-ring",
  critical: "bg-status-critical-soft text-status-critical-ink ring-status-critical-ring",
  info: "bg-status-info-soft text-status-info-ink ring-status-info-ring",
  neutral: "bg-status-neutral-soft text-status-neutral-ink ring-status-neutral-ring",
};

export const pillBase =
  "inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium leading-none whitespace-nowrap ring-1 ring-inset";

/** Classes of one underline tab; the active one is ink with a 2 px rule, the rest muted. */
export function pageTabClass(active: boolean): string {
  const base =
    "relative -mb-px inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring";
  return active
    ? `${base} border-primary font-semibold text-primary`
    : `${base} border-transparent font-medium text-muted-foreground hover:border-border-strong hover:text-foreground`;
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
