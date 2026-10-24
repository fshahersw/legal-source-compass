import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, FileText, Search } from "lucide-react";
import { useState } from "react";
import { Highlighted } from "@/components/courts/rules/Highlighted";
import { hostLabel, plural } from "@/components/courts/rules/ruleFormat";
import {
  getJudgePractices,
  searchJudgePracticeDocuments,
  type JudgeCourtPage,
  type PracticeDoc,
} from "@/lib/external/judgePractices.functions";
import { dateLabel, docsOrdered, retrievedLabel, titleLine } from "./practiceFormat";

const FIRST = 8;

/**
 * The judge's own page on the court's website and the individual rules, practices, procedures, standing orders and forms linked
 * from it, with the date the court prints beside each, and a text search across those documents. Addresses open in the source
 * panel; extracted text and the stored original are on each document's record. Renders nothing when no court page is recorded.
 */
export function JudgePracticesPanel({ judgeId }: { judgeId: string }) {
  const q = useQuery({
    queryKey: ["judge-practices", judgeId],
    queryFn: () => getJudgePractices({ data: { id: judgeId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-24 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading the judge's court page and practices"
      />
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
      >
        The judge's court page and practices could not be loaded.
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      </p>
    );
  const pages = q.data?.pages ?? [];
  if (!pages.length) return null;
  return (
    <>
      {pages.map((p) => (
        <PageCard key={p.id} p={p} />
      ))}
    </>
  );
}

function PageCard({ p }: { p: JudgeCourtPage }) {
  const docs = docsOrdered(p.documents);
  const readable = p.documents.filter((d) => d.retrieved);
  const [all, setAll] = useState(false);
  const shown = all || docs.length <= FIRST + 2 ? docs : docs.slice(0, FIRST);
  return (
    <section
      aria-label={`${p.name} on the ${p.court} website`}
      className="mb-5 rounded-xl border border-border bg-card shadow-xs"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/70 px-4 py-3">
        <h2 className="m-0 text-heading font-semibold text-foreground">Court website page and practices</h2>
        <p className="m-0 text-xs text-muted-foreground">
          {plural(p.documents.length, "document")} linked
          {p.retrievedAt ? ` · read ${retrievedLabel(p.retrievedAt)}` : ""}
        </p>
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="min-w-0 text-[13px] leading-relaxed">
          <p className="m-0 font-medium">{p.nameAsPublished}</p>
          <p className="m-0 text-muted-foreground">
            {titleLine(p.titleAsPublished, p.titleSource)} ·{" "}
            <Link
              to="/courts/$id"
              params={{ id: p.courtId }}
              className="underline-offset-2 hover:underline"
            >
              {p.court}
            </Link>
          </p>
          <p className="m-0 mt-1 text-xs">
            <a
              href={p.pageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-2 hover:underline"
            >
              <span className="truncate">
                {p.pageKind === "listing_entry"
                  ? `Listed on ${hostLabel(p.pageUrl)}`
                  : `Judge's page on ${hostLabel(p.pageUrl)}`}
              </span>
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
            {p.pageKind === "listing_entry" ? (
              <span className="ml-2 text-muted-foreground">
                The court names this judge in a list; there is no page of the judge's own.
              </span>
            ) : null}
          </p>
        </div>
        {docs.length === 0 ? (
          <p className="m-0 rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {p.pageKind === "listing_entry"
              ? "No documents are listed under this judge's name on the court's page."
              : "The judge's page links no individual rules, practices, procedures, standing orders or forms."}{" "}
            The chambers contact details are on the court's page.
          </p>
        ) : (
          <>
            <ul className="m-0 grid list-none gap-2 p-0 lg:grid-cols-2">
              {shown.map((d) => (
                <DocRow key={d.id} d={d} />
              ))}
            </ul>
            {!(all || docs.length <= FIRST + 2) ? (
              <button
                type="button"
                onClick={() => setAll(true)}
                className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
              >
                Show all {docs.length}
              </button>
            ) : null}
            {readable.length ? <DocumentSearch page={p} /> : null}
          </>
        )}
        <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
          Title, document names and dates are as the court's website prints them. Each document's
          original is stored unchanged with its SHA-256; its record shows the extracted text and how
          it was read.
        </p>
      </div>
    </section>
  );
}

function DocRow({ d }: { d: PracticeDoc }) {
  return (
    <li className="min-w-0 rounded-md border border-border/70 px-3 py-2.5">
      <p className="m-0 flex items-start gap-1.5 text-[13px] font-medium leading-snug">
        <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">{d.title}</span>
      </p>
      <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>{dateLabel(d)}</span>
        {d.fileType ? (
          <span className="rounded border border-border px-1 py-px uppercase">{d.fileType}</span>
        ) : null}
        {!d.retrieved ? <span>Not retrieved</span> : null}
      </p>
      <p className="m-0 mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        <a
          href={d.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
        >
          Open <ExternalLink className="size-3" aria-hidden />
        </a>
        <Link
          to="/records/$dataset/$id"
          params={{ dataset: "judge_practice_documents", id: d.id }}
          className="text-primary underline-offset-2 hover:underline"
        >
          Text and file record
        </Link>
      </p>
    </li>
  );
}

function DocumentSearch({ page }: { page: JudgeCourtPage }) {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const search = useInfiniteQuery({
    queryKey: ["judge-practice-search", page.id, q],
    queryFn: ({ pageParam }) =>
      searchJudgePracticeDocuments({ data: { pages: [page.id], q, offset: pageParam } }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.length * 10;
      return last.total !== null && loaded < last.total ? loaded : undefined;
    },
    enabled: q.length >= 2,
    staleTime: 5 * 60 * 1000,
  });
  const hits = search.data?.pages.flatMap((x) => x.hits) ?? [];
  const total = search.data?.pages[0]?.total ?? null;
  const inputId = `judge-practice-search-${page.id}`;
  return (
    <div className="space-y-2 border-t border-border/70 pt-3">
      <form
        role="search"
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Search the text of this judge's documents
        </label>
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Words in this judge's rules, e.g. page limit reply"
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
          Searches the extracted text of{" "}
          {plural(page.documents.filter((d) => d.retrieved).length, "document")}. Every word must
          appear in the document; a word also matches longer words that start with it.
        </p>
      ) : search.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Searching the documents">
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
        <p className="m-0 py-1 text-xs text-muted-foreground">
          No document of this judge contains every word of “{q}”.
        </p>
      ) : (
        <>
          <p className="m-0 text-[11px] text-muted-foreground">
            {total !== null ? plural(total, "document") : "Documents"} match.
          </p>
          <ul className="m-0 list-none divide-y divide-border/70 rounded-md border border-border/70 p-0">
            {hits.map((h) => (
              <li key={h.id} className="px-3 py-2">
                <p className="m-0 text-[13px] font-medium leading-snug">
                  <a
                    href={h.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {h.title}
                  </a>
                  {h.dateText ? (
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                      {h.dateText}
                    </span>
                  ) : null}
                </p>
                <p className="m-0 mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  <Highlighted text={h.snippet} q={q} />
                </p>
                <p className="m-0 mt-1 text-[11px]">
                  <Link
                    to="/records/$dataset/$id"
                    params={{ dataset: "judge_practice_documents", id: h.id }}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    Full extracted text
                  </Link>
                </p>
              </li>
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
