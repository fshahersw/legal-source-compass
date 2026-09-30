import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ExternalBadge, ExternalError } from "@/components/corpus/ExternalBadge";
import { RecordDrawer, useDatasets } from "@/components/corpus/DatasetBrowser";
import { searchCorpus, type SearchHit } from "@/lib/external/catalog.functions";
import { datasetLabel } from "@/lib/external/groups";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>) => ({ q: typeof s["q"] === "string" ? s["q"] : "" }),
  head: () => pageHead("Search", "Search across the connected corpus: court documents, forms, sources and records."),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: "/search" });
  const [draft, setDraft] = useState(q);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<SearchHit | null>(null);
  const ds = useDatasets();
  const fn = useServerFn(searchCorpus);
  const query = useQuery({ queryKey: ["corpus-search", q, offset], queryFn: () => fn({ data: { q, offset } }), enabled: q.trim().length >= 2, placeholderData: keepPreviousData });
  const d = query.data;
  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Search" }]} title="Search the corpus" description="Uses the corpus's own search. Results are ranked by the database; nothing is added or re-scored here.">
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setOffset(0); navigate({ search: { q: draft } }); }}>
        <Input aria-label="Search the corpus" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. asbestos, talc, Harris County" className="max-w-md" />
        <Button type="submit" size="sm">Search</Button>
        <ExternalBadge />
        {d?.total != null ? <span className="text-[12px] text-muted-foreground">{d.total.toLocaleString()} results</span> : null}
      </form>
      {query.error ? <ExternalError error={query.error} /> : null}
      {q.trim().length < 2 ? <p className="text-[13px] text-muted-foreground">Enter at least two characters.</p> : null}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
        {query.isLoading ? <li className="px-3 py-3 text-[13px] text-muted-foreground">Searching…</li> : null}
        {d?.hits.map((h) => (
          <li key={`${h.dataset}-${h.id}`}>
            <button className="w-full px-3 py-2 text-left hover:bg-muted/50" onClick={() => setOpen(h)}>
              <div className="text-[13px] font-medium">{h.title}</div>
              <div className="text-[11px] text-muted-foreground">{[datasetLabel(h.dataset, null), h.kind?.replace(/_/g, " "), h.county, h.state].filter(Boolean).join(" · ")}</div>
            </button>
          </li>
        ))}
        {d && !d.hits.length ? <li className="px-3 py-3 text-[13px] text-muted-foreground">No results.</li> : null}
      </ul>
      {d?.hits.length ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
          <Button size="sm" variant="outline" disabled={d.hits.length < 50} onClick={() => setOffset(offset + 50)}>Next</Button>
        </div>
      ) : null}
      <RecordDrawer item={open ? { id: open.id, title: open.title, sourceUrl: open.source_url ?? null } : null} dataset={open && ds.aliases[open.dataset] ? ds.aliases[open.dataset] : null} onClose={() => setOpen(null)} aliases={ds.aliases} />
    </AppShell>
  );
}
