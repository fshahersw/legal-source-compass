import { Download, RotateCcw, Search } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { FacetFilter } from "@/components/atlas/FacetFilter";
import { Pager } from "@/components/atlas/Pager";
import { SourceTable } from "@/components/atlas/SourceTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { facet, valuesOf } from "@/lib/atlas/bundle";
import { CATEGORY_LABELS, classifySource, TAXONOMY_VERSION, type CategoryId } from "@/lib/corpus/taxonomy";
import { downloadText, sourcesToCsv, sourcesToJson } from "@/lib/atlas/exports";
import { filterSources, queryAndPaginate, sortSources, type SortKey } from "@/lib/atlas/filters";
import { useAtlas } from "@/lib/atlas/store";
import type { Source } from "@/lib/atlas/types";

const REVIEW_STATES = [
  { value: "any", label: "Any local state" },
  { value: "unreviewed", label: "Not locally reviewed" },
  { value: "accepted", label: "Locally accepted" },
  { value: "rejected", label: "Locally rejected" },
  { value: "needs_follow_up", label: "Needs follow-up" },
] as const;

export function LibraryBrowser({
  sources,
  scope,
  showFacets = true,
}: {
  sources: Source[];
  scope: string;
  showFacets?: boolean;
}) {
  const { filters, setFilters, resetFilters, overlays, bookmarks, bundle } = useAtlas();

  const ctx = useMemo(() => ({ overlays, bookmarks }), [overlays, bookmarks]);
  const page = useMemo(() => queryAndPaginate(sources, filters, ctx), [sources, filters, ctx]);

  const facets = useMemo(
    () => ({
      jurisdictions: facet(sources, "jurisdiction"),
      families: facet(sources, "source_family"),
      headings: facet(sources, "heading_category"),
      domains: facet(sources, "domain"),
      categories: (() => {
        const m = new Map<CategoryId, number>();
        for (const s of sources) for (const c of classifySource(valuesOf(s, "heading_category"))) m.set(c, (m.get(c) ?? 0) + 1);
        return [...m.entries()]
          .map(([id, count]) => ({ value: id, label: CATEGORY_LABELS[id], count, occurrences: count }))
          .sort((a, b) => b.count - a.count);
      })(),
    }),
    [sources],
  );

  function onSort(key: SortKey) {
    if (filters.sortKey === key) {
      setFilters({ sortDir: filters.sortDir === "asc" ? "desc" : "asc" });
    } else {
      setFilters({ sortKey: key, sortDir: key === "occurrences" ? "desc" : "asc" });
    }
  }

  function currentMatches() {
    return sortSources(filterSources(sources, filters, ctx), filters.sortKey, filters.sortDir);
  }

  function exportCsv() {
    const rows = currentMatches();
    downloadText(
      `legal-source-atlas-${scope}-${rows.length}.csv`,
      "text/csv",
      sourcesToCsv(rows, overlays, bookmarks),
    );
    toast.success(`Exported ${rows.length.toLocaleString()} rows as CSV`);
  }

  function exportJson() {
    const rows = currentMatches();
    downloadText(
      `legal-source-atlas-${scope}-${rows.length}.json`,
      "application/json",
      sourcesToJson(rows, overlays, bookmarks, {
        bundle_version: bundle?.bundle_version ?? "unknown",
        taxonomy_version: TAXONOMY_VERSION,
        scope,
      }),
    );
    toast.success(`Exported ${rows.length.toLocaleString()} rows as JSON`);
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-surface p-3 shadow-card">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
            placeholder="Search titles, exact URLs, domains, heading categories and jurisdictions…"
            className="h-9 pl-8 text-[13px]"
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {showFacets ? (
            <>
              <FacetFilter
                label="Jurisdiction"
                facets={facets.jurisdictions}
                selected={filters.jurisdictions}
                onChange={(v) => setFilters({ jurisdictions: v })}
              />
              <FacetFilter
                label="Family"
                facets={facets.families}
                selected={filters.families}
                onChange={(v) => setFilters({ families: v })}
              />
              <FacetFilter
                label="Recorded category"
                facets={facets.headings}
                selected={filters.headingCategories}
                onChange={(v) => setFilters({ headingCategories: v })}
              />
              <FacetFilter
                label="Resource group"
                facets={facets.categories.map((c) => ({ ...c, value: `${c.label}` }))}
                selected={filters.categories.map((id) => CATEGORY_LABELS[id as CategoryId] ?? id)}
                onChange={(v) =>
                  setFilters({
                    categories: v.map((label) => (Object.entries(CATEGORY_LABELS).find(([, l]) => l === label)?.[0] ?? label)),
                  })
                }
              />
              <FacetFilter
                label="Domain"
                facets={facets.domains}
                selected={filters.domains}
                onChange={(v) => setFilters({ domains: v })}
              />
            </>
          ) : null}

          <Select
            value={filters.reviewState}
            onValueChange={(v) => setFilters({ reviewState: v as typeof filters.reviewState })}
          >
            <SelectTrigger className="h-8 w-[12rem] text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REVIEW_STATES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={resetFilters}>
              <RotateCcw className="size-3.5" /> Reset
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={exportCsv}>
              <Download className="size-3.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={exportJson}>
              <Download className="size-3.5" /> JSON
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <SourceTable
          rows={page.items}
          overlays={overlays}
          bookmarks={bookmarks}
          sortKey={filters.sortKey}
          sortDir={filters.sortDir}
          onSort={onSort}
        />
        <Pager
          page={page.page}
          pageCount={page.pageCount}
          pageSize={filters.pageSize}
          total={page.total}
          from={page.from}
          to={page.to}
          onPage={(p) => setFilters({ page: p })}
          onPageSize={(size) => setFilters({ pageSize: size, page: 1 })}
        />
      </div>

    </>
  );
}
