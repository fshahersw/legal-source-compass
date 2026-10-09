import type { MergedStateSource } from "@/lib/atlas/stateSources";

/** Presentation only. Stored titles, categories, URLs and source identities stay unchanged. */
export function filterResources(rows: readonly MergedStateSource[], query: string, category = "") {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    const own = (row.category ?? "").trim();
    if (category === "__uncategorized" ? own !== "" : category && own !== category) return false;
    const searchable = [row.title, row.domain, row.category, row.url].join(" ").toLocaleLowerCase();
    return words.every((word) => searchable.includes(word));
  });
}

export function resourceCategories(rows: readonly MergedStateSource[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const category = (row.category ?? "").trim();
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, label: value || "Uncategorized", count }))
    .sort((a, b) =>
      !a.value ? 1 : !b.value ? -1 : b.count - a.count || a.label.localeCompare(b.label),
    );
}

/** Open an actual source, not an invented destination or an executable URL. */
export function safeResourceHref(value: string | null | undefined): string | null {
  if (
    !value ||
    Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
  )
    return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}
