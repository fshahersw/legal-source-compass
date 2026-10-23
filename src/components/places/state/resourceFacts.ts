/** Adapters from the merged state sources (directory, source catalog, Registry V2.2) to the facts the resource filter reads. */
import type { MergedStateSource } from "@/lib/atlas/stateSources";
import { partitionResources, type Hidden, type ResourceFacts } from "./resourceFilter";

/** Readable words of a URL path ("/state-legislative-history-guides" -> "state legislative history guides"). */
export function pathWords(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname)
      .replace(/[-_/.+]+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

/**
 * What a resource says about itself: the titles each collection gives it and the words of its own URL path. Nothing
 * else is read. A collection's jurisdiction tags, descriptions and section headings say where a list placed the link
 * (the same Indiana library guide is tagged to California, Missouri and North Dakota, and a registry description is the
 * text of the list section around it), not what the resource covers.
 */
export function factsOfMerged(row: MergedStateSource): ResourceFacts {
  const titles = new Set<string>();
  for (const { record } of row.records) {
    const t = (record as Record<string, unknown>)["title"];
    if (typeof t === "string" && t.trim()) titles.add(t.trim());
  }
  return {
    url: row.url,
    domain: row.domain,
    title: row.title,
    text: [...titles, pathWords(row.url)].filter(Boolean),
  };
}

export function partitionStateSources(
  rows: MergedStateSource[],
  usps: string,
): { shown: MergedStateSource[]; hidden: Hidden<MergedStateSource>[] } {
  return partitionResources(rows, usps, factsOfMerged);
}
