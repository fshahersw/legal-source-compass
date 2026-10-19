import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink, Search } from "lucide-react";
import { useState } from "react";
import {
  getCourtRuleSection,
  searchCourtRuleSections,
  type RuleDocument,
  type RuleSectionHit,
} from "@/lib/external/courtRules.functions";
import { Highlighted } from "./Highlighted";
import { oneLine } from "./ruleFormat";

/** Full-text search over the rule text of the documents that apply to this court; a hit expands to the rule. */
export function RuleTextSearch({
  courtId,
  documents,
}: {
  courtId: string;
  documents: RuleDocument[];
}) {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const titles = new Map(documents.map((d) => [d.id, d.title]));
  const docs = documents.map((d) => d.id);
  const search = useInfiniteQuery({
    queryKey: ["court-rule-search", courtId, q],
    queryFn: ({ pageParam }) => searchCourtRuleSections({ data: { docs, q, offset: pageParam } }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.length * 12;
      return last.total !== null && loaded < last.total ? loaded : undefined;
    },
    enabled: q.length >= 2,
    staleTime: 5 * 60 * 1000,
  });
  const hits = search.data?.pages.flatMap((p) => p.hits) ?? [];
  const total = search.data?.pages[0]?.total ?? null;
  return (
    <div className="space-y-2 pt-1">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
        }}
      >
        <label htmlFor={`rule-search-${courtId}`} className="sr-only">
          Search the text of these rules
        </label>
        <input
          id={`rule-search-${courtId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Words in the rules, e.g. summary judgment reply"
          className="w-full max-w-md rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={draft.trim().length < 2}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          <Search className="size-3.5" aria-hidden /> Search
        </button>
      </form>
      {q.length < 2 ? (
        <p className="m-0 text-[11px] text-muted-foreground">
          Searches {documents.length.toLocaleString("en-US")} rule documents, rule by rule. Every
          word must appear in the rule; a word also matches longer words that start with it.
        </p>
      ) : search.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Searching rule text">
          {[0, 1].map((n) => (
            <div key={n} className="h-12 animate-pulse rounded-md bg-muted/50" />
          ))}
        </div>
      ) : search.isError ? (
        <p role="alert" className="m-0 flex items-center gap-2 text-xs text-muted-foreground">
          The search could not be completed.
          <button
            type="button"
            onClick={() => void search.refetch()}
            className="text-primary underline"
          >
            Retry
          </button>
        </p>
      ) : hits.length === 0 ? (
        <p className="m-0 py-2 text-xs text-muted-foreground">
          No rule in these documents contains every word of “{q}”.
        </p>
      ) : (
        <>
          <p className="m-0 text-[11px] text-muted-foreground">
            {total !== null ? `${total.toLocaleString("en-US")} rules match` : "Rules that match"},
            in document order.
          </p>
          <ul className="m-0 list-none divide-y divide-border/70 rounded-md border border-border/70 p-0">
            {hits.map((h) => (
              <HitRow key={h.id} h={h} q={q} docTitle={titles.get(h.doc) ?? h.doc} />
            ))}
          </ul>
          {search.hasNextPage ? (
            <button
              type="button"
              onClick={() => void search.fetchNextPage()}
              disabled={search.isFetchingNextPage}
              className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-60"
            >
              {search.isFetchingNextPage ? "Loading…" : "Show more"}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function HitRow({ h, q, docTitle }: { h: RuleSectionHit; q: string; docTitle: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-1.5 text-left"
      >
        {open ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="min-w-0">
          <span className="block text-[13px] font-medium leading-snug">{oneLine(h.title)}</span>
          <span className="block text-[11px] text-muted-foreground">
            {docTitle}
            {h.page ? ` · page ${h.page}` : ""}
          </span>
          {!open ? (
            <Highlighted
              text={h.snippet}
              q={q}
              className="mt-1 block text-xs leading-relaxed text-foreground/80"
            />
          ) : null}
        </span>
      </button>
      {open ? <SectionReader id={h.id} sourceUrl={h.sourceUrl} /> : null}
    </li>
  );
}

function SectionReader({ id, sourceUrl }: { id: string; sourceUrl: string }) {
  const q = useQuery({
    queryKey: ["court-rule-section", id],
    queryFn: () => getCourtRuleSection({ data: { id } }),
    staleTime: 30 * 60 * 1000,
  });
  return (
    <div className="ml-5 mt-1.5">
      {q.isLoading ? (
        <div
          className="h-24 animate-pulse rounded-md bg-muted/50"
          aria-busy="true"
          aria-label="Loading rule text"
        />
      ) : q.isError ? (
        <p role="alert" className="m-0 flex items-center gap-2 text-xs text-muted-foreground">
          The rule text could not be loaded.
          <button type="button" onClick={() => void q.refetch()} className="text-primary underline">
            Retry
          </button>
        </p>
      ) : !q.data ? (
        <p className="m-0 text-xs text-muted-foreground">
          The stored text of this rule could not be read.
        </p>
      ) : (
        <>
          <pre className="m-0 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-muted/30 p-3 font-sans text-xs leading-relaxed">
            {q.data.text}
          </pre>
          {q.data.truncated ? (
            <p className="m-0 mt-1 text-[11px] text-muted-foreground">
              This rule is long; the first {q.data.text.length.toLocaleString("en-US")} characters
              are shown.
            </p>
          ) : null}
        </>
      )}
      <p className="m-0 mt-1.5 text-[11px]">
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
        >
          Official text <ExternalLink className="size-3" aria-hidden />
        </a>
        <span className="ml-2 text-muted-foreground">
          Text as extracted from the official file; layout, footnotes and tables may differ from the
          page.
        </span>
      </p>
    </div>
  );
}
