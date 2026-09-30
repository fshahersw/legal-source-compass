/**
 * Merge a state's sources across the three collections (directory bundle,
 * source catalog, Registry V2.2) by exact URL only. No normalisation, no
 * fuzzy matching: the same exact address appears once with every collection
 * that contains it listed.
 */
import type { Source } from "./types";
import type { CatalogEntry } from "./catalog";
import type { RegistryV22Record } from "./registryV22";

export type MergedStateSource = {
  id: string;
  title: string;
  url: string;
  domain: string;
  category: string;
  /** Collection labels, e.g. ["Directory", "Registry V2.2"]. */
  collections: string[];
  /** The original directory row, when the URL is in the bundle. */
  source?: Source;
};

export function mergeStateSources(
  directory: Source[],
  catalog: CatalogEntry[],
  registry: RegistryV22Record[],
): MergedStateSource[] {
  const byUrl = new Map<string, MergedStateSource>();
  const get = (url: string) => {
    let row = byUrl.get(url);
    if (!row) {
      row = { id: url, title: "", url, domain: "", category: "", collections: [] };
      byUrl.set(url, row);
    }
    return row;
  };
  for (const s of directory) {
    const row = get(s.url);
    row.title = row.title || s.title || "";
    row.domain = row.domain || s.domain || "";
    row.category = row.category || String((s as unknown as Record<string, unknown>)["heading_category"] ?? "");
    row.source = s;
    row.collections.push("Directory");
  }
  for (const c of catalog) {
    const row = get(c.url);
    row.title = row.title || c.title || "";
    row.domain = row.domain || c.host || "";
    row.category = row.category || c.category || "";
    row.collections.push("Source catalog");
  }
  for (const r of registry) {
    const row = get(r.url);
    row.title = row.title || r.title || "";
    row.domain = row.domain || r.domain || "";
    row.category = row.category || r.sourceType || "";
    row.collections.push("Registry V2.2");
  }
  return [...byUrl.values()].sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url));
}
