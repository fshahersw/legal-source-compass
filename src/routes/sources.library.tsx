import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/atlas/AppShell";
import { EmptyBundleState } from "@/components/atlas/EmptyBundleState";
import { LibraryBrowser } from "@/components/atlas/LibraryBrowser";
import { useAtlas } from "@/lib/atlas/store";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadAllCatalog, mergeCatalog } from "@/lib/atlas/catalog";

export const Route = createFileRoute("/sources/library")({
  head: () => ({
    meta: [
      { title: "Source library — Legal Source Atlas" },
      {
        name: "description",
        content:
          "Searchable directory of imported U.S. litigation research sources: exact URLs, jurisdictions, source families and heading categories.",
      },
      { property: "og:title", content: "Source library — Legal Source Atlas" },
      {
        property: "og:description",
        content:
          "Compact searchable directory of imported U.S. litigation source URLs with filters, detail drawer and exports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LibraryView,
});

function LibraryView() {
  const { bundle } = useAtlas();
  const [withCatalog, setWithCatalog] = useState(true);
  const cat = useQuery({ queryKey: ["catalog-all"], queryFn: loadAllCatalog, staleTime: Infinity, enabled: withCatalog });
  const base = bundle?.sources ?? [];
  const merged = useMemo(() => (withCatalog && cat.data && base.length ? mergeCatalog(base, cat.data) : null), [withCatalog, cat.data, base]);
  const sources = merged?.rows ?? base;

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Sources", to: "/sources/library" }, { label: "Source library" }]}
      title="Sources"
      description="Every distinct source URL in the bundle shipped with this build (or your own browser import). URLs are shown exactly as supplied, including query strings and hash routes."
    >
      <label className="mb-3 flex items-center gap-2 text-[12px] text-muted-foreground">
        <input type="checkbox" checked={withCatalog} onChange={(e) => setWithCatalog(e.target.checked)} />
        Include the source catalog
        <span>{withCatalog ? (cat.isLoading ? "· loading catalog…" : cat.error ? `· catalog could not be loaded: ${(cat.error as Error).message}` : merged ? `· ${base.length.toLocaleString()} directory + ${merged.added.toLocaleString()} catalog-only sources; ${merged.matched.toLocaleString()} share an exact URL and are shown once` : "") : `· ${base.length.toLocaleString()} directory sources`}</span>
      </label>
      {sources.length === 0 ? (
        <EmptyBundleState view="The library" />
      ) : (
        <LibraryBrowser sources={sources} scope="library" />
      )}
    </AppShell>
  );
}
