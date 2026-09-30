import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Download, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/atlas/AppShell";
import { ImportedLabel } from "@/components/atlas/ImportedLabel";
import { Button } from "@/components/ui/button";
import { downloadText, sourcesToCsv, sourcesToJson } from "@/lib/atlas/exports";
import { reviewCounts } from "@/lib/atlas/review";
import { useAtlas } from "@/lib/atlas/store";
import { checkMetaClaims } from "@/lib/atlas/v22a";

export const Route = createFileRoute("/data-exports")({
  head: () => ({
    meta: [
      { title: "Data & Exports — Legal Source Atlas" },
      {
        name: "description",
        content:
          "Import a V2.2A litigation source JSON bundle into this browser and export the directory and local review overlay as CSV or JSON.",
      },
      { property: "og:title", content: "Data & Exports — Legal Source Atlas" },
      {
        property: "og:description",
        content: "Bundle import, provenance and CSV/JSON export for the Legal Source Atlas.",
      },
    ],
  }),
  component: DataExportsView,
});

const SCHEMA_EXAMPLE = `{
  "bundle_version": "V2.2A",
  "generated_at": "2026-09-30T00:00:00Z",
  "provenance": { "original_files": ["..."], "pipeline": "V2.2A extraction" },
  "source_families": [{ "id": "f1", "name": "Federal dockets" }],
  "sources": [{
    "id": "s1",
    "url": "https://example.gov/path?query=1#/hash/route",
    "title": "Docket search",
    "domain": "example.gov",
    "jurisdiction": "Federal — 9th Cir.",
    "heading_category": "Dockets",
    "source_family": "Federal dockets",
    "occurrences": 3,
    "imported_authority_label": "primary",
    "imported_currentness_label": "as-of 2025-11",
    "imported_review_label": "promoted",
    "provenance": { "original_file": "v22a_sources.csv" }
  }],
  "endpoint_candidates": [{ "id": "e1", "url": "https://example.gov/api/search", "domain": "example.gov" }],
  "promotion_records": [{ "id": "p1", "source_id": "s1", "imported_decision": "promote" }]
}`;

