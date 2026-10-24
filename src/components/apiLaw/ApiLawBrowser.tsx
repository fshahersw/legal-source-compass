import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Search } from "lucide-react";
import { StateNote } from "@/components/enforcement/parts";
import { Button } from "@/components/ui/button";
import { API_LAW_DATASETS, recordHref, type ApiLawHit } from "@/lib/external/apiLaw";
import type { BrowserSearch } from "./browserSearch";

const selectCls =
  "h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-[12.5px] focus-visible:outline-2 focus-visible:outline-ring";
const fmtN = (n: number) => n.toLocaleString("en-US");
import {
  getApiLawFacets,
  searchApiLaw,
  type ApiLawFacets,
  type ApiLawSearchResult,
} from "@/lib/external/apiLaw.functions";

/**
 * Search, filter and page one api-law dataset. Filters and counts come from the dataset's catalog listing; results link
 * to the record page (or the dataset's own page). Loading, empty, error and not-published states are explicit.
 */
export function ApiLawBrowser({
  dataset,
  search,
  onSearch,
  placeholder,
  hiddenFilters = [],
  columns,
}: {
  dataset: string;
  search: BrowserSearch;
  onSearch: (next: BrowserSearch) => void;
  placeholder: string;
  /** filters fixed by the page (not shown as selects) */
  hiddenFilters?: string[];
  /** cells shown under each result, in order: [cell key, label] */
  columns: [string, string][];
}) {
  const ds = API_LAW_DATASETS[dataset]!;
  const page = search.page ?? 1;
  const [draft, setDraft] = useState(search.q ?? "");
  useEffect(() => setDraft(search.q ?? ""), [search.q]);
  const facetsFn = useServerFn(getApiLawFacets);
  const searchFn = useServerFn(searchApiLaw);
  const facets = useQuery({
    queryKey: ["api-law-facets", dataset],
    queryFn: () => facetsFn({ data: { dataset } }),
    staleTime: 30 * 60 * 1000,
  });
  const input = { dataset, q: search.q ?? "", page, filters: search.f ?? {} };
  const results = useQuery({
    queryKey: ["api-law-search", input],
    queryFn: () => searchFn({ data: input }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
  const set = (patch: Partial<BrowserSearch>) => onSearch({ ...search, page: undefined, ...patch });
  const setFilter = (name: string, value: string) => {
    const f = { ...(search.f ?? {}) };
    if (value) f[name] = value;
    else delete f[name];
    set({ f: Object.keys(f).length ? f : undefined });
  };

  if (facets.data === null)
    return (
      <StateNote>
        This dataset ({ds.label}) is not published yet. Once it is loaded, the {ds.noun} appear here
        with their official links.
      </StateNote>
    );

  return (
    <div className="min-w-0 space-y-3">
      <form
        role="search"
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: draft.trim() || undefined });
        }}
      >
        <label className="sr-only" htmlFor={`${dataset}-q`}>
          Search {ds.label}
        </label>
        <input
          id={`${dataset}-q`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="h-8 w-full min-w-0 max-w-md flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button type="submit" size="sm" variant="outline">
          <Search className="mr-1 size-3.5" aria-hidden />
          Search
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2" aria-label="Filters">
        {facets.isLoading ? (
          <span
            className="h-8 w-64 animate-pulse rounded-md bg-muted/50"
            aria-label="Loading filters"
          />
        ) : (
          (facets.data?.facets ?? [])
            .filter((f) => !hiddenFilters.includes(f.name) && f.options.length > 0)
            .map((f) => (
              <select
                key={f.name}
                aria-label={f.label}
                className={selectCls}
                value={search.f?.[f.name] ?? ""}
                onChange={(e) => setFilter(f.name, e.target.value)}
              >
                <option value="">{`${f.label}: any`}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.count != null ? `${o.label} (${fmtN(o.count)})` : o.label}
                  </option>
                ))}
              </select>
            ))
        )}
        {search.f && Object.keys(search.f).some((k) => !hiddenFilters.includes(k)) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const kept = Object.fromEntries(
                Object.entries(search.f ?? {}).filter(([k]) => hiddenFilters.includes(k)),
              );
              set({ f: Object.keys(kept).length ? kept : undefined });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      {results.isLoading ? (
        <div className="space-y-1.5" aria-busy="true" aria-label={`Loading ${ds.noun}`}>
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-md border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : results.isError ? (
        <StateNote
          tone="error"
          action={
            <button
              type="button"
              className="text-primary underline"
              onClick={() => void results.refetch()}
            >
              Retry
            </button>
          }
        >
          {ds.label} could not be loaded.
        </StateNote>
      ) : results.data ? (
        <Results
          r={results.data}
          noun={ds.noun}
          orderLabel={ds.order?.label}
          fetching={results.isFetching}
          onPage={(p) => onSearch({ ...search, page: p })}
          columns={columns}
          facets={facets.data}
        />
      ) : null}
      <p className="max-w-[90ch] text-[11px] leading-4 text-muted-foreground">{ds.sourceNote}</p>
    </div>
  );
}

