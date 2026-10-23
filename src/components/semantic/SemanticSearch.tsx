import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getSemanticCoverage, semanticSearch } from "@/lib/semantic/semantic.functions";
import {
  MAX_QUERY_CHARS,
  SEMANTIC_DATASETS,
  SEMANTIC_NOTE,
  normalizeQuery,
  passageLabel,
  type SearchOutcome,
  type SemanticCoverage,
  type SemanticDatasetId,
  type SemanticHit,
} from "@/lib/semantic/semantic";

export type SearchView =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "error" }
  | { kind: "outcome"; outcome: SearchOutcome };

const EXAMPLES = [
  "limits on how long a claim can be brought after discovery of the fraud",
  "duty of an agency to give notice before issuing a rule",
  "protection against retaliation for reporting violations",
];

function Status({
  children,
  onRetry,
}: {
  children: React.ReactNode;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <p
      role="status"
      className="flex flex-wrap items-center gap-2 px-3 py-3 text-[13px] text-muted-foreground"
    >
      {children}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      ) : null}
    </p>
  );
}

function HitRow({ hit }: { hit: SemanticHit }) {
  const passage = passageLabel(hit);
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <span
        className="mt-px w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground"
        aria-label={`Rank ${hit.rank}`}
      >
        #{hit.rank}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          to={hit.href as never}
          className="break-words text-[13px] font-medium leading-snug text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {hit.title}
        </Link>
        <div className="text-[11px] leading-4 text-muted-foreground">
          {[hit.datasetLabel, passage].filter(Boolean).join(" · ")}
        </div>
        {hit.snippet ? (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-muted-foreground">
            {hit.snippet}
          </p>
        ) : null}
      </div>
      {hit.sourceUrl ? (
        <a
          href={hit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 shrink-0 rounded text-muted-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={`Open the official source of ${hit.title}`}
          title="Open the official source"
        >
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      ) : null}
    </li>
  );
}

