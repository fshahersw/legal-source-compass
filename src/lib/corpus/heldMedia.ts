/**
 * Stored media of a record: the court record keeps a stored copy of a court's own identity mark ("Identity mark
 * image"). Owner decision 2026-10-24 (afternoon): images are shown without re-verifying licences, so a stored image
 * is no longer held back because its label carried the earlier "(reuse permission not established)" note. That
 * wording is dropped from what pages print; the image is drawn as the page's mark, not listed as a link.
 */

/** A stored identity-mark image label ("Identity mark image", "Identity marks"). */
export const isStoredMarkLabel = (label: string) => /\bidentity marks?\b/i.test(label);

/** The label as pages print it: the earlier "(reuse permission not established)" annotation removed. */
export const plainMediaLabel = (label: string) =>
  label.replace(/\s*\(\s*(?:reuse\s+)?permission\s+(?:is\s+)?not\s+established\s*\)/gi, "").trim();

/** A stored file path ("/supplement-files/...") as opposed to an external page. */
export const isStoredFilePath = (url: string) => /^\/(?!\/)/.test(url);
