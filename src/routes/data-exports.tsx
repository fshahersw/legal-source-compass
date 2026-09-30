import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Download, FileDown, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/atlas/AppShell";
import { ImportedLabel } from "@/components/atlas/ImportedLabel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { downloadText, sourcesToCsv, sourcesToJson } from "@/lib/atlas/exports";
import { BUNDLED_DEFAULT_SHA256 } from "@/lib/atlas/persistence";
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
          "Provenance of the bundled litigation source directory, optional browser-local import, and CSV/JSON/raw exports.",
      },
      { property: "og:title", content: "Data & Exports — Legal Source Atlas" },
      {
        property: "og:description",
        content: "Bundle provenance, browser-local import and CSV/JSON/raw export for the Legal Source Atlas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DataExportsView,
});

type OriginalFile = { name?: unknown; sha256?: unknown; sizeBytes?: unknown; text?: unknown };

function Confirm({
  trigger,
  title,
  description,
  action,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  action: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DataExportsView() {
  const {
    status,
    loaded,
    bundle,
    stats,
    overlays,
    bookmarks,
    notices,
    persistWarning,
    loadError,
    retryLoad,
    importBundleFile,
    restoreBundledDefault,
    downloadRawBundle,
    clearLocalState,
  } = useAtlas();
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const counts = reviewCounts(overlays);
  const sources = bundle?.sources ?? [];
  const bookmarkCount = Object.keys(bookmarks).length;
  const rawFiles: OriginalFile[] = Array.isArray((loaded?.raw as { originalFiles?: unknown })?.originalFiles)
    ? ((loaded!.raw as { originalFiles: OriginalFile[] }).originalFiles)
    : [];

  async function onFile(file: File) {
    setBusy(true);
    const result = await importBundleFile(file);
    setBusy(false);
    if (!result.ok) {
      setErrors(result.errors);
      setWarnings([]);
      toast.error("Bundle rejected — nothing was changed");
      return;
    }
    setErrors([]);
    setWarnings(result.warnings);
    if (result.persisted) toast.success("Bundle imported and saved in this browser");
    else toast.error("Bundle loaded for this session only — saving to browser storage failed");
  }

  const originLabel =
    loaded?.origin === "bundled-default"
      ? "Bundled public data (shipped with this build)"
      : loaded?.origin === "migrated-legacy"
        ? "Your earlier browser import"
        : loaded?.origin === "user-import"
          ? "Your browser import"
          : "—";
  const saveLabel = !loaded
    ? "—"
    : loaded.origin === "bundled-default"
      ? "Not needed — reloads from the app"
      : loaded.persisted
        ? `Saved in this browser${loaded.info.savedAt ? ` · ${new Date(loaded.info.savedAt).toLocaleString()}` : ""}`
        : "NOT saved — session only";

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Saved Work", to: "/saved-sources" }, { label: "Imports & Exports" }]}
      title="Imports & Exports"
      description="Where the directory data comes from, how to replace it with your own file in this browser, and exports of the directory and your browser-local review overlay."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card lg:col-span-2">
          <div className="eyebrow">Directory data</div>
          <h2 className="mt-1 text-base">Currently loaded bundle</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            The real supplied file is shipped with this build and loads automatically. You can
            replace it in this browser with your own directory file; your file is kept as exact raw bytes in
            this browser&apos;s storage (IndexedDB) and never uploaded. Source URLs are kept
            byte-for-byte, including query strings and hash routes.
          </p>

          {status === "loading" ? (
            <p className="mt-3 text-[12px] text-muted-foreground" role="status">
              Loading…
            </p>
          ) : status === "error" ? (
            <div role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-[12px] text-destructive">
              {loadError}
              <Button size="sm" variant="outline" className="ml-2 h-7" onClick={retryLoad}>
                Retry
              </Button>
            </div>
          ) : loaded ? (
            <div className="mt-3" data-testid="bundle-origin">
              <ImportedLabel label="Origin" value={originLabel} />
              <ImportedLabel label="File name" value={loaded.info.fileName} />
              <ImportedLabel label="Size" value={`${loaded.info.sizeBytes.toLocaleString()} bytes`} />
              <ImportedLabel label="SHA-256 (computed now)" value={loaded.info.sha256} />
              <ImportedLabel
                label="Matches bundled file"
                value={loaded.info.sha256 === BUNDLED_DEFAULT_SHA256 ? "Yes" : "No — different file"}
              />
              <ImportedLabel label="Browser storage" value={saveLabel} />
            </div>
          ) : null}

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="bundle-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!loaded} onClick={downloadRawBundle}>
              <FileDown className="size-3.5" /> Download original bundle file
            </Button>
            <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" /> {busy ? "Importing…" : "Import your own bundle file"}
            </Button>
            {loaded && loaded.origin !== "bundled-default" ? (
              <Confirm
                trigger={
                  <Button size="sm" variant="outline">
                    <RotateCcw className="size-3.5" /> Remove my import &amp; restore bundled data
                  </Button>
                }
                title="Restore the bundled directory?"
                description="Your imported bundle file will be deleted from this browser and the source directory shipped with the app will be shown. Your reviews and bookmarks are kept."
                action="Remove import"
                onConfirm={async () => {
                  const r = await restoreBundledDefault();
                  if (r.ok) toast.success("Bundled directory restored; reviews and bookmarks kept");
                  else toast.error(r.error);
                }}
              />
            ) : null}
          </div>

          {persistWarning ? (
            <p className="mt-3 flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-[12px] leading-relaxed text-warning-foreground">
              <AlertTriangle className="mt-px size-4 shrink-0" /> {persistWarning}
            </p>
          ) : null}
          {notices.map((n) => (
            <p key={n} className="mt-2 rounded-md border border-border bg-muted/50 p-2 text-[12px] text-muted-foreground">
              {n}
            </p>
          ))}

          {errors.length > 0 ? (
            <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2.5">
              <div className="text-[12px] font-semibold text-destructive">
                Import rejected ({errors.length} problem{errors.length === 1 ? "" : "s"}) — the loaded
                data was not changed
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] break-words text-destructive">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2.5">
              <div className="text-[12px] font-semibold text-warning-foreground">Imported with warnings</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-warning-foreground">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="eyebrow">Counted from the loaded rows</div>
          {bundle && stats ? (
            <div className="mt-2" data-testid="bundle-facts">
              <ImportedLabel label="Bundle version" value={bundle.bundle_version} />
              <ImportedLabel label="Assembled on (imported)" value={bundle.generated_at} />
              <ImportedLabel label="Distinct source URLs" value={stats.distinctSources.toLocaleString()} />
              <ImportedLabel label="Original occurrences" value={stats.totalOccurrences.toLocaleString()} />
              <ImportedLabel label="Endpoint candidates" value={stats.endpointCandidates.toLocaleString()} />
              <ImportedLabel label="Manifest families" value={stats.sourceFamilies.toLocaleString()} />
              <ImportedLabel label="Imported promotions" value={stats.promotionRecords.toLocaleString()} />
              <ImportedLabel label="Jurisdictions" value={stats.jurisdictions.toLocaleString()} />
              <ImportedLabel label="Domains" value={stats.domains.toLocaleString()} />
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
                      <thead>
                        <tr className="text-[10px] text-muted-foreground">
                          <th className="text-left font-normal" />
                          <th className="text-right font-normal">claimed</th>
                          <th className="text-right font-normal">counted</th>
                          <th />
                        </tr>
                      </thead>
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
            </div>
          ) : (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              {status === "loading" ? "Loading…" : "No bundle loaded."} Every count in this app is
              computed from the loaded file at runtime — nothing is hardcoded or estimated.
            </p>
          )}
        </section>

        {rawFiles.length > 0 ? (
          <section className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card lg:col-span-3">
            <div className="eyebrow">Original files carried in the bundle</div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Names, sizes and checksums are imported values. Downloads contain the file text exactly as
              embedded in the bundle.
            </p>
            <ul className="mt-2 divide-y divide-border text-[12px]">
              {rawFiles.map((f, i) => (
                <li key={`${String(f.name)}-${i}`} className="flex min-w-0 flex-wrap items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium break-all">{String(f.name ?? "(unnamed)")}</div>
                    <div className="mono-cell break-all text-muted-foreground">
                      {typeof f.sizeBytes === "number" ? `${f.sizeBytes.toLocaleString()} bytes · ` : ""}
                      sha256 {String(f.sha256 ?? "—")}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 text-[11px]"
                    disabled={typeof f.text !== "string"}
                    onClick={() => {
                      const name = String(f.name ?? `original-${i}.txt`);
                      downloadText(name, name.endsWith(".csv") ? "text/csv" : "text/plain", String(f.text));
                    }}
                  >
                    <Download className="size-3.5" /> Download text
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card lg:col-span-2">
          <div className="eyebrow">Exports</div>
          <h2 className="mt-1 text-base">Export the full directory</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            CSV and JSON exports include the imported fields plus your browser-local review and bookmark
            columns, prefixed <code className="font-mono text-[12px]">local_</code>. JSON rows also carry
            each verbatim raw record. For a byte-identical copy of the source data use “Download original
            bundle file”. Filtered exports are available from the Library toolbar.
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
              disabled={counts.total === 0 && bookmarkCount === 0}
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

        <section className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="eyebrow">Your browser-local state</div>
          <div className="mt-2">
            <ImportedLabel label="Review decisions" value={counts.total.toLocaleString()} />
            <ImportedLabel label="Bookmarks" value={bookmarkCount.toLocaleString()} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Personal state stored in this browser&apos;s local storage, separate from the directory data.
            Not synced or shared; importing or restoring a bundle does not change it.
          </p>
          <Confirm
            trigger={
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={counts.total === 0 && bookmarkCount === 0}
              >
                <Trash2 className="size-3.5" /> Clear local reviews {"&"} bookmarks
              </Button>
            }
            title="Clear your reviews and bookmarks?"
            description={`This permanently removes ${counts.total} review decision(s) and ${bookmarkCount} bookmark(s) from this browser. The directory data is not affected.`}
            action="Clear"
            onConfirm={() => {
              clearLocalState();
              toast.success("Local reviews and bookmarks cleared");
            }}
          />
        </section>
      </div>

      <section className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
        <div className="eyebrow">Scope of this version</div>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-muted-foreground">
          <li>No live crawling, probing, fetching of sources, or analytics.</li>
          <li>No cloud database, API keys or paid services are used or required.</li>
          <li>
            Imported authority, currentness, verification and promotion labels are imported historical
            metadata copied verbatim — not new validation.
          </li>
          <li>Server-side harvesting (Tavily) is explicitly out of scope for this first version.</li>
        </ul>
      </section>
    </AppShell>
  );
}
