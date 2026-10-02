import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import { SourceDetails, type DetailSource } from "@/components/atlas/SourceDetails";
import { useAtlas } from "@/lib/atlas/store";
import { useMergedSources } from "@/lib/atlas/useMergedSources";
import { loadCatalogJurisdiction, type CatalogEntry } from "@/lib/atlas/catalog";
import { loadRegistryJurisdiction, type RegistryV22Record } from "@/lib/atlas/registryV22";
import { mergeStateSources, type MergedStateSource } from "@/lib/atlas/stateSources";
import { sourcesForState } from "@/lib/corpus/join";
import { stateByUsps } from "@/lib/corpus/geo";
import { pageHead } from "@/lib/corpus/head";
import { TAXONOMY_VERSION } from "@/lib/corpus/taxonomy";
import { downloadText } from "@/lib/atlas/exports";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/sources/detail")({
  validateSearch: (s: Record<string, unknown>): { id: string; state?: string | undefined } => ({
    id: typeof s["id"] === "string" ? s["id"].slice(0, 4000) : "",
    state:
      typeof s["state"] === "string" && stateByUsps.has(s["state"].toUpperCase())
        ? s["state"].toUpperCase()
        : undefined,
  }),
  head: () =>
    pageHead(
      "Source record",
      "Permanent source record with exact URL, recorded categories, provenance, browser reviews and original collection rows.",
    ),
  component: SourcePage,
});

/** Registry-only rows retain unknown occurrence counts rather than manufacturing one. */
function mergedDetail(row: MergedStateSource, stateName: string): DetailSource {
  if (row.source) return { ...row.source, category_values: row.categories };
  const catalog = row.records
    .filter((r) => r.collection === "Source catalog")
    .map((r) => r.record as CatalogEntry);
  const registry = row.records
    .filter((r) => r.collection === "Registry V2.2")
    .map((r) => r.record as RegistryV22Record);
  const first = catalog[0] ?? registry[0];
  return {
    id: catalog[0] ? `catalog:${catalog[0].id}` : row.id,
    url: row.url,
    title: row.title,
    domain: row.domain,
    jurisdiction: stateName,
    heading_category: row.categories.join("; "),
    source_family: "",
    occurrences:
      catalog.length ||
      (registry.length === 1 && typeof registry[0]?.occurrenceCount === "number"
        ? registry[0].occurrenceCount
        : null),
    category_values: row.categories,
    origin: catalog.length ? "Source catalog" : "Registry V2.2",
    imported_raw_record: first,
    ...(catalog.length ? { catalog_records: catalog } : {}),
  };
}

function SourcePage() {
  const { id, state } = Route.useSearch();
  const atlas = useAtlas();
  const merged = useMergedSources();
  const catalog = useQuery({
    queryKey: ["catalog-state", state],
    queryFn: () => loadCatalogJurisdiction(state!),
    enabled: !!state,
    staleTime: Infinity,
  });
  const registry = useQuery({
    queryKey: ["reg22", state],
    queryFn: () => loadRegistryJurisdiction(state!),
    enabled: !!state,
    staleTime: Infinity,
  });
  const st = state ? stateByUsps.get(state) : undefined;
  const row = st
    ? mergeStateSources(
        sourcesForState(atlas.bundle?.sources ?? [], state!),
        catalog.data ?? [],
        registry.data ?? [],
      ).find((r) => r.id === id)
    : undefined;
  const source = row && st ? mergedDetail(row, st.name) : merged.sources.find((s) => s.id === id);
  const loading =
    atlas.status === "loading" ||
    (state ? catalog.isLoading || registry.isLoading : merged.catalogLoading);
  const error =
    atlas.loadError ||
    (state ? catalog.error?.message || registry.error?.message : merged.catalogError?.message);
  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Sources", to: "/sources/library" },
        ...(st ? [{ label: st.name, to: `/places/${state}` }] : []),
        { label: "Source record" },
      ]}
      title={source?.title || row?.title || "Source record"}
      description="Original metadata and collection identities are preserved. Resource groups use a versioned content crosswalk; publisher classifications are recorded separately."
    >
      <div className="mb-4 flex flex-wrap gap-3 text-[13px]">
        <Link to="/sources/library" className="text-primary underline">
          Back to source library
        </Link>
        {state && st ? (
          <Link to="/places/$state" params={{ state }} className="text-primary underline">
            Back to {st.name}
          </Link>
        ) : null}
      </div>
      {loading && !source ? <p role="status">Loading source records…</p> : null}
      {error ? (
        <p role="alert" className="mb-3 text-[13px] text-destructive">
          Some source records could not be loaded: {error}
        </p>
      ) : null}
      {source ? (
        <SourceDetails key={source.id} source={source} />
      ) : !loading ? (
        <p className="text-[13px] text-muted-foreground">
          No exact source identity matches this address in the currently loaded collection.
        </p>
      ) : null}
      {row ? (
        <section className="mt-5 max-w-5xl rounded-lg border border-border bg-surface p-5">
          <h2 className="text-[15px] font-semibold">All records for this exact URL</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {row.records.length} original rows in {row.collections.join(", ")}. Alternate URLs are
            separate records. Taxonomy version {TAXONOMY_VERSION}.
          </p>
          <dl className="my-3 grid gap-2 text-[13px]">
            <div>
              <dt className="text-muted-foreground">Recorded content categories</dt>
              <dd>{row.categories.join("; ") || "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Recorded publisher classifications</dt>
              <dd>{row.sourceTypes.join("; ") || "Not recorded"}</dd>
            </div>
          </dl>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadText(
                "source-collection-records.json",
                "application/json",
                JSON.stringify(
                  {
                    schema_version: "source-collection-view.1",
                    taxonomy_version: TAXONOMY_VERSION,
                    exact_url: row.url,
                    records: row.records,
                  },
                  null,
                  2,
                ),
              )
            }
          >
            Download all original records
          </Button>
          <div className="mt-4 space-y-3">
            {row.records.map((origin, i) => (
              <details
                key={`${origin.collection}-${origin.record.id}-${i}`}
                className="rounded border border-border p-3"
              >
                <summary className="cursor-pointer text-[13px] font-medium">
                  {origin.collection} · {origin.record.id}
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-[11px]">
                  {JSON.stringify(origin.record, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
