/**
 * Merge a state's sources across the three collections (directory bundle,
 * source catalog, Registry V2.2) by exact URL only. No normalisation, no
 * fuzzy matching: the same exact address appears once with every collection
 * that contains it listed.
 */
import type { Source } from "./types";
import type { CatalogEntry } from "./catalog";
import type { RegistryV22Record } from "./registryV22";
import { valuesOf } from "./bundle";
import { CATEGORY_LABELS, classifySource, type CategoryId } from "@/lib/corpus/taxonomy";

export type SourceOriginRecord = {
  collection: "Directory" | "Source catalog" | "Registry V2.2";
  /** Unmodified original row, including native ID and imported version/dates. */
  record: Source | CatalogEntry | RegistryV22Record;
};

export type MergedStateSource = {
  id: string;
  title: string;
  url: string;
  domain: string;
  category: string;
  /** Every recorded content category, kept separately from publisher classification. */
  categories: string[];
  resourceGroups: CategoryId[];
  sourceTypes: string[];
  records: SourceOriginRecord[];
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
      row = { id: url, title: "", url, domain: "", category: "", categories: [], resourceGroups: [], sourceTypes: [], collections: [], records: [] };
      byUrl.set(url, row);
    }
    return row;
  };
  for (const s of directory) {
    const row = get(s.url);
    row.title = row.title || s.title || "";
    row.domain = row.domain || s.domain || "";
    row.categories.push(...valuesOf(s, "heading_category").filter(Boolean));
    row.source ??= s;
    row.collections.push("Directory");
    row.records.push({ collection: "Directory", record: s });
  }
  for (const c of catalog) {
    const row = get(c.url);
    row.title = row.title || c.title || "";
    row.domain = row.domain || c.host || "";
    if (c.category) row.categories.push(c.category);
    row.collections.push("Source catalog");
    row.records.push({ collection: "Source catalog", record: c });
  }
  for (const r of registry) {
    const row = get(r.url);
    row.title = row.title || r.title || "";
    row.domain = row.domain || r.domain || "";
    if (r.resourceType) row.categories.push(r.resourceType);
    if (r.sourceType) row.sourceTypes.push(r.sourceType);
    row.collections.push("Registry V2.2");
    row.records.push({ collection: "Registry V2.2", record: r });
  }
  return [...byUrl.values()].map((row) => {
    row.collections = [...new Set(row.collections)];
    row.categories = [...new Set(row.categories)];
    row.sourceTypes = [...new Set(row.sourceTypes)];
    row.resourceGroups = classifySource(row.categories);
    row.category = row.resourceGroups.map((id) => CATEGORY_LABELS[id]).join("; ");
    return row;
  }).sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url));
}
