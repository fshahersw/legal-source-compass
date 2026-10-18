import { useEffect, useRef } from "react";
import { jumpToSection } from "@/components/analysis/jumpToSection";

/**
 * Brings a drill-down panel into view, and moves focus to it, once per selection and only after its content has
 * loaded (a placeholder is too short to scroll to). Closing the panel re-arms it, so choosing the same row again jumps.
 */
export function useJumpWhenShown(
  id: string | number | undefined,
  ready: boolean,
  targetId: string,
) {
  const done = useRef<string | number | undefined>(undefined);
  useEffect(() => {
    if (id === undefined) {
      done.current = undefined;
      return;
    }
    if (!ready || done.current === id) return;
    done.current = id;
    requestAnimationFrame(() => jumpToSection(targetId));
  }, [id, ready, targetId]);
}
