/**
 * Display rules for a record page's identity box, header line and link row. The record's own fields are never
 * changed; these only decide where a field is printed. Source-system identifiers and flags are technical details
 * (shown under "Technical details and provenance"), and a provenance note in a link label becomes the link's tooltip,
 * so provider names stay out of the page's main text (owner decision 2026-10-24) without losing the note. Pure.
 */

/** Keys that hold a source system's identifier or a provider flag, e.g. "Record id", "CourtListener court id", "In use (CourtListener flag)". */
export function isSourceIdKey(key: string): boolean {
  const k = key.trim();
  if (/\(([^()]*\s)?flag\)$/i.test(k)) return true;
  const bare = k.replace(/\s*\([^()]*\)$/, "");
  return /^record id$/i.test(bare) || /\bid$/i.test(bare);
}

/** Data providers whose names stay out of the page's main text (they remain in tooltips and source popovers). */
const PROVIDERS =
  /\b(CourtListener|DocketBird|FJC|Federal Judicial Center|Stanford Securities Class Action Clearinghouse|Securities Class Action Clearinghouse|Vaquill?|PACER)\b/i;

/** "Parent court (CourtListener)" → text "Parent court", note "CourtListener"; other keys are unchanged. */
export function splitProviderKey(key: string): { text: string; note: string | null } {
  const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(key.trim());
  if (!m || !PROVIDERS.test(m[2]!)) return { text: key, note: null };
  return { text: m[1]!, note: m[2]! };
}

/** "NY — state name printed in the CourtListener court name" → text "NY", note the explanation; else unchanged. */
export function splitProviderValue(value: string): { text: string; note: string | null } {
  const m = /^(.+?)\s+—\s+(.+)$/.exec(value.trim());
  if (!m || !(PROVIDERS.test(m[2]!) || PROVENANCE.test(m[2]!))) return { text: value, note: null };
  return { text: m[1]!, note: m[2]! };
}

/** The header line without the segments that only print a source identifier ("CourtListener id nysd"). */
export function subtitleWithoutIds(subtitle: string | null | undefined): string | null {
  if (!subtitle) return null;
  const kept = subtitle.split(" · ").filter((seg) => !/\bid\s+[A-Za-z0-9:_.-]+$/i.test(seg.trim()));
  return kept.length ? kept.join(" · ") : null;
}

const PROVENANCE =
  /\b(recorded|re-checked|rechecked|registry|as published|as printed|printed in|flag)\b/i;

/** "Court website (url as recorded by X, not re-checked)" → text "Court website", note "url as recorded by X, not re-checked". */
export function splitProvenanceLabel(label: string): { text: string; note: string | null } {
  const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(label.trim());
  if (!m || !PROVENANCE.test(m[2]!)) return { text: label, note: null };
  return { text: m[1]!, note: m[2]! };
}
