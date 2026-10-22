/** How each citation status reads in the assistant panel, and which citations get marked inside an answer. */
import type { CitationCheck, CitationStatus } from "@/lib/assistant/protocol";

export const CITATION_STATUS: Record<
  CitationStatus,
  { label: string; badge: string; summary: string; mark: string }
> = {
  not_found: {
    label: "Not found",
    badge: "border-destructive/40 bg-destructive/10 text-destructive",
    summary: "text-destructive",
    mark: "decoration-destructive",
  },
  ambiguous: {
    label: "Ambiguous",
    badge: "border-warning/40 bg-warning/15 text-warning-foreground",
    summary: "text-warning-foreground",
    mark: "decoration-warning",
  },
  unverified: {
    label: "Not checked",
    badge: "border-dashed border-border text-muted-foreground",
    summary: "text-muted-foreground",
    mark: "decoration-muted-foreground decoration-dotted",
  },
  // Found is deliberately quiet: the citation exists, which does not show that it supports the statement.
  found: {
    label: "Found",
    badge: "border-border text-muted-foreground",
    summary: "text-muted-foreground",
    mark: "",
  },
};

/** Problems first, then the citations that resolved. */
export const CITATION_ORDER: CitationStatus[] = ["not_found", "ambiguous", "unverified", "found"];

export type CitationMark = { text: string; status: CitationStatus; reason: string };

/** Citations to mark inside the answer text: everything that did not resolve. */
export function citationMarks(check: CitationCheck | null | undefined): CitationMark[] {
  if (!check) return [];
  const seen = new Set<string>();
  const marks: CitationMark[] = [];
  for (const i of check.items) {
    if (i.status === "found" || seen.has(i.citation)) continue;
    seen.add(i.citation);
    marks.push({ text: i.citation, status: i.status, reason: i.reason });
  }
  return marks;
}
