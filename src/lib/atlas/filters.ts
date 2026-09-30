import { valuesOf } from "./bundle";
import type { ReviewOverlay, Source } from "./types";

export type SortKey = "title" | "domain" | "jurisdiction" | "occurrences" | "source_family";
export type SortDir = "asc" | "desc";

export type LibraryFilters = {
  query: string;
  jurisdictions: string[];
  families: string[];
  headingCategories: string[];
  domains: string[];
  /** Browser-local review state filter. */
  reviewState: "any" | "unreviewed" | "accepted" | "rejected" | "needs_follow_up";
  bookmarkedOnly: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  page: number;
  pageSize: number;
};

export const defaultFilters: LibraryFilters = {
  query: "",
  jurisdictions: [],
  families: [],
  headingCategories: [],
  domains: [],
  reviewState: "any",
  bookmarkedOnly: false,
  sortKey: "occurrences",
  sortDir: "desc",
  page: 1,
  pageSize: 25,
};

function norm(v: unknown) {
  return String(v ?? "").toLowerCase();
}

/** Free-text match across title, exact URL, domain, heading category, jurisdiction. */
export function matchesQuery(source: Source, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    norm(source.title),
    norm(source.url),
    norm(source.domain),
    norm(source.heading_category),
    norm(source.jurisdiction),
  ].join(" \u0001 ");
  return terms.every((t) => haystack.includes(t));
}

function inList(list: string[], values: string | string[]) {
  if (list.length === 0) return true;
  const arr = Array.isArray(values) ? values : [values];
  return arr.some((value) => list.includes(value.trim() === "" ? "(unspecified)" : value.trim()));
}

export type FilterContext = {
  overlays: Record<string, ReviewOverlay>;
  bookmarks: Record<string, true>;
};

export function filterSources(
  sources: Source[],
  filters: LibraryFilters,
  ctx: FilterContext,
): Source[] {
  return sources.filter((s) => {
    if (!matchesQuery(s, filters.query)) return false;
    if (!inList(filters.jurisdictions, valuesOf(s, "jurisdiction"))) return false;
    if (!inList(filters.families, s.source_family)) return false;
    if (!inList(filters.headingCategories, valuesOf(s, "heading_category"))) return false;
    if (!inList(filters.domains, s.domain)) return false;
    if (filters.bookmarkedOnly && !ctx.bookmarks[s.id]) return false;
    if (filters.reviewState !== "any") {
      const overlay = ctx.overlays[s.id];
      if (filters.reviewState === "unreviewed") {
        if (overlay) return false;
      } else if (!overlay || overlay.action !== filters.reviewState) {
        return false;
      }
    }
    return true;
  });
}

export function sortSources(sources: Source[], key: SortKey, dir: SortDir): Source[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...sources].sort((a, b) => {
    if (key === "occurrences") {
      const diff = (a.occurrences ?? 0) - (b.occurrences ?? 0);
      if (diff !== 0) return diff * factor;
      return a.title.localeCompare(b.title);
    }
    const av = String(a[key] ?? "");
    const bv = String(b[key] ?? "");
    const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
    if (cmp !== 0) return cmp * factor;
    return a.url.localeCompare(b.url);
  });
}

export type Page<T> = {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
};

export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: current,
    pageCount,
    total: items.length,
    from: items.length === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}

export function queryAndPaginate(
  sources: Source[],
  filters: LibraryFilters,
  ctx: FilterContext,
): Page<Source> {
  const filtered = filterSources(sources, filters, ctx);
  const sorted = sortSources(filtered, filters.sortKey, filters.sortDir);
  return paginate(sorted, filters.page, filters.pageSize);
}
