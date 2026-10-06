import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ExternalBadge, ExternalError } from "@/components/corpus/ExternalBadge";
import { CorpusRecordLink } from "@/components/corpus/DatasetBrowser";
import { searchCorpus } from "@/lib/external/catalog.functions";
import { listStateCodes, searchStateCodes } from "@/lib/law/stateCode.functions";
import { datasetDisplayName } from "@/lib/external/domainRegistry";
import { searchKindLabel } from "@/lib/external/searchQuality";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/search")({
  // A hand-typed or shared URL such as /search?q=3140 is parsed as the number 3140; keep it as the text it is.
  validateSearch: (s: Record<string, unknown>) => ({
    q:
      typeof s["q"] === "string"
        ? s["q"]
        : typeof s["q"] === "number" && Number.isFinite(s["q"])
          ? String(s["q"])
          : "",
  }),
  head: () =>
    pageHead(
      "Search",
      "Search across the connected corpus: court documents, forms, sources and records.",
    ),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: "/search" });
  const [draft, setDraft] = useState(q);
  const [offset, setOffset] = useState(0);
  const fn = useServerFn(searchCorpus);
  const codeFn = useServerFn(searchStateCodes);
  const listFn = useServerFn(listStateCodes);
  const query = useQuery({
    queryKey: ["corpus-search", q, offset],
    queryFn: () => fn({ data: { q, offset } }),
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
  const codes = useQuery({
    queryKey: ["state-code-search", q],
    queryFn: () => codeFn({ data: { q } }),
    enabled: q.trim().length >= 2,
  });
  const catalog = useQuery({
    queryKey: ["full-state-codes"],
    queryFn: () => listFn(),
    staleTime: 60_000,
    enabled: q.trim().length >= 2,
  });
  const codeState = new Map(
    (catalog.data ?? []).flatMap((row) =>
      row.datasetId ? [[row.datasetId, row.state] as const] : [],
    ),
  );
  const snapshotHits = (codes.data?.hits ?? []).filter((hit) => hit.kind === "snapshot");
  const d = query.data;
  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Search" }]}
      title="Search the corpus"
      description="Search published records. Names, headings and MDL matters that match appear first, and a search that starts with Judge or Hon. looks for the person; duplicate source cards keep their original record links."
    >
      <form
        className="mb-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          navigate({ search: { q: draft } });
        }}
      >
        <Input
          aria-label="Search the corpus"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. asbestos, talc, Harris County"
          className="max-w-md"
        />
        <Button type="submit" size="sm">
          Search
        </Button>
        <ExternalBadge />
        {d?.total != null ? (
          <span className="text-[12px] text-muted-foreground">
            {d.total.toLocaleString()} matching published rows ·{" "}
            {d.rankedCandidates.toLocaleString()} ranked cards
            {d.groupedSourceRecords
              ? ` · ${d.groupedSourceRecords.toLocaleString()} duplicate source rows grouped`
              : ""}
          </span>
        ) : null}
      </form>
      {query.error ? <ExternalError error={query.error} /> : null}
      {d?.candidateCapped ? (
        <p role="status" className="mb-3 text-[12px] text-muted-foreground">
          Ranking covers a bounded set of up to {d.candidateLimit.toLocaleString()} candidate rows,
          including targeted matches in MDLs, Seeger Weiss matters, judges and people, courts, and
          expert-admissibility entries. Refine your search to see a narrower set.
        </p>
      ) : null}
      {d?.unresolved ? (
        <p role="status" className="mb-3 text-[12px] text-muted-foreground">
          {d.unresolved.toLocaleString()} candidate occurrences could not be linked to an exact
          dataset and record. Their identity is not inferred.
        </p>
      ) : null}
      {q.trim().length < 2 ? (
        <p className="text-[13px] text-muted-foreground">Enter at least two characters.</p>
      ) : null}
      {q.trim().length >= 2 && (codes.isFetching || snapshotHits.length > 0) ? (
        <section className="mb-4">
          <h2 className="eyebrow">Full state codes</h2>
          {codes.isFetching ? (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Searching captured code citations and headings…
            </p>
          ) : null}
          {codes.error ? (
            <div className="mt-2">
              <ExternalError error={codes.error} />
            </div>
          ) : null}
          {snapshotHits.length ? (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
              {snapshotHits.map((hit) => (
                <li key={`${hit.state}-${hit.id}`}>
                  <Link
                    to="/law/codes/$state"
                    params={{ state: hit.state }}
                    search={{
                      q: "",
                      code: hit.code ?? undefined,
                      chapter: hit.chapterId ?? undefined,
                      section: hit.id,
                    }}
                    className="block px-3 py-2 hover:bg-muted/50"
                  >
                    <div className="text-[13px] font-medium">{hit.citation ?? hit.heading}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {[hit.state, hit.heading].filter(Boolean).join(" · ")}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
        {query.isLoading ? (
          <li className="px-3 py-3 text-[13px] text-muted-foreground">Searching…</li>
        ) : null}
        {d?.hits.map((h) => {
          const fullCode = codeState.get(h.dataset);
          const body = (
            <>
              <div className="text-[13px] font-medium">{h.title}</div>
              <div className="text-[11px] text-muted-foreground">
                {[
                  datasetDisplayName(h.dataset, null),
                  searchKindLabel(h.kind, h.dataset),
                  h.county,
                  h.state
                    ? `${h.stateBasis === "exact_court_location" ? "Court location" : "Recorded state"}: ${h.state}`
                    : null,
                  h.sourceFileLabel,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </>
          );
          return (
            <li key={`${h.dataset}-${h.id}`}>
              {fullCode ? (
                <Link
                  to="/law/codes/$state"
                  params={{ state: fullCode }}
                  search={{ q: "", section: h.id }}
                  className="block w-full px-3 py-2 text-left hover:bg-muted/50"
                >
                  {body}
                </Link>
              ) : (
                <CorpusRecordLink
                  dataset={h.dataset}
                  id={h.id}
                  className="block w-full px-3 py-2 text-left hover:bg-muted/50"
                >
                  {body}
                </CorpusRecordLink>
              )}
              {h.alsoIndexedAs.length > 0 ? (
                <details className="px-3 pb-2 text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer">
                    Also indexed in {h.alsoIndexedAs.length} identical source record
                    {h.alsoIndexedAs.length === 1 ? "" : "s"}
                  </summary>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {h.alsoIndexedAs.map((identity) => (
                      <CorpusRecordLink
                        key={`${identity.dataset}-${identity.id}`}
                        dataset={identity.dataset}
                        id={identity.id}
                        className="underline"
                      >
                        {datasetDisplayName(identity.dataset, null)} · {identity.id}
                      </CorpusRecordLink>
                    ))}
                  </div>
                </details>
              ) : null}
            </li>
          );
        })}
        {d && d.returned === 0 ? (
          <li className="px-3 py-3 text-[13px] text-muted-foreground">No results.</li>
        ) : null}
      </ul>
      {d && d.returned > 0 ? (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!d.hasMore}
            onClick={() => setOffset(offset + 50)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </AppShell>
  );
}
