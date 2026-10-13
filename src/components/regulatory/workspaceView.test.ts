import { describe, expect, it } from "vitest";
import type { RegulatoryReview } from "@/lib/regulatory/types";
import { reviewCurrencyLabel, reviewsForSourceRecord } from "./workspaceView";

describe("source-record review history", () => {
  it("distinguishes unknown, imported, changed and unavailable check status without promising currentness", () => {
    const review = {
      sourceVerification: "server_snapshot",
      needsReconsideration: false,
    } as RegulatoryReview;
    expect(reviewCurrencyLabel(review)).toBe("Source currency check not recorded.");
    expect(
      reviewCurrencyLabel({
        ...review,
        sourceCheckedAt: "2026-10-12T00:00:00Z",
        sourceCheckStatus: "current",
      }),
    ).toBe("Same source version at last check.");
    expect(
      reviewCurrencyLabel({
        ...review,
        sourceCheckedAt: "2026-10-12T00:00:00Z",
        sourceCheckStatus: "changed",
        needsReconsideration: true,
      }),
    ).toContain("changed at last check");
    expect(
      reviewCurrencyLabel({
        ...review,
        sourceVerification: "imported_unverified",
        sourceCheckStatus: "unavailable",
        needsReconsideration: true,
      }),
    ).toBe("Imported evidence, not reverified against the server.");
    expect(
      reviewCurrencyLabel({
        ...review,
        sourceCheckedAt: "2026-10-12T00:00:00Z",
        sourceCheckStatus: "unavailable",
      }),
    ).toContain("current version not confirmed");
  });
  it("retains old-version reviews while excluding similar identifiers from other sources", () => {
    const reviews = [
      {
        id: "old",
        eventId: "old-event",
        source: "federal_register",
        nativeId: "EXACT-001",
        payloadSha256: "old-payload",
      },
      {
        id: "new",
        eventId: "new-event",
        source: "federal_register",
        nativeId: "EXACT-001",
        payloadSha256: "new-payload",
      },
      { id: "other-source", source: "cpsc_recalls", nativeId: "EXACT-001" },
      { id: "similar-name", source: "federal_register", nativeId: "exact-001" },
    ] as RegulatoryReview[];
    expect(
      reviewsForSourceRecord(reviews, { source: "federal_register", nativeId: "EXACT-001" }).map(
        (review) => review.id,
      ),
    ).toEqual(["old", "new"]);
  });
});
