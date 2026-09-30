import { describe, expect, it } from "vitest";

import { MIN_REASON_LENGTH, applyReview, reviewCounts, undoReview } from "./review";
import type { ReviewOverlay } from "./types";

describe("applyReview", () => {
  it("requires a reason of meaningful length", () => {
    const result = applyReview({}, { sourceId: "s1", action: "accepted", reason: "ok" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(String(MIN_REASON_LENGTH));
  });

  it("rejects whitespace-only reasons", () => {
    expect(applyReview({}, { sourceId: "s1", action: "rejected", reason: "          " }).ok).toBe(
      false,
    );
  });

  it("records action, trimmed reason and timestamp", () => {
    const result = applyReview(
      {},
      {
        sourceId: "s1",
        action: "needs_follow_up",
        reason: "  needs a live check next cycle  ",
        at: "2026-02-03T10:00:00.000Z",
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overlays['s1']).toEqual({
      source_id: "s1",
      action: "needs_follow_up",
      reason: "needs a live check next cycle",
      at: "2026-02-03T10:00:00.000Z",
    });
    expect(result.previous).toBeNull();
  });

  it("does not mutate the previous overlay map", () => {
    const before: Record<string, ReviewOverlay> = {};
    applyReview(before, { sourceId: "s1", action: "accepted", reason: "authoritative source" });
    expect(before).toEqual({});
  });

  it("returns the previous decision so it can be undone", () => {
    const first = applyReview({}, { sourceId: "s1", action: "accepted", reason: "looks correct" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyReview(first.overlays, {
      sourceId: "s1",
      action: "rejected",
      reason: "changed my mind on scope",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.previous?.action).toBe("accepted");
    expect(second.overlays['s1']!.action).toBe("rejected");
  });
});

describe("undoReview", () => {
  it("removes a first-time decision", () => {
    const applied = applyReview({}, { sourceId: "s1", action: "accepted", reason: "good source" });
    if (!applied.ok) throw new Error("setup failed");
    expect(undoReview(applied.overlays, "s1", applied.previous)).toEqual({});
  });

  it("restores the prior decision", () => {
    const first = applyReview({}, { sourceId: "s1", action: "accepted", reason: "good source" });
    if (!first.ok) throw new Error("setup failed");
    const second = applyReview(first.overlays, {
      sourceId: "s1",
      action: "rejected",
      reason: "duplicate of another row",
    });
    if (!second.ok) throw new Error("setup failed");
    const undone = undoReview(second.overlays, "s1", second.previous);
    expect(undone['s1']!.action).toBe("accepted");
    expect(undone['s1']!.reason).toBe("good source");
  });
});

describe("reviewCounts", () => {
  it("tallies decisions by action", () => {
    const overlays: Record<string, ReviewOverlay> = {
      a: { source_id: "a", action: "accepted", reason: "reason one", at: "x" },
      b: { source_id: "b", action: "accepted", reason: "reason two", at: "x" },
      c: { source_id: "c", action: "needs_follow_up", reason: "reason three", at: "x" },
    };
    expect(reviewCounts(overlays)).toEqual({
      accepted: 2,
      rejected: 0,
      needs_follow_up: 1,
      total: 3,
    });
  });
});