function DataExportsView() {
  const {
    bundle,
    stats,
    overlays,
    bookmarks,
    importBundleText,
    clearBundle,
    clearLocalState,
    storageWarning,
  } = useAtlas();
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const counts = reviewCounts(overlays);
  const sources = bundle?.sources ?? [];

  async function onFile(file: File) {
    const text = await file.text();
    const result = importBundleText(text);
    if (!result.ok) {
      setErrors(result.errors);
      setWarnings([]);
      toast.error("Bundle rejected — nothing was imported");
      return;
    }
    setErrors([]);
    setWarnings(result.warnings);
    toast.success("Bundle imported into this browser");
  }

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Data & Exports" }]}
      title="Data &amp; Exports"
      description="Import the supplied V2.2A JSON bundle, inspect its provenance, and export the current directory together with your browser-local review overlay."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-border bg-surface p-4 shadow-card lg:col-span-2">
          <div className="eyebrow">Bundle import</div>
          <h2 className="mt-1 text-base">Load a V2.2A JSON bundle</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            Parsing happens entirely in this browser. Nothing is uploaded, no database is provisioned
            and no external service is called. Source URLs are stored byte-for-byte, keeping query
            strings and hash routes intact.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" /> Choose bundle file
            </Button>
            {bundle ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  clearBundle();
                  setWarnings([]);
                  setErrors([]);
                  toast.success("Imported bundle removed from this browser");
                }}
              >
                <Trash2 className="size-3.5" /> Remove imported bundle
              </Button>
            ) : null}
          </div>

          {storageWarning ? (
            <p className="mt-3 flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-[12px] leading-relaxed text-warning-foreground">
              <AlertTriangle className="mt-px size-4 shrink-0" /> {storageWarning}
            </p>
          ) : null}

          {errors.length > 0 ? (
            <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2.5">
              <div className="text-[12px] font-semibold text-destructive">
                Import rejected ({errors.length} problem{errors.length === 1 ? "" : "s"})
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-destructive">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2.5">
              <div className="text-[12px] font-semibold text-warning-foreground">
                Imported with warnings
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-warning-foreground">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <details className="mt-4 rounded-md border border-border bg-muted/40 p-3">
            <summary className="cursor-pointer text-[12px] font-medium">
              Expected bundle shape
            </summary>
            <pre className="mono-cell mt-2 overflow-x-auto whitespace-pre text-[11px] leading-relaxed">
              {SCHEMA_EXAMPLE}
            </pre>
          </details>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="eyebrow">Imported bundle facts</div>
          {bundle && stats ? (
            <div className="mt-2">
              <ImportedLabel label="Bundle version" value={bundle.bundle_version} />
              <ImportedLabel label="Generated at" value={bundle.generated_at} />
              <ImportedLabel label="Distinct source URLs" value={stats.distinctSources.toLocaleString()} />
              <ImportedLabel
                label="Original occurrences"
                value={stats.totalOccurrences.toLocaleString()}
              />
              <ImportedLabel
                label="Endpoint candidates"
                value={stats.endpointCandidates.toLocaleString()}
              />
              <ImportedLabel label="Source families" value={stats.sourceFamilies.toLocaleString()} />
              <ImportedLabel
                label="Promotion records"
                value={stats.promotionRecords.toLocaleString()}
              />
              <ImportedLabel label="Jurisdictions" value={stats.jurisdictions.toLocaleString()} />
              <ImportedLabel label="Domains" value={stats.domains.toLocaleString()} />
              <ImportedLabel label="Pipeline" value={bundle.provenance?.pipeline} />
              <ImportedLabel
                label="Original files"
                value={
                  bundle.provenance?.original_file ??
                  bundle.provenance?.original_files?.join(", ")
                }
              />
              {(() => {
                const checks = checkMetaClaims(
                  (bundle as Record<string, unknown>)["meta_claims"] as Record<string, unknown> | undefined,
                  {
                    sources: stats.distinctSources,
                    occurrences: stats.totalOccurrences,
                    endpoints: stats.endpointCandidates,
                    families: stats.sourceFamilies,
                    promotions: stats.promotionRecords,
                  },
                );
                if (!checks.length) return null;
                return (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="eyebrow">Bundle claims vs counted rows</div>
                    <table className="mt-1 w-full text-[12px]">
                      <tbody>
                        {checks.map((c) => (
                          <tr key={c.label}>
                            <td className="py-0.5 text-muted-foreground">{c.label}</td>
                            <td className="mono-cell text-right">{c.claimed ?? "—"}</td>
                            <td className="mono-cell text-right">{c.counted}</td>
                            <td className={`pl-2 text-right ${c.match ? "text-muted-foreground" : "text-destructive"}`}>
                              {c.match ? "match" : "mismatch"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
              {Array.isArray((bundle as Record<string, unknown>)["original_files"]) && (
                <div className="mt-3 border-t border-border pt-3">
                  <div className="eyebrow">Original files (imported checksums)</div>
                  <ul className="mt-1 space-y-1 text-[11px]">
                    {((bundle as Record<string, unknown>)["original_files"] as Array<Record<string, unknown>>).map((f) => (
                      <li key={String(f['name'])}>
                        <div className="font-medium">{String(f['name'])}</div>
                        <div className="mono-cell break-all text-muted-foreground">
                          {typeof f['sizeBytes'] === "number" ? `${f['sizeBytes'].toLocaleString()} bytes · ` : ""}
                          sha256 {String(f['sha256'] ?? "—")}
                          {typeof f['text'] === "string" ? "" : " · text not kept after reload"}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              No bundle imported. Every count shown in this app is computed from the imported file at
              runtime — no totals are hardcoded, seeded or estimated.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-4 shadow-card lg:col-span-2">
          <div className="eyebrow">Exports</div>
          <h2 className="mt-1 text-base">Export the full directory</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            Exports include the immutable imported fields plus your browser-local review and bookmark
            columns, clearly prefixed <code className="font-mono text-[12px]">local_</code>. Filtered
            exports are available from the Library toolbar.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={sources.length === 0}
              onClick={() => {
                downloadText(
                  `legal-source-atlas-full-${sources.length}.csv`,
                  "text/csv",
                  sourcesToCsv(sources, overlays, bookmarks),
                );
                toast.success(`Exported ${sources.length.toLocaleString()} rows as CSV`);
              }}
            >
              <Download className="size-3.5" /> All sources (CSV)
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sources.length === 0}
              onClick={() => {
                downloadText(
                  `legal-source-atlas-full-${sources.length}.json`,
                  "application/json",
                  sourcesToJson(sources, overlays, bookmarks, {
                    bundle_version: bundle?.bundle_version ?? "unknown",
                    scope: "all-sources",
                  }),
                );
                toast.success(`Exported ${sources.length.toLocaleString()} rows as JSON`);
              }}
            >
              <Download className="size-3.5" /> All sources (JSON)
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={counts.total === 0 && Object.keys(bookmarks).length === 0}
              onClick={() => {
                downloadText(
                  "legal-source-atlas-local-overlay.json",
                  "application/json",
                  JSON.stringify(
                    {
                      export_kind: "legal-source-atlas-local-overlay",
                      note: "Browser-local review decisions and bookmarks only. Not verification.",
                      exported_at: new Date().toISOString(),
                      review_overlays: Object.values(overlays),
                      bookmarked_source_ids: Object.keys(bookmarks),
                    },
                    null,
                    2,
                  ),
                );
                toast.success("Local overlay exported");
              }}
            >
              <Download className="size-3.5" /> Local overlay only (JSON)
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="eyebrow">Browser-local state</div>
          <div className="mt-2">
            <ImportedLabel label="Review decisions" value={counts.total.toLocaleString()} />
            <ImportedLabel
              label="Bookmarks"
              value={Object.keys(bookmarks).length.toLocaleString()}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Stored in this browser&apos;s local storage. Not synced, not shared, and removed if you
            clear site data.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={counts.total === 0 && Object.keys(bookmarks).length === 0}
            onClick={() => {
              clearLocalState();
              toast.success("Local reviews and bookmarks cleared");
            }}
          >
            <Trash2 className="size-3.5" /> Clear local reviews &amp; bookmarks
          </Button>
        </section>
      </div>

      <section className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
        <div className="eyebrow">Scope of this version</div>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-muted-foreground">
          <li>No live crawling, probing, fetching or analytics. Nothing leaves your browser.</li>
          <li>No cloud database, API keys or paid services are used or required.</li>
          <li>
            Imported authority, currentness and review labels are historical curation copied verbatim
            — they are not fresh verification.
          </li>
          <li>
            Server-side harvesting (Tavily) is explicitly out of scope for this first version.
          </li>
        </ul>
      </section>
    </AppShell>
  );
}
