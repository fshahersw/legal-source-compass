import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Bookmark, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortDir, SortKey } from "@/lib/atlas/filters";
import type { ReviewOverlay, Source } from "@/lib/atlas/types";

const COLUMNS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: "title", label: "Title / URL" },
  { key: "jurisdiction", label: "Jurisdiction", className: "w-40" },
  { key: "source_family", label: "Family", className: "w-40" },
  { key: "occurrences", label: "Count", className: "w-20 text-right" },
  { key: null, label: "Local", className: "w-28" },
];

export function SourceTable({
  rows,
  overlays,
  bookmarks,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: Source[];
  overlays: Record<string, ReviewOverlay>;
  bookmarks: Record<string, true>;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="border-border bg-muted/60 hover:bg-muted/60">
            {COLUMNS.map((col) => (
              <TableHead
                key={col.label}
                className={cn(
                  "h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                  col.className,
                )}
              >
                {col.key ? (
                  <button
                    type="button"
                    onClick={() => onSort(col.key as SortKey)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      )
                    ) : null}
                  </button>
                ) : (
                  col.label
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={COLUMNS.length} className="py-10 text-center text-muted-foreground">
                No sources match the current filters.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((source) => {
              const overlay = overlays[source.id];
              return (
                <TableRow
                  key={source.id}
                  className="border-border align-top"
                >
                  <TableCell className="py-2">
                    <div className="flex items-start gap-1.5">
                      <Link to="/sources/detail" search={{ id: source.id }} className="line-clamp-1 font-medium text-primary hover:underline">
                        {source.title || "(untitled source)"}
                      </Link>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 text-muted-foreground hover:text-foreground"
                        aria-label="Open source in a new tab"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                    <div className="mono-cell mt-0.5 line-clamp-1 break-all">{source.url}</div>
                  </TableCell>
                  <TableCell className="py-2 text-[12px]">
                    {source.jurisdiction ? (
                      <span className="line-clamp-2" title={source.jurisdiction}>
                        {source.jurisdiction}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-[12px]">
                    {source.source_family || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-[12px]" title={source["origin"] === "Source catalog" ? "Catalog records for this exact URL" : "Recorded occurrences in directory originals"}>
                    {source.occurrences}
                    <div className="font-sans text-[9px] text-muted-foreground">{source["origin"] === "Source catalog" ? "catalog rows" : "occurrences"}</div>
                  </TableCell>
                  <TableCell className="py-2">
                    <div className="flex items-center gap-1">
                      {overlay ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {overlay.action === "needs_follow_up"
                            ? "follow-up"
                            : overlay.action.replace(/ed$/, "")}
                        </Badge>
                      ) : null}
                      {bookmarks[source.id] ? (
                        <Bookmark className="size-3.5 fill-current text-primary" />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
