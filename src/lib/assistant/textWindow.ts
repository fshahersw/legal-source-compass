/** Windowed reading of long texts for the assistant's reading tools (web pages, documents, court opinions). */
export const PAGE_WINDOW = 14000;

/** One window of a long text, or the passages around each mention of `find` (at most eight, spaced apart). */
export function pageWindow(text: string, start: number, find: string) {
  const total = text.length;
  const needle = find.trim().toLowerCase();
  if (needle) {
    const hay = text.toLowerCase();
    const matches: { offset: number; excerpt: string }[] = [];
    let occurrences = 0;
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
      occurrences += 1;
      const last = matches[matches.length - 1];
      if (matches.length < 8 && (!last || at - last.offset > 1200))
        matches.push({
          offset: at,
          excerpt: text.slice(Math.max(0, at - 700), at + needle.length + 700),
        });
    }
    return { total_chars: total, find: find.trim(), occurrences, matches };
  }
  const from = Math.min(Math.max(0, start), Math.max(0, total - 1));
  const end = Math.min(total, from + PAGE_WINDOW);
  return {
    total_chars: total,
    start: from,
    end,
    next_start: end < total ? end : null,
    text: text.slice(from, end),
  };
}
