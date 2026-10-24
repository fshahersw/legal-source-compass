import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design system's font-size utilities (src/styles.css, `--text-*`). tailwind-merge only knows Tailwind's own
 * sizes, so without this it files `text-meta` with the text colours and drops it from `cn("text-meta text-muted-foreground")`.
 */
export const CUSTOM_TEXT_SIZES = ["title", "heading", "label", "meta", "kpi", "kpi-sm"] as const;

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: [...CUSTOM_TEXT_SIZES] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
