import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ExternalBadge, ExternalError } from "@/components/corpus/ExternalBadge";
import { CorpusRecordLink } from "@/components/corpus/DatasetBrowser";
import { searchCorpus } from "@/lib/external/catalog.functions";
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
  const fn = useServerFn(searchCorpus);
  const query = useQuery({ queryKey: ["corpus-search", q, offset], queryFn: () => fn({ data: { q, offset } }), enabled: q.trim().length >= 2, placeholderData: keepPreviousData });
  const d = query.data;
  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Search" }]} title="Search the corpus" description="Search published records. Matching headings, MDLs and expert-admissibility docket entries appear first; duplicate source cards keep their original record links.">
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setOffset(0); navigate({ search: { q: draft } }); }}>
        <Input aria-label="Search the corpus" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. asbestos, talc, Harris County" className="max-w-md" />
        <Button type="submit" size="sm">Search</Button>
        <ExternalBadge />
        {d?.total != null ? <span className="text-[12px] text-muted-foreground">{d.total.toLocaleString()} matching published rows · {d.rankedCandidates.toLocaleString()} ranked cards{d.groupedSourceRecords ? ` · ${d.groupedSourceRecords.toLocaleString()} duplicate source rows grouped` : ""}</span> : null}
      </form>
      {query.error ? <ExternalError error={query.error} /> : null}
      {d?.candidateCapped ? <p role="status" className="mb-3 text-[12px] text-muted-foreground">Ranking covers a bounded set of up to {d.candidateLimit.toLocaleString()} candidate rows, including targeted MDL and expert-admissibility matches. Refine your search to see a narrower set.</p> : null}
      {d?.unresolved ? <p role="status" className="mb-3 text-[12px] text-muted-foreground">{d.unresolved.toLocaleString()} candidate occurrences could not be linked to an exact dataset and record. Their identity is not inferred.</p> : null}
      {q.trim().length < 2 ? <p className="text-[13px] text-muted-foreground">Enter at least two characters.</p> : null}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
        {query.isLoading ? <li className="px-3 py-3 text-[13px] text-muted-foreground">Searching…</li> : null}
        {d?.hits.map((h) => (
          <li key={`${h.dataset}-${h.id}`}>
            <CorpusRecordLink dataset={h.dataset} id={h.id} className="block w-full px-3 py-2 text-left hover:bg-muted/50">
              <div className="text-[13px] font-medium">{h.title}</div>
              <div className="text-[11px] text-muted-foreground">{[datasetLabel(h.dataset, null), h.kind?.replace(/_/g, " "), h.county, h.state ? `${h.stateBasis === "exact_court_location" ? "Court location" : "Recorded state"}: ${h.state}` : null, h.sourceFileLabel].filter(Boolean).join(" · ")}</div>
            </CorpusRecordLink>
            {h.alsoIndexedAs.length > 0 ? <details className="px-3 pb-2 text-[11px] text-muted-foreground"><summary className="cursor-pointer">Also indexed in {h.alsoIndexedAs.length} identical source record{h.alsoIndexedAs.length === 1 ? "" : "s"}</summary><div className="mt-1 flex flex-wrap gap-2">{h.alsoIndexedAs.map((identity) => <CorpusRecordLink key={`${identity.dataset}-${identity.id}`} dataset={identity.dataset} id={identity.id} className="underline">{datasetLabel(identity.dataset, null)} · {identity.id}</CorpusRecordLink>)}</div></details> : null}
          </li>
        ))}
        {d && d.returned === 0 ? <li className="px-3 py-3 text-[13px] text-muted-foreground">No results.</li> : null}
      </ul>
      {d && d.returned > 0 ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
          <Button size="sm" variant="outline" disabled={!d.hasMore} onClick={() => setOffset(offset + 50)}>Next</Button>
        </div>
      ) : null}
    </AppShell>
  );
}
