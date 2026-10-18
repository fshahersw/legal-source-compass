import { jumpToSection } from "@/components/analysis/jumpToSection";

/** Opens a collapsed section and scrolls to it, so an in-panel link never lands on hidden content. */
export function openAndJump(id: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(id);
  if (el instanceof HTMLDetailsElement) el.open = true;
  return jumpToSection(id);
}
