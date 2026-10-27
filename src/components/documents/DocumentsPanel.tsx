import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { TrendCardView, type CardState } from "@/components/analytics/hub/TrendCard";
import type { BlockDef } from "@/lib/analytics/registry";
import {
  ENTITY_NOUN,
  documentTitle,
  fmtCount,
  fmtDay,
  typeLabel,
  type EntityType,
} from "@/lib/documents/documents";
import { entityDocumentsQuery } from "./documentQueries";
import { DocumentPdfSheet, type OpenDocument } from "./DocumentPdfSheet";
import { NotBuilt, Problem, TextStatusTag } from "./DocumentParts";

const HEADING: Record<EntityType, string> = {
  court: "Filings in this court",
  judge: "Filings in this judge's MDLs",
  mdl: "Filings of this MDL",
  law_unit: "Filings that cite this provision",
  case: "Filings that cite this decision",
};

function detailFor(type: EntityType, id: string): BlockDef["detail"] {
  if (type === "court")
    return { to: "/litigation/documents", search: { court: id }, label: "Search these filings" };
  if (type === "mdl")
    return { to: "/litigation/documents", search: { mdl: id }, label: "Search these filings" };
  return { to: "/litigation/documents", label: "Search all filings" };
}

/**
 * "Documents" panel for a court, judge, MDL, statute / regulation or decision page: the filings per year (trend card),
 * what the count is based on, and the latest filings, each opening in the viewer. Every state is drawn: loading,
 * error, not built yet, none, and loaded. `quiet` (statute, regulation and decision pages, where most units are cited
 * by no filing) draws the panel only once filings are found.
 */
export function DocumentsPanel({
  type,
  id,
  limit = 6,
  quiet = false,
  className,
}: {
  type: EntityType;
  id: string;
  limit?: number;
  quiet?: boolean;
  className?: string;
}) {
  const q = useQuery(entityDocumentsQuery(type, id, limit));
  const [open, setOpen] = useState<OpenDocument | null>(null);
  if (quiet && !(q.data?.available && q.data.docs.total > 0)) return null;
  const def: BlockDef = {
    id: `documents-${type}-${id.replace(/[^a-z0-9_-]/gi, "-")}`,
    group: "courts",
    // the counts are of this collection's filings, not of all filings in the court or MDL
    title:
      type === "law_unit" || type === "case"
        ? "Collected filings citing it, per year"
        : "Collected filings per year",
    measure: `Filings in this collection per year for this ${ENTITY_NOUN[type]}`,
    detail: detailFor(type, id),
  };
  const state: CardState = q.isPending
    ? { kind: "loading" }
    : q.isError
      ? { kind: "error", onRetry: () => void q.refetch() }
      : !q.data.available
        ? { kind: "empty", reason: "The document index is not built yet." }
        : q.data.trend
          ? { kind: "ok", block: q.data.trend }
          : {
              kind: "empty",
              reason: q.data.docs.total
                ? "None of these filings has a recorded date, so no yearly count is drawn."
                : `No filing in the collection is listed for this ${ENTITY_NOUN[type]}.`,
            };
  return (
    <section aria-labelledby={`documents-${def.id}`} className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`documents-${def.id}`} className="text-sm font-semibold">
          {HEADING[type]}
        </h2>
        {q.data?.available ? (
          <p className="text-[11px] text-muted-foreground">
            {fmtCount(q.data.docs.total)} filing{q.data.docs.total === 1 ? "" : "s"} ·{" "}
            {fmtCount(q.data.docs.withText)} with searchable text
            {q.data.docs.mentions ? ` · ${fmtCount(q.data.docs.mentions)} citations` : ""}
          </p>
        ) : null}
      </div>
      {q.isError ? (
        <Problem onRetry={() => void q.refetch()}>
          The filings for this page could not be read.
        </Problem>
      ) : q.data && !q.data.available ? (
        <NotBuilt />
      ) : q.data?.available && q.data.docs.total === 0 ? (
        <p
          role="status"
          className="rounded-md border border-dashed border-border px-3 py-3 text-[12px] text-muted-foreground"
        >
          No filing in the collection is listed for this {ENTITY_NOUN[type]}. {q.data.docs.basis}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <TrendCardView def={def} state={state} />
          <div className="min-w-0 space-y-1.5">
            {q.isPending ? (
              <div className="space-y-1.5" aria-busy="true" aria-label="Loading filings">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="h-11 animate-pulse rounded bg-muted/50" />
                ))}
              </div>
            ) : q.data?.available ? (
              <>
                <p className="text-[11px] leading-4 text-muted-foreground">{q.data.docs.basis}</p>
                {q.data.docs.recent.length ? (
                  <ul className="divide-y divide-border/70 rounded-md border border-border bg-surface">
                    {q.data.docs.recent.map((r) => {
                      const data = q.data.available ? q.data : null;
                      const court = r.courtId ? (data?.courtNames[r.courtId] ?? r.courtId) : null;
                      return (
                        <li key={r.id} className="space-y-0.5 px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setOpen({
                                  doc: r,
                                  page: r.firstPage,
                                  pages: r.firstPage ? [r.firstPage] : [],
                                })
                              }
                              className="min-w-0 text-left text-[12px] font-medium leading-snug text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                            >
                              <FileText className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                              {documentTitle(r)}
                            </button>
                            <TextStatusTag status={r.textStatus} className="shrink-0" />
                          </div>
                          <p className="text-[11px] leading-4 text-muted-foreground">
                            {typeLabel(r.docType)} ·{" "}
                            {r.filedDate ? fmtDay(r.filedDate) : "Date not recorded"}
                            {court ? ` · ${court}` : ""}
                            {r.mdl ? (
                              <>
                                {" · "}
                                <Link
                                  to="/matters/$id"
                                  params={{ id: r.mdl }}
                                  className="underline-offset-2 hover:underline"
                                >
                                  MDL {r.mdl}
                                </Link>
                              </>
                            ) : r.docketNumber ? (
                              <>
                                {" · "}
                                <span className="font-mono">{r.docketNumber}</span>
                              </>
                            ) : null}
                            {r.mentions
                              ? ` · cited ${r.mentions}× from page ${r.firstPage ?? "?"}`
                              : ""}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="rounded-md border border-dashed border-border px-3 py-3 text-[12px] text-muted-foreground">
                    No filing in the collection is listed for this {ENTITY_NOUN[type]}.
                  </p>
                )}
                {q.data.docs.total > q.data.docs.recent.length ? (
                  <p className="text-[11px] text-muted-foreground">
                    The latest {q.data.docs.recent.length} of {fmtCount(q.data.docs.total)} are
                    shown.{" "}
                    {type === "court" || type === "mdl" ? (
                      <Link
                        to="/litigation/documents"
                        search={type === "court" ? { court: id } : { mdl: id }}
                        className="text-primary hover:underline"
                      >
                        Search them all
                      </Link>
                    ) : null}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      )}
      <DocumentPdfSheet open={open} onClose={() => setOpen(null)} />
    </section>
  );
}
