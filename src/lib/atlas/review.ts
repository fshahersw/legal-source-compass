import type { ReviewAction, ReviewOverlay } from "./types";

export const REVIEW_ACTIONS: { value: ReviewAction; label: string }[] = [
  { value: "accepted", label: "Accept" },
  { value: "rejected", label: "Reject" },
  { value: "needs_follow_up", label: "Needs follow-up" },
];

export const MIN_REASON_LENGTH = 8;

export type ReviewResult =
  | { ok: true; overlays: Record<string, ReviewOverlay>; previous: ReviewOverlay | null }
  | { ok: false; error: string };

/**
 * Apply a browser-local review decision. A non-trivial reason is mandatory.
 * Returns the previous overlay so the UI can offer Undo.
 */
export function applyReview(
  overlays: Record<string, ReviewOverlay>,
  input: { sourceId: string; action: ReviewAction; reason: string; at?: string },
): ReviewResult {
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    return {
      ok: false,
      error: `A review reason of at least ${MIN_REASON_LENGTH} characters is required.`,
    };
  }
  const previous = overlays[input.sourceId] ?? null;
  const next: Record<string, ReviewOverlay> = {
    ...overlays,
    [input.sourceId]: {
      source_id: input.sourceId,
      action: input.action,
      reason,
      at: input.at ?? new Date().toISOString(),
    },
  };
  return { ok: true, overlays: next, previous };
}

/** Restore the overlay state that existed before the last decision. */
export function undoReview(
  overlays: Record<string, ReviewOverlay>,
  sourceId: string,
  previous: ReviewOverlay | null,
): Record<string, ReviewOverlay> {
  const next = { ...overlays };
  if (previous) next[sourceId] = previous;
  else delete next[sourceId];
  return next;
}

export function reviewCounts(overlays: Record<string, ReviewOverlay>) {
  const counts = { accepted: 0, rejected: 0, needs_follow_up: 0, total: 0 };
  for (const overlay of Object.values(overlays)) {
    counts[overlay.action] += 1;
    counts.total += 1;
  }
  return counts;
}
