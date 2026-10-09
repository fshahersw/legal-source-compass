import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { getStateCodeCoverage, getStateCodeEntry } from "@/lib/law/stateCode.functions";
import { loadStateLawDirectory } from "@/lib/corpus/lawSources";
import { safeResourceHref } from "@/lib/corpus/resourcePresentation";

/** Compact reader entry. Importing data never implies publication or legal currency. */
export function FullCodeEntry({ state }: { state: string }) {
  const usps = state.toUpperCase();
  const read = useServerFn(getStateCodeEntry),
    readCoverage = useServerFn(getStateCodeCoverage);
  const query = useQuery({
    queryKey: ["state-code-entry", usps],
    queryFn: () => read({ data: { state: usps } }),
    staleTime: 60_000,
  });
  const rows = query.data ?? [];
  const needFallback = !query.isPending && !query.error && !rows.length;
  const coverage = useQuery({
    queryKey: ["state-code-coverage"],
    queryFn: () => readCoverage(),
    enabled: needFallback,
    staleTime: 60_000,
  });
  const directory = useQuery({
    queryKey: ["state-law-directory"],
    queryFn: loadStateLawDirectory,
    enabled: needFallback,
    staleTime: 300_000,
  });
  const intake = coverage.data?.find((r) => r.state === usps);
  const publisher = directory.data?.find((r) => r.code === usps)?.codeLink;
  const publisherHref = safeResourceHref(publisher?.url);
  const error = query.error || coverage.error;
  return (
    <section className="resource-panel" aria-label="Full code">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-[var(--blue-tint)] px-3 py-2.5">
        <h2 className="flex items-center gap-2 font-sans text-sm font-semibold text-primary">
          <BookOpen className="size-4" aria-hidden />
          State statutes
        </h2>
        <span className="text-[11px] font-medium text-muted-foreground">
          {query.isPending
            ? "Loading…"
            : error
              ? "Status unavailable"
              : rows.length
                ? "Read in the workspace"
                : intake?.status === "landed-private"
                  ? "Local copy pending review"
                  : "Publisher access"}
        </span>
      </div>
      {query.isPending ? (
        <p role="status" className="px-3 py-4 text-xs text-muted-foreground">
          Loading statutes…
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 p-3 text-xs">
          <span>Statute availability could not be checked.</span>
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              void query.refetch();
              if (needFallback) void coverage.refetch();
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      {!query.isPending && !error && !rows.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
          <p className="text-xs text-muted-foreground">
            {intake?.status === "landed-private"
              ? "The local copy is awaiting source review."
              : "A reviewed local copy is not available yet."}
          </p>
          {publisherHref ? (
            <a
              href={publisherHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-primary"
            >
              Open publisher
              <ArrowUpRight className="size-3.5" />
            </a>
          ) : directory.isFetching ? (
            <span role="status" className="text-xs text-muted-foreground">
              Finding publisher…
            </span>
          ) : null}
        </div>
      ) : null}
      {rows.map((row) => (
        <div key={`${row.kind}-${row.datasetId ?? row.state}`}>
          <Link
            to="/law/codes/$state"
            params={{ state: row.state }}
            search={{ q: "" }}
            className="resource-row"
          >
            <span className="resource-icon">
              <BookOpen className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">{row.codeName}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {row.sectionCount == null
                  ? "Browse titles and sections"
                  : `${row.sectionCount.toLocaleString()} sections · browse or search`}
              </span>
            </span>
            <ArrowUpRight className="size-4 text-primary" />
          </Link>
          {row.edition || row.currency ? (
            <details className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Source version</summary>
              <p className="mt-1.5 leading-relaxed">
                {row.edition ? `Edition: ${row.edition}. ` : ""}
                {row.currency
                  ? `Currency: ${row.currency}.`
                  : "The compilation-through date is not established."}
              </p>
            </details>
          ) : null}
        </div>
      ))}
    </section>
  );
}
