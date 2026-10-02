import { BookmarkCheck, BookmarkPlus, Copy, Download, ExternalLink, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ImportedLabel } from "@/components/atlas/ImportedLabel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MIN_REASON_LENGTH, REVIEW_ACTIONS } from "@/lib/atlas/review";
import type { ReviewAction, Provenance } from "@/lib/atlas/types";
import { useAtlas } from "@/lib/atlas/store";
import { downloadText } from "@/lib/atlas/exports";
import { CATEGORY_LABELS, classifySource, TAXONOMY_VERSION } from "@/lib/corpus/taxonomy";

export type DetailSource = {
  id: string;
  url: string;
  title: string;
  domain: string;
  jurisdiction: string;
  heading_category: string;
  source_family: string;
  occurrences: number | null;
  imported_authority_label?: string | undefined;
  imported_currentness_label?: string | undefined;
  imported_review_label?: string | undefined;
  provenance?: Provenance | undefined;
  [key: string]: unknown;
};

export function SourceDetails({ source }: { source: DetailSource }) {
  const { overlays, bookmarks, review, toggleBookmark, lastReview, undoLastReview, bundle } =
    useAtlas();
  const [reason, setReason] = useState("");

  const overlay = source ? overlays[source.id] : undefined;
  const bookmarked = source ? Boolean(bookmarks[source.id]) : false;
  const raw = (source ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const categories = Array.isArray(raw["category_values"])
    ? raw["category_values"].map(String)
    : [source.heading_category];
  const resourceGroups = classifySource(categories);
  const countLabel =
    raw["origin"] === "Source catalog" ? "Catalog records" : "Occurrences in originals";
  const promotions = source
    ? (bundle?.promotion_records ?? []).filter(
        (p) => p.source_id === source.id || (p.url && p.url === source.url),
      )
    : [];

  function submit(action: ReviewAction) {
    if (!source) return;
    const result = review({ sourceId: source.id, action, reason });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setReason("");
    toast.success("Review saved in this browser", {
      action: { label: "Undo", onClick: () => undoLastReview() },
    });
  }

  async function copyUrl() {
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source.url);
      toast.success("Exact URL copied");
    } catch {
      toast.error("Clipboard blocked by the browser");
    }
  }

  return (
    <article className="max-w-5xl overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      {source ? (
        <>
          <header className="border-b border-border p-5">
            <div className="eyebrow">{source.source_family || "Unclassified family"}</div>
            <h2 className="text-base leading-snug">{source.title || "(untitled source)"}</h2>
            <p className="mono-cell break-all">{source.url}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {source.jurisdiction ? (
                <Badge variant="secondary">{source.jurisdiction}</Badge>
              ) : null}
              {resourceGroups.map((category) => (
                <Badge key={category} variant="outline">
                  {CATEGORY_LABELS[category]}
                </Badge>
              ))}
              <Badge variant="outline">
                {source.occurrences === null
                  ? "Occurrences not recorded"
                  : `${source.occurrences} ${raw["origin"] === "Source catalog" ? "catalog record(s)" : "recorded occurrence(s)"}`}
              </Badge>
            </div>
          </header>

          <div className="flex flex-wrap gap-2 border-b border-border p-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadText(
                  "source-record.json",
                  "application/json",
                  JSON.stringify(
                    {
                      schema_version: "source-detail.1",
                      taxonomy_version: TAXONOMY_VERSION,
                      source,
                    },
                    null,
                    2,
                  ),
                )
              }
            >
              <Download className="size-3.5" /> Download record
            </Button>
            <Button size="sm" variant="outline" onClick={copyUrl}>
              <Copy className="size-3.5" /> Copy URL
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={source.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="size-3.5" /> Open source
              </a>
            </Button>
            <Button
              size="sm"
              variant={bookmarked ? "default" : "outline"}
              onClick={() => {
                const next = toggleBookmark(source.id);
                toast.success(next ? "Saved to this browser" : "Removed from saved sources");
              }}
            >
              {bookmarked ? (
                <BookmarkCheck className="size-3.5" />
              ) : (
                <BookmarkPlus className="size-3.5" />
              )}
              {bookmarked ? "Saved" : "Save"}
            </Button>
          </div>

          <section className="border-b border-border p-5">
            <div className="eyebrow">Imported record (immutable)</div>
            <div className="mt-2">
              <ImportedLabel label="Source id" value={source.id} />
              <ImportedLabel label="Domain" value={source.domain} />
              <ImportedLabel label="Jurisdiction" value={source.jurisdiction} />
              <ImportedLabel
                label="Recorded categories"
                value={categories.filter(Boolean).join("; ")}
              />
              <ImportedLabel
                label="Resource groups (derived)"
                value={resourceGroups.map((c) => CATEGORY_LABELS[c]).join("; ")}
              />
              <ImportedLabel label="Taxonomy version" value={TAXONOMY_VERSION} />
              <ImportedLabel
                label="Source family"
                value={
                  source.source_family ||
                  (Array.isArray(raw["source_family_ambiguous_ids"])
                    ? `Ambiguous — matches ${(raw["source_family_ambiguous_ids"] as string[]).join(", ")}`
                    : "Unassigned (no exact heading or endpoint match)")
                }
              />
              <ImportedLabel label="Format (imported)" value={str(raw["format"])} />
              <ImportedLabel label="Format basis (imported)" value={str(raw["formatBasis"])} />
              <ImportedLabel
                label={countLabel}
                value={source.occurrences === null ? "Not recorded" : String(source.occurrences)}
              />
            </div>
          </section>

          <section className="border-b border-border p-5">
            <div className="eyebrow">Imported historical metadata</div>
            <p className="mt-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] leading-relaxed text-warning-foreground">
              These labels were copied verbatim from the export. They are imported historical
              metadata, <strong>not new validation</strong>: nothing here has been re-checked
              against the live source by this app.
            </p>
            <div className="mt-2">
              <ImportedLabel label="Authority label" value={source.imported_authority_label} />
              <ImportedLabel label="Currentness label" value={source.imported_currentness_label} />
              <ImportedLabel label="Imported verification" value={source.imported_review_label} />
            </div>
          </section>

          {raw["imported_raw_record"] !== undefined ? (
            <section className="border-b border-border p-5">
              <details>
                <summary className="eyebrow cursor-pointer">Raw imported record (verbatim)</summary>
                <pre className="mono-cell mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 text-[11px]">
                  {JSON.stringify(raw["imported_raw_record"], null, 2)}
                </pre>
              </details>
            </section>
          ) : null}

          {Array.isArray(raw["catalog_records"]) && raw["catalog_records"].length ? (
            <section className="border-b border-border p-5">
              <details>
                <summary className="eyebrow cursor-pointer">
                  Source catalog records ({raw["catalog_records"].length})
                </summary>
                <pre className="mono-cell mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 text-[11px]">
                  {JSON.stringify(raw["catalog_records"], null, 2)}
                </pre>
              </details>
            </section>
          ) : null}

          {source.provenance ? (
            <section className="border-b border-border p-5">
              <div className="eyebrow">Provenance</div>
              <div className="mt-2">
                <ImportedLabel
                  label="Original file"
                  value={
                    source.provenance.original_file ?? source.provenance.original_files?.join(", ")
                  }
                />
                <ImportedLabel label="Extracted at" value={source.provenance.extracted_at} />
                <ImportedLabel label="Pipeline" value={source.provenance.pipeline} />
                <ImportedLabel label="Notes" value={source.provenance.notes} />
              </div>
            </section>
          ) : null}

          {promotions.length > 0 ? (
            <section className="border-b border-border p-5">
              <div className="eyebrow">Imported promotion records ({promotions.length})</div>
              <ul className="mt-2 space-y-2">
                {promotions.map((p) => (
                  <li key={p.id} className="rounded-md border border-border bg-muted/50 p-2">
                    <div className="flex justify-between gap-2 text-[12px]">
                      <span className="font-medium">{p.imported_decision || "(no decision)"}</span>
                      <span className="mono-cell">{p.imported_decided_at ?? "—"}</span>
                    </div>
                    {p.notes ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">{p.notes}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="p-5">
            <div className="eyebrow">Browser-local review</div>
            {overlay ? (
              <div className="mt-2 rounded-md border border-border bg-muted/50 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary">{overlay.action.replace(/_/g, " ")}</Badge>
                  <span className="mono-cell">{new Date(overlay.at).toLocaleString()}</span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed">{overlay.reason}</p>
                {lastReview?.sourceId === source.id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1.5 h-7 px-2 text-[11px]"
                    onClick={undoLastReview}
                  >
                    <Undo2 className="size-3.5" /> Undo last decision
                  </Button>
                ) : null}
              </div>
            ) : null}

            <Label htmlFor="review-reason" className="mt-3 block text-[12px]">
              Reason (required, min {MIN_REASON_LENGTH} characters)
            </Label>
            <Textarea
              id="review-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1.5 text-[13px]"
              placeholder="Why this decision? Recorded with a local timestamp."
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {REVIEW_ACTIONS.map((a) => (
                <Button key={a.value} size="sm" variant="outline" onClick={() => submit(a.value)}>
                  {a.label}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Local review decisions are an overlay kept in this browser. They never modify the
              imported record or the imported promotion history.
            </p>
          </section>
        </>
      ) : null}
    </article>
  );
}
