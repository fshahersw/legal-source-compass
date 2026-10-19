import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Kpi, Segmented } from "@/components/enforcement/parts";
import {
  getRecordSourceSample,
  getSourcesDirectory,
} from "@/lib/external/sourcesCatalog.functions";
import {
  buildPortals,
  CATEGORIES,
  groupByCategory,
  type CategoryId,
  type SourcesSearch,
  type SourcesTab,
} from "@/lib/external/sourcesCatalog";
import { DatasetDirectory } from "./DatasetDirectory";
import { PortalDirectory } from "./PortalDirectory";
import { WorkflowDirectory } from "./WorkflowDirectory";

const TAB_OPTIONS: { id: SourcesTab; label: string }[] = [
  { id: "datasets", label: "Datasets" },
  { id: "portals", label: "Portals" },
  { id: "workflows", label: "Workflows" },
];

const PLACEHOLDER: Record<SourcesTab, string> = {
  datasets: "Search datasets, sources and categories",
  portals: "Search agencies, courts and sites",
  workflows: "Search tasks and pages",
};

const TOOLS = [
  { to: "/sources/library", label: "Source library (URLs)" },
  { to: "/sources/catalog", label: "Source catalog" },
  { to: "/sources/coverage", label: "Coverage" },
  { to: "/data", label: "Dataset inventory" },
  { to: "/saved-sources", label: "Saved" },
  { to: "/search", label: "Search all records" },
] as const;

export function SourcesHub({
  search,
  onSearch,
}: {
  search: SourcesSearch;
  onSearch: (next: SourcesSearch) => void;
}) {
  const tab = search.tab ?? "datasets";
  const q = search.q ?? "";
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  // Debounce typing into the address so back/forward restores the search without one entry per key.
  useEffect(() => {
    if (draft === q) return;
    const t = setTimeout(() => onSearch({ ...search, q: draft.trim() ? draft : undefined }), 250);
    return () => clearTimeout(t);
  }, [draft, q, search, onSearch]);

  const dir = useQuery({
    queryKey: ["sources-directory"],
    queryFn: () => getSourcesDirectory(),
    staleTime: 10 * 60 * 1000,
  });
  // Source URLs on each dataset's first records widen the portal list; loaded after the directory and cached on the server.
  const sample = useQuery({
    queryKey: ["sources-record-sample"],
    queryFn: () => getRecordSourceSample(),
    staleTime: 30 * 60 * 1000,
    enabled: Boolean(dir.data),
  });
  const datasets = useMemo(() => {
    const rows = dir.data?.datasets ?? [];
    const extra = sample.data?.urls ?? {};
    return rows.map((d) => {
      const more = (extra[d.id] ?? []).filter((u) => !d.sourceUrls.includes(u));
      return more.length ? { ...d, recordUrls: more } : d;
    });
  }, [dir.data, sample.data]);
  const portals = useMemo(() => buildPortals(datasets), [datasets]);
  const counts = useMemo(() => {
    const grouped = groupByCategory(datasets);
    return new Map<CategoryId, number>(
      CATEGORIES.map((c) => [c.id, grouped.get(c.id)?.length ?? 0]),
    );
  }, [datasets]);
  const records = datasets.reduce((n, d) => n + (d.records ?? 0), 0);
  const unknownCounts = datasets.some((d) => d.records === null);

  const setTab = (next: SourcesTab) =>
    onSearch({ ...search, tab: next === "datasets" ? undefined : next });
  const setCategory = (cat: CategoryId | undefined) => onSearch({ ...search, tab: undefined, cat });

  return (
    <div className="space-y-4">
      {dir.isLoading ? (
        <div
          className="grid grid-cols-2 gap-2 md:grid-cols-4"
          aria-busy="true"
          aria-label="Loading"
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[58px] animate-pulse rounded-md border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : dir.data ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Kpi
            label="Published datasets"
            value={datasets.length.toLocaleString("en-US")}
            note={dir.data.held ? `${dir.data.held} held or staged, not listed` : undefined}
          />
          <Kpi
            label="Imported records"
            value={records.toLocaleString("en-US")}
            note={unknownCounts ? "Some counts not recorded" : "Overlaps between datasets included"}
          />
          <Kpi
            label="Categories"
            value={String([...counts.values()].filter((n) => n > 0).length)}
          />
          <Kpi
            label="Source sites"
            value={portals.length.toLocaleString("en-US")}
            note={sample.isLoading ? "Reading record sources…" : undefined}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Directory view" value={tab} options={TAB_OPTIONS} onChange={setTab} />
        <label className="relative flex min-w-[14rem] flex-1 items-center sm:max-w-sm">
          <span className="sr-only">Search the directory</span>
          <Search
            className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={PLACEHOLDER[tab]}
            maxLength={200}
            className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-7 text-[12px] focus-visible:outline-2 focus-visible:outline-ring"
          />
          {draft ? (
            <button
              type="button"
              onClick={() => setDraft("")}
              aria-label="Clear search"
              className="absolute right-1.5 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </label>
        <nav
          aria-label="Source tools"
          className="flex basis-full flex-wrap gap-x-3 gap-y-1 text-[12px] xl:ml-auto xl:basis-auto"
        >
          {TOOLS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {dir.isError ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-border px-4 py-3 text-[13px] text-muted-foreground"
        >
          The dataset directory could not be loaded.
          <button
            type="button"
            onClick={() => void dir.refetch()}
            className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Retry
          </button>
        </p>
      ) : dir.isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-md border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : tab === "datasets" ? (
        datasets.length ? (
          <DatasetDirectory datasets={datasets} cat={search.cat} q={q} onCategory={setCategory} />
        ) : (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
            No published dataset is available.
          </p>
        )
      ) : tab === "portals" ? (
        <PortalDirectory
          portals={portals}
          q={q}
          sampleState={sample.isLoading ? "loading" : sample.isError ? "error" : "ready"}
          failed={sample.data?.failed ?? 0}
        />
      ) : (
        <WorkflowDirectory q={q} counts={counts} onCategory={setCategory} />
      )}
    </div>
  );
}
