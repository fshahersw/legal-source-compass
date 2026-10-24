import { useSyncExternalStore } from "react";

/**
 * Image URLs that failed to load in this tab, shared between an image and a credit drawn elsewhere on the page (a
 * header emblem and its caption in the page body), so both switch to the "did not load" state together.
 */
const failed = new Set<string>();
const listeners = new Set<() => void>();

export function markImageFailed(url: string) {
  if (failed.has(url)) return;
  failed.add(url);
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useImageFailed(url: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (url ? failed.has(url) : false),
    () => false,
  );
}
