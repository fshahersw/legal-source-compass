/**
 * Scroll-spy rule for SectionIndex: the active section is the last one whose top has passed the reading line
 * (`offset` px below the viewport top, just under the sticky index). Before the first section passes it, the first
 * section is active; at the bottom of the page the last section is active, so a short final section can still be
 * reached. Sections missing from the page (top null) are skipped. Pure and tested (scrollspy.test.ts).
 */

export type SectionTop = { id: string; top: number | null };

export function activeSection(
  tops: readonly SectionTop[],
  offset: number,
  atBottom = false,
): string | null {
  const present = tops.filter((t): t is { id: string; top: number } => t.top !== null);
  if (!present.length) return null;
  if (atBottom) return present[present.length - 1]!.id;
  let active = present[0]!.id;
  for (const t of present) if (t.top - offset <= 1) active = t.id;
  return active;
}
