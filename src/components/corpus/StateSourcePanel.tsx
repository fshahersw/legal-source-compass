import { useMemo, useState } from "react";
import { ArrowUpRight, BookOpen, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { MergedStateSource } from "@/lib/atlas/stateSources";
import { filterResources, safeResourceHref } from "@/lib/corpus/resourcePresentation";
import {
  prioritizeResources,
  resourceGroup,
  resourceGroups,
} from "@/lib/corpus/resourcePriorities";

export function StateSourcePanel({
  rows,
  state,
  loading,
  error,
  onRetry,
  compact = false,
}: {
  rows: MergedStateSource[];
  state: string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  compact?: boolean;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(compact ? 12 : 30);
  const categories = useMemo(() => resourceGroups(rows), [rows]);
  const shown = useMemo(
    () =>
      prioritizeResources(filterResources(rows, q)).filter(
        (row) => !category || resourceGroup(row) === category,
      ),
    [rows, q, category],
  );
  function reset() {
    setQ("");
    setCategory("");
    setLimit(compact ? 12 : 30);
  }
  return (
    <section
      className="resource-panel"
      aria-label="State law and source directory"
      data-state={state}
    >
      <div className="research-band">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="size-4" aria-hidden />
          Laws & research resources
        </h2>
        <span className="text-xs tabular-nums text-[var(--navy-muted)]" role="status">
          {loading ? "Loading…" : `${shown.length.toLocaleString()}${error ? "+" : ""} resources`}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 p-2.5">
        <div className="relative min-w-44 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(compact ? 12 : 30);
            }}
            aria-label="Filter this state's sources"
            placeholder="Find a statute, rule, or resource"
            className="h-9 bg-surface pl-8 text-xs"
          />
        </div>
        <select
          aria-label="Resource category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setLimit(compact ? 12 : 30);
          }}
          className="h-9 max-w-full rounded-md border border-input bg-surface px-2 text-xs sm:max-w-60"
        >
          <option value="">All resource types</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value || "__uncategorized"}>
              {c.label} ({c.count})
            </option>
          ))}
        </select>
        {q || category ? (
          <button
            type="button"
            onClick={reset}
            aria-label="Clear resource filters"
            className="rounded-md p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs"
        >
          <span>Some resources could not load; this list is incomplete.</span>
          <Button onClick={onRetry} variant="link" size="sm">
            Retry sources
          </Button>
        </div>
      ) : null}
      {loading && !rows.length ? (
        <p role="status" className="px-4 py-8 text-sm text-muted-foreground">
          Loading resources…
        </p>
      ) : (
        <ul className="divide-y divide-border/70" aria-label="Available research resources">
          {shown.slice(0, limit).map((row) => {
            const href = safeResourceHref(row.url);
            const body = (
              <>
                <span className="resource-icon">
                  <BookOpen className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium leading-5">
                    {row.title || row.domain || "Research resource"}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {row.domain}
                  </span>
                </span>
                {resourceGroup(row) !== "Other resources" ? (
                  <span
                    className="hidden max-w-44 truncate rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground sm:block"
                    title={resourceGroup(row)}
                  >
                    {resourceGroup(row)}
                  </span>
                ) : null}
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </>
            );
            return (
              <li key={row.id}>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="resource-row"
                    title={row.title || row.url}
                  >
                    {body}
                  </a>
                ) : (
                  <div className="resource-row opacity-75">
                    {body}
                    <span className="text-xs text-muted-foreground">Link unavailable</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!loading && !shown.length ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          <p>
            {q || category
              ? "No resources match these filters."
              : "No resources are listed for this state yet."}
          </p>
          {q || category ? (
            <Button onClick={reset} variant="link" size="sm">
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}
      {shown.length > limit ? (
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span>
            {limit} of {shown.length.toLocaleString()}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + 30)}>
            Show more resources
          </Button>
        </div>
      ) : null}
    </section>
  );
}
