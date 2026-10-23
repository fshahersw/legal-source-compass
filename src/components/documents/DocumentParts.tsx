import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  TEXT_STATUS_LABEL,
  TEXT_STATUS_NOTE,
  linkTarget,
  type DocLinkRow,
  type Snippet,
  type TextStatus,
} from "@/lib/documents/documents";
import { cn } from "@/lib/utils";

/** Matched words come from the search's own [[ ]] markers, already split server-side; nothing else is highlighted. */
export function SnippetText({ snippet }: { snippet: Snippet }) {
  return (
    <span>
      {snippet.parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

export function TextStatusTag({ status, className }: { status: TextStatus; className?: string }) {
  const quiet = status === "text_layer";
  return (
    <span
      title={TEXT_STATUS_NOTE[status]}
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-px text-[10px] leading-4",
        quiet ? "border-border text-muted-foreground" : "border-border bg-muted/50 text-foreground",
        className,
      )}
    >
      {TEXT_STATUS_LABEL[status]}
    </span>
  );
}

export function Problem({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px] text-muted-foreground"
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
    </div>
  );
}

export function NotBuilt({ what = "The document index" }: { what?: string }) {
  return (
    <div
      role="status"
      className="rounded-md border border-dashed border-border px-3 py-3 text-[13px] text-muted-foreground"
    >
      {what} is not built yet. The filings stay available on each matter page; search and links
      appear here once the index is published.
    </div>
  );
}

export function TargetLink({
  link,
  children,
}: {
  link: Pick<DocLinkRow, "toType" | "toId"> & { citedAs?: string | null };
  children?: ReactNode;
}) {
  const t = linkTarget(link);
  if (!t.href) return <span>{children ?? t.label}</span>;
  return (
    <Link to={t.href as never} className="text-primary underline-offset-2 hover:underline">
      {children ?? t.label}
    </Link>
  );
}