function Results({
  r,
  noun,
  orderLabel,
  fetching,
  onPage,
  columns,
  facets,
}: {
  r: ApiLawSearchResult;
  noun: string;
  orderLabel?: string | undefined;
  fetching: boolean;
  onPage: (p: number) => void;
  columns: [string, string][];
  facets: ApiLawFacets | undefined;
}) {
  const from = (r.page - 1) * r.pageSize + 1;
  const to = from + r.rows.length - 1;
  const last = r.total != null ? Math.max(1, Math.ceil(r.total / r.pageSize)) : null;
  return (
    <section
      aria-label="Results"
      aria-busy={fetching}
      className={fetching ? "opacity-70" : undefined}
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span role="status">
          {r.rows.length
            ? `${fmtN(from)}–${fmtN(to)} of ${r.total != null ? fmtN(r.total) : "too large to count"} ${noun}`
            : `No ${noun} match.`}
          {r.mode === "id" ? " · exact identifier" : ""}
          {r.rows.length > 1 && orderLabel ? ` · ${orderLabel}` : ""}
          {r.dropped ? ` · ${r.dropped} malformed row${r.dropped === 1 ? "" : "s"} not shown` : ""}
          {facets?.ready === false
            ? " · the collection is being loaded; counts may be partial"
            : ""}
        </span>
        {r.rows.length ? (
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={r.page <= 1}
              onClick={() => onPage(r.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="tabular-nums">
              Page {r.page}
              {last ? ` of ${fmtN(last)}` : ""}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={
                (last != null && r.page >= last) || r.rows.length < r.pageSize || r.page >= 200
              }
              onClick={() => onPage(r.page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </span>
        ) : null}
      </div>
      {r.rows.length ? (
        <ol className="m-0 list-none divide-y divide-border/70 overflow-hidden rounded-md border border-border bg-surface p-0">
          {r.rows.map((h) => (
            <HitRow key={h.id} h={h} dataset={r.dataset} columns={columns} />
          ))}
        </ol>
      ) : (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
          Try other words, an exact identifier, or clear a filter.
        </p>
      )}
    </section>
  );
}

export function HitRow({
  h,
  dataset,
  columns,
}: {
  h: ApiLawHit;
  dataset: string;
  columns: [string, string][];
}) {
  const href = recordHref(dataset, h.id);
  return (
    <li className="min-w-0 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Link
          to={href as never}
          className="min-w-0 break-words font-semibold text-primary hover:underline"
        >
          {h.title}
        </Link>
        {h.badges.map((b) => (
          <span
            key={b}
            className="inline-flex shrink-0 items-center rounded border border-border bg-muted/60 px-1.5 py-px text-[10.5px] font-medium text-muted-foreground"
          >
            {b}
          </span>
        ))}
      </div>
      {h.subtitle ? (
        <p className="m-0 break-words text-[12px] text-muted-foreground">{h.subtitle}</p>
      ) : null}
      <dl className="m-0 mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px]">
        {columns
          .filter(([k]) => h.cells[k] !== undefined)
          .map(([k, label]) => (
            <div key={k} className="flex min-w-0 gap-1">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="m-0 break-words tabular-nums">{h.cells[k]}</dd>
            </div>
          ))}
        {h.sourceUrl && /^https:\/\//.test(h.sourceUrl) ? (
          <div className="flex gap-1">
            <dd className="m-0">
              <a
                href={h.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                Official page
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
    </li>
  );
}
