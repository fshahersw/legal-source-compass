import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { semanticRelated } from "@/lib/semantic/semantic.functions";
import {
  SEMANTIC_NOTE_SHORT,
  passageLabel,
  type RelatedOutcome,
  type SemanticDatasetId,
  type SemanticHit,
} from "@/lib/semantic/semantic";

export type RelatedView =
  { kind: "loading" } | { kind: "error" } | { kind: "outcome"; outcome: RelatedOutcome };

function Frame({
  heading,
  children,
  footer,
  className,
}: {
  heading: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string | undefined;
}) {
  return (
    <section
      aria-label={`${heading} items`}
      className={cn("rounded-lg border border-border bg-surface shadow-card", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 border-b border-border px-3 py-2">
        <h2 className="eyebrow">{heading}</h2>
        <span className="text-[11px] text-muted-foreground">{SEMANTIC_NOTE_SHORT}</span>
      </div>
      {children}
      {footer ? (
        <p className="border-t border-border px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
          {footer}
        </p>
      ) : null}
    </section>
  );
}

function Message({
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

export function RelatedRow({
  hit,
  showSnippet = false,
}: {
  hit: SemanticHit;
  showSnippet?: boolean;
}) {
  const passage = passageLabel(hit);
  return (
    <li>
      <Link
        to={hit.href as never}
        className="flex gap-2 px-3 py-2 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
        title={hit.snippet || undefined}
      >
        <span
          className="mt-px w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground"
          aria-label={`Rank ${hit.rank}`}
        >
          #{hit.rank}
        </span>
        <span className="min-w-0">
          <span className="block break-words text-[13px] font-medium leading-snug">
            {hit.title}
          </span>
          <span className="block text-[11px] leading-4 text-muted-foreground">
            {[hit.datasetLabel, passage].filter(Boolean).join(" · ")}
          </span>
          {showSnippet && hit.snippet ? (
            <span className="mt-0.5 line-clamp-2 block text-[12px] leading-4 text-muted-foreground">
              {hit.snippet}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/** The panel's body for one state; pure, so every state can be rendered and checked without a server. */
export function RelatedPanelView({
  view,
  onRetry,
  heading = "Similar by meaning",
  className,
  showSnippets = false,
}: {
  view: RelatedView;
  onRetry?: (() => void) | undefined;
  heading?: string;
  className?: string | undefined;
  showSnippets?: boolean;
}) {
  if (view.kind === "loading")
    return (
      <Frame heading={heading} className={className}>
        <ul aria-busy="true" aria-label="Loading related items" className="divide-y divide-border">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex gap-2 px-3 py-2">
              <span className="mt-0.5 h-3 w-6 shrink-0 animate-pulse rounded bg-muted" />
              <span className="min-w-0 flex-1 space-y-1.5">
                <span className="block h-3.5 w-11/12 animate-pulse rounded bg-muted" />
                <span className="block h-3 w-1/3 animate-pulse rounded bg-muted/70" />
              </span>
            </li>
          ))}
        </ul>
      </Frame>
    );
  if (view.kind === "error")
    return (
      <Frame heading={heading} className={className}>
        <Message onRetry={onRetry}>Related items could not be loaded.</Message>
      </Frame>
    );
  const o = view.outcome;
  switch (o.status) {
    case "ok":
      if (o.hits.length === 0)
        return (
          <Frame heading={heading} className={className}>
            <Message>No related items were found in the semantic index.</Message>
          </Frame>
        );
      return (
        <Frame
          heading={heading}
          className={className}
          footer="Ordered by closeness of meaning to this page; #1 is closest. Suggestions only: a match does not link sources or show that one relies on another."
        >
          <ol className="divide-y divide-border">
            {o.hits.map((h) => (
              <RelatedRow key={`${h.dataset}/${h.recordId}`} hit={h} showSnippet={showSnippets} />
            ))}
          </ol>
        </Frame>
      );
    case "not_indexed":
      return (
        <Frame heading={heading} className={className}>
          <Message>
            This item is not in the semantic index, so no related items are suggested.
          </Message>
        </Frame>
      );
    case "not_loaded":
      return (
        <Frame heading={heading} className={className}>
          <Message>The semantic index is not loaded yet.</Message>
        </Frame>
      );
    case "unavailable":
      return (
        <Frame heading={heading} className={className}>
          <Message onRetry={onRetry}>
            {o.reason === "version"
              ? "The semantic index is being updated; related items are paused."
              : "Related items are temporarily unavailable."}
          </Message>
        </Frame>
      );
    case "invalid":
      return (
        <Frame heading={heading} className={className}>
          <Message>Related items are not available for this item.</Message>
        </Frame>
      );
  }
}

/**
 * Related records for a statute section, regulation, case, report or bill, found by the closeness of their text in meaning.
 * Mount it where the page has the record's dataset and id, e.g. <RelatedPanel dataset="us_code_sections" recordId="15:78u-6" />.
 */
export function RelatedPanel({
  dataset,
  recordId,
  limit = 6,
  scope,
  heading = "Similar by meaning",
  className,
  showSnippets = false,
  quiet = false,
}: {
  dataset: SemanticDatasetId;
  recordId: string;
  limit?: number;
  /** Optional: only suggest records of these datasets. */
  scope?: SemanticDatasetId[] | undefined;
  heading?: string;
  className?: string | undefined;
  showSnippets?: boolean;
  /** Render nothing while the index is not set up (not loaded, record not indexed), instead of saying so. */
  quiet?: boolean;
}) {
  const fn = useServerFn(semanticRelated);
  const q = useQuery({
    queryKey: ["semantic-related", dataset, recordId, limit, scope?.join(",") ?? ""],
    queryFn: () => fn({ data: { dataset, recordId, limit, datasets: scope } }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const view: RelatedView = q.isPending
    ? { kind: "loading" }
    : q.isError
      ? { kind: "error" }
      : { kind: "outcome", outcome: q.data };
  if (
    quiet &&
    view.kind === "outcome" &&
    ["not_loaded", "not_indexed", "invalid"].includes(view.outcome.status)
  )
    return null;
  return (
    <RelatedPanelView
      view={view}
      onRetry={() => void q.refetch()}
      heading={heading}
      className={className}
      showSnippets={showSnippets}
    />
  );
}