/** Results area for one state; pure, so every state can be rendered and checked without a server. */
export function SearchResultsView({
  view,
  onRetry,
  onExample,
  showExamples = true,
}: {
  view: SearchView;
  onRetry?: (() => void) | undefined;
  onExample?: ((q: string) => void) | undefined;
  showExamples?: boolean;
}) {
  const frame = "rounded-lg border border-border bg-surface shadow-card";
  if (view.kind === "idle")
    return showExamples && onExample ? (
      <div className="text-[12px] text-muted-foreground">
        <p>Describe what you are looking for in plain words. For example:</p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <li key={ex}>
              <button
                type="button"
                onClick={() => onExample(ex)}
                className="rounded-full border border-border px-2.5 py-1 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
              >
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  if (view.kind === "loading")
    return (
      <div className={frame}>
        <ul aria-busy="true" aria-label="Searching by meaning" className="divide-y divide-border">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex gap-2 px-3 py-2.5">
              <span className="mt-0.5 h-3 w-6 shrink-0 animate-pulse rounded bg-muted" />
              <span className="min-w-0 flex-1 space-y-1.5">
                <span className="block h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                <span className="block h-3 w-1/4 animate-pulse rounded bg-muted/70" />
                <span className="block h-3 w-11/12 animate-pulse rounded bg-muted/50" />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  if (view.kind === "error")
    return (
      <div className={frame}>
        <Status onRetry={onRetry}>The search could not be completed.</Status>
      </div>
    );
  const o = view.outcome;
  switch (o.status) {
    case "ok":
      return (
        <div>
          <p className="mb-1.5 text-[12px] text-muted-foreground">
            {o.hits.length === 0
              ? "No records are close in meaning to this description."
              : `${o.hits.length} ${o.hits.length === 1 ? "record" : "records"}, ranked by closeness of meaning (#1 is closest).`}
          </p>
          {o.hits.length > 0 ? (
            <ol className={cn(frame, "divide-y divide-border")}>
              {o.hits.map((h) => (
                <HitRow key={`${h.dataset}/${h.recordId}`} hit={h} />
              ))}
            </ol>
          ) : null}
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{SEMANTIC_NOTE}</p>
        </div>
      );
    case "not_configured":
      return (
        <div className={frame}>
          <Status>Search by meaning is not configured on this deployment.</Status>
        </div>
      );
    case "not_loaded":
      return (
        <div className={frame}>
          <Status>The semantic index is not loaded yet.</Status>
        </div>
      );
    case "invalid":
      return (
        <div className={frame}>
          <Status>{o.message}</Status>
        </div>
      );
    case "unavailable":
      return (
        <div className={frame}>
          <Status onRetry={onRetry}>
            {o.reason === "busy"
              ? "Search by meaning is busy. Try again in a moment."
              : o.reason === "version"
                ? "The semantic index is being updated; search by meaning is paused."
                : "Search by meaning is temporarily unavailable."}
          </Status>
        </div>
      );
  }
}

export function DatasetChips({
  available,
  selected,
  onToggle,
}: {
  available: readonly { id: SemanticDatasetId; label: string }[];
  selected: ReadonlySet<SemanticDatasetId>;
  onToggle: (id: SemanticDatasetId) => void;
}) {
  return (
    <div role="group" aria-label="Limit to" className="flex flex-wrap gap-1.5">
      {available.map((d) => {
        const on = selected.has(d.id);
        return (
          <button
            key={d.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(d.id)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[12px] focus-visible:outline-2 focus-visible:outline-ring",
              on
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted/50",
            )}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Search by meaning. Two ways to mount it:
 *   <SemanticSearch />                    its own input (e.g. a "By meaning" section)
 *   <SemanticSearch query={q} />          follows the page's own query (e.g. the global search page's ?q=)
 */
export function SemanticSearch({
  query,
  initialQuery = "",
  datasets,
  limit = 10,
  className,
  onSearch,
}: {
  query?: string | undefined;
  initialQuery?: string;
  /** Restrict to these datasets and hide the dataset filter. */
  datasets?: SemanticDatasetId[] | undefined;
  limit?: number;
  className?: string | undefined;
  onSearch?: ((q: string) => void) | undefined;
}) {
  const driven = query !== undefined;
  const [draft, setDraft] = useState(driven ? query : initialQuery);
  const [submitted, setSubmitted] = useState(normalizeQuery(driven ? query : initialQuery));
  const [picked, setPicked] = useState<ReadonlySet<SemanticDatasetId>>(new Set());
  useEffect(() => {
    if (driven) setSubmitted(normalizeQuery(query));
  }, [driven, query]);

  const coverageFn = useServerFn(getSemanticCoverage);
  const coverage = useQuery({
    queryKey: ["semantic-coverage"],
    queryFn: () => coverageFn(),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: !datasets,
  });
  const loaded: readonly SemanticCoverage[] | null =
    coverage.data?.status === "ok" ? coverage.data.datasets : null;
  const chips = SEMANTIC_DATASETS.filter((d) => !loaded || loaded.some((l) => l.dataset === d.id));
  const scope = datasets ?? (picked.size ? [...picked].sort() : undefined);

  const fn = useServerFn(semanticSearch);
  const ready = submitted.length >= 2;
  const q = useQuery({
    queryKey: ["semantic-search", submitted, scope?.join(",") ?? "", limit],
    queryFn: () => fn({ data: { query: submitted, datasets: scope, limit } }),
    enabled: ready,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const view: SearchView = !ready
    ? { kind: "idle" }
    : q.isPending
      ? { kind: "loading", query: submitted }
      : q.isError
        ? { kind: "error" }
        : { kind: "outcome", outcome: q.data };

  const run = (text: string) => {
    const n = normalizeQuery(text);
    setDraft(n);
    setSubmitted(n);
    onSearch?.(n);
  };

  return (
    <section aria-label="Search by meaning" className={cn("space-y-2", className)}>
      {driven ? (
        <h2 className="eyebrow">
          By meaning
          {submitted ? (
            <span className="ml-1 normal-case tracking-normal text-muted-foreground">
              “{submitted}”
            </span>
          ) : null}
        </h2>
      ) : (
        <form
          role="search"
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(draft);
          }}
        >
          <div className="relative min-w-0 flex-1 basis-64">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label="Describe what you are looking for"
              value={draft}
              maxLength={MAX_QUERY_CHARS - 1}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Describe a duty, right or situation"
              className="pl-7"
            />
          </div>
          <Button type="submit" size="sm" disabled={normalizeQuery(draft).length < 2}>
            Search by meaning
          </Button>
        </form>
      )}
      {!datasets && chips.length > 1 ? (
        <DatasetChips
          available={chips}
          selected={picked}
          onToggle={(id) =>
            setPicked((cur) => {
              const next = new Set(cur);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
        />
      ) : null}
      <div aria-live="polite">
        <SearchResultsView
          view={view}
          onRetry={() => void q.refetch()}
          onExample={driven ? undefined : run}
          showExamples={!driven}
        />
      </div>
    </section>
  );
}
