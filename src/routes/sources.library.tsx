import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Copy, ExternalLink, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/atlas/AppShell";
import { EmptyBundleState } from "@/components/atlas/EmptyBundleState";
import { LibraryBrowser } from "@/components/atlas/LibraryBrowser";
import { Pager } from "@/components/atlas/Pager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAtlas } from "@/lib/atlas/store";
import { loadAllCatalog, mergeCatalog } from "@/lib/atlas/catalog";
import { paginate } from "@/lib/atlas/filters";
import { useQuery } from "@tanstack/react-query";

type S = { view?: string | undefined };

export const Route = createFileRoute("/sources/library")({
  validateSearch: (s: Record<string, unknown>): S => ({ view: s["view"] === "endpoints" ? "endpoints" : undefined }),
  head: () => ({
    meta: [
      { title: "Source library — Legal Source Atlas" },
      {
        name: "description",
        content:
          "Searchable directory of imported U.S. litigation research sources: exact URLs, jurisdictions, source families and heading categories.",
      },
      { property: "og:title", content: "Source library — Legal Source Atlas" },
      {
        property: "og:description",
        content:
          "Compact searchable directory of imported U.S. litigation source URLs with filters, detail drawer and exports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LibraryView,
});

function LibraryView() {
  const { bundle } = useAtlas();
  const { view } = Route.useSearch();
  const navigate = useNavigate({ from: "/sources/library" });
  const [withCatalog, setWithCatalog] = useState(true);
  const cat = useQuery({ queryKey: ["catalog-all"], queryFn: loadAllCatalog, staleTime: Infinity, enabled: withCatalog });
  const base = bundle?.sources ?? [];
  const merged = useMemo(() => (withCatalog && cat.data && base.length ? mergeCatalog(base, cat.data) : null), [withCatalog, cat.data, base]);
  const sources = merged?.rows ?? base;

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Sources", to: "/sources/library" }, { label: "Source library" }]}
      title="Sources"
      description="Every distinct source URL in the bundle shipped with this build (or your own browser import). URLs are shown exactly as supplied, including query strings and hash routes."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border p-0.5 text-[12px]">
          <button
            type="button"
            onClick={() => navigate({ search: {} })}
            className={`rounded px-2.5 py-1 ${view !== "endpoints" ? "bg-muted font-semibold" : "text-muted-foreground"}`}
          >
            Sources
          </button>
          <button
            type="button"
            onClick={() => navigate({ search: { view: "endpoints" } })}
            className={`rounded px-2.5 py-1 ${view === "endpoints" ? "bg-muted font-semibold" : "text-muted-foreground"}`}
          >
            Endpoint candidates
          </button>
        </div>
        {view !== "endpoints" ? (
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={withCatalog} onChange={(e) => setWithCatalog(e.target.checked)} />
            Include the source catalog
            <span>{withCatalog ? (cat.isLoading ? "· loading catalog…" : cat.error ? `· catalog could not be loaded: ${(cat.error as Error).message}` : merged ? `· ${base.length.toLocaleString()} directory + ${merged.added.toLocaleString()} catalog-only sources; ${merged.matched.toLocaleString()} share an exact URL and are shown once` : "") : `· ${base.length.toLocaleString()} directory sources`}</span>
          </label>
        ) : null}
      </div>
      {sources.length === 0 ? (
        <EmptyBundleState view="The library" />
      ) : view === "endpoints" ? (
        <EndpointsPanel />
      ) : (
        <LibraryBrowser sources={sources} scope="library" />
      )}
    </AppShell>
  );
}

/** Raw endpoint candidates exactly as recorded in the bundle (no live probing). */
function EndpointsPanel() {
  const { bundle } = useAtlas();
  const candidates = bundle?.endpoint_candidates ?? [];
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return candidates;
    return candidates.filter((c) => {
      const hay = [c.url, c.domain, c.source_family, c.jurisdiction, c.candidate_kind, c.notes].join("  ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [candidates, query]);

  const view = paginate(filtered, page, pageSize);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Endpoint URL copied");
    } catch {
      toast.error("Clipboard blocked by the browser");
    }
  }

  if (candidates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border-strong bg-surface p-6 text-center text-[13px] text-muted-foreground">
        The imported bundle contains no endpoint candidates.
      </p>
    );
  }

  return (
    <>
      <p className="mb-3 text-[12px] text-muted-foreground">
        Raw endpoint candidates exactly as recorded in the bundle. No live requests, probing or crawling — status values are imported text, not a live check.
      </p>
      <div className="relative max-w-xl">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search endpoint URLs, domains, families…"
          className="h-9 pl-8 text-[13px]"
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60">
              <TableHead className="h-9 text-[11px] uppercase tracking-wider">Endpoint</TableHead>
              <TableHead className="h-9 w-24 text-[11px] uppercase tracking-wider">Method</TableHead>
              <TableHead className="h-9 w-40 text-[11px] uppercase tracking-wider">Family</TableHead>
              <TableHead className="h-9 w-36 text-[11px] uppercase tracking-wider">Imported status</TableHead>
              <TableHead className="h-9 w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.items.map((c) => (
              <TableRow key={c.id} className="align-top">
                <TableCell className="py-2">
                  <div className="mono-cell break-all text-foreground">{c.url}</div>
                  {c.notes ? <p className="mt-0.5 text-[11px] text-muted-foreground">{c.notes}</p> : null}
                </TableCell>
                <TableCell className="py-2 font-mono text-[12px]">{c.method ?? "—"}</TableCell>
                <TableCell className="py-2 text-[12px]">{c.source_family || "—"}</TableCell>
                <TableCell className="py-2">
                  {c.imported_status ? (
                    <Badge variant="outline" className="text-[10px]">
                      {c.imported_status}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="py-2">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="size-7" onClick={() => copy(c.url)} aria-label="Copy endpoint URL">
                      <Copy className="size-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-7" asChild>
                      <a href={c.url} target="_blank" rel="noreferrer noopener" aria-label="Open endpoint">
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pager
        page={view.page}
        pageCount={view.pageCount}
        pageSize={pageSize}
        total={view.total}
        from={view.from}
        to={view.to}
        onPage={setPage}
        onPageSize={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />
    </>
  );
}
