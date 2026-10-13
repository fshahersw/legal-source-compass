import type { RegulatoryReview } from "@/lib/regulatory/types";

/** Earlier review decisions belong to an exact source record, not just its newest event. */
export function reviewsForSourceRecord(
  reviews: RegulatoryReview[],
  record: { source: string; nativeId: string },
) {
  return reviews.filter(
    (review) => review.source === record.source && review.nativeId === record.nativeId,
  );
}

export function reviewCurrencyLabel(review: RegulatoryReview) {
  if (review.sourceVerification === "imported_unverified")
    return "Imported evidence, not reverified against the server.";
  if (review.sourceCheckStatus === "unavailable")
    return "Latest source recheck unavailable; current version not confirmed.";
  if (!review.sourceCheckedAt || review.sourceVerification !== "server_snapshot")
    return "Source currency check not recorded.";
  if (review.sourceCheckStatus === "changed")
    return "Source version changed at last check; reconsider this review.";
  if (review.sourceCheckStatus === "current") return "Same source version at last check.";
  return "Source currency check not recorded.";
}
