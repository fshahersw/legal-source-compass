import { containsLiteral, normalizeText } from "./entries";

export type MatchMode = "literal" | "spacing_normalized";

/**
 * Second, disclosed comparison for two extractions of the same official page: the same words in the same
 * order, ignoring whitespace that one extractor places before punctuation ("injury , not"), after an opening
 * bracket, around a dash ("YEARS. — (a)" / "YEARS.—(a)") and across a line-break hyphenation ("mali- cious" /
 * "mali-cious"; every letter-hyphen-lowercase join is applied to both sides alike). Recorded wherever it is used
 * as matchMode "spacing_normalized"; it never bridges different words, numbers or punctuation.
 */
export function spacingNormalized(value: string): string {
  return normalizeText(value)
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+([,.;:!?)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/(\p{L})-(\p{Ll})/gu, "$1$2");
}

/** Literal match first; a spacing-normalised match only when the literal one fails, and it is labelled. */
export function matchPassage(haystack: string, needle: string): MatchMode | null {
  if (containsLiteral(haystack, needle)) return "literal";
  const n = spacingNormalized(needle);
  return n.length >= 8 && spacingNormalized(haystack).includes(n) ? "spacing_normalized" : null;
}
