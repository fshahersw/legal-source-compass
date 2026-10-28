/**
 * Display rules for a record page's identity box, header line and link row. The record's own fields are never
 * changed; these only decide where a field is printed. Source-system identifiers and flags are technical details
 * (shown under "Technical details and provenance"), and a provenance note in a link label becomes the link's tooltip,
 * so provider names stay out of the page's main text (owner decision 2026-10-24) without losing the note. Pure.
 */

/** Keys that hold a source system's identifier or a provider flag, e.g. "Record id", "CourtListener court id", "In use (CourtListener flag)". */
export function isSourceIdKey(key: string): boolean {
  const k = key.trim();
  return /^record id$/i.test(k) || /\bid$/i.test(k) || /\(([^()]*\s)?flag\)$/i.test(k);
}

/** The header line without the segments that only print a source identifier ("CourtListener id nysd"). */
export function subtitleWithoutIds(subtitle: string | null | undefined): string | null {
  if (!subtitle) return null;
  const kept = subtitle
    .split(" · ")
    .filter((seg) => !/\bid\s+[A-Za-z0-9:_.\-]+$/i.test(seg.trim()));
  return kept.length ? kept.join(" · ") : null;
}

const PROVENANCE = /\b(recorded|re-checked|rechecked|registry|as published|as printed|flag)\b/i;

/** "Court website (url as recorded by X, not re-checked)" → text "Court website", note "url as recorded by X, not re-checked". */
export function splitProvenanceLabel(label: string): { text: string; note: string | null } {
  const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(label.trim());
  if (!m || !PROVENANCE.test(m[2]!)) return { text: label, note: null };
  return { text: m[1]!, note: m[2]! };
}
