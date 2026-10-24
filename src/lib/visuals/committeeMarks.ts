/**
 * Committee marks (dataset committee_marks, id = our committee system code, e.g. hsju00): a logo served from the
 * committee's own website. Owner decision 2026-10-24: shown whatever its rights status, with the recorded source and,
 * where the record has one, the site's policy statement. Branding can change with the chair or majority; the
 * record's branding note says so. A record that fails the shape checks is dropped, never repaired.
 */
import { COMMITTEE_CODE } from "@/lib/external/congressMembers";
import { httpsLink, isoDate, obj, optionalText, parseMarkImage, type MarkImage } from "./common";

export const COMMITTEE_MARKS_DATASET = "committee_marks";

export type CommitteeMark = MarkImage & {
  committeeId: string;
  policyUrl: string | null;
  policyQuote: string | null;
  brandingNote: string | null;
  /** Optional plate for a mark drawn in light colours; "light" when the record does not say. */
  background: "light" | "dark";
  verifiedAt: string | null;
};

const absent = (v: unknown) => v === undefined || v === null || v === "";

export function parseCommitteeMark(committeeId: string, raw: unknown): CommitteeMark | null {
  const m = obj(raw);
  if (!m || !COMMITTEE_CODE.test(committeeId)) return null;
  const mark = parseMarkImage(m);
  const policyUrl = absent(m["policy_url"]) ? null : httpsLink(m["policy_url"]);
  const quote = optionalText(m["policy_quote"], 1000);
  const branding = optionalText(m["branding_note"], 400);
  const verifiedAt = absent(m["verified_at"]) ? null : isoDate(m["verified_at"]);
  const bg = m["background"];
  const background = bg === undefined || bg === null ? "light" : bg;
  if (!mark || !quote.ok || !branding.ok) return null;
  if ((!absent(m["policy_url"]) && !policyUrl) || (!absent(m["verified_at"]) && !verifiedAt))
    return null;
  if (background !== "light" && background !== "dark") return null;
  return {
    ...mark,
    committeeId,
    policyUrl,
    // A quote is shown only with the page it is quoted from.
    policyQuote: policyUrl ? quote.value : null,
    brandingNote: branding.value,
    background,
    verifiedAt,
  };
}
