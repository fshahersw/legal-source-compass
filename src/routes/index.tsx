import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/atlas/AppShell";
import { EmptyBundleState } from "@/components/atlas/EmptyBundleState";
import { LibraryBrowser } from "@/components/atlas/LibraryBrowser";
import { useAtlas } from "@/lib/atlas/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Library — Legal Source Atlas" },
      {
        name: "description",
        content:
          "Searchable directory of imported U.S. litigation research sources: exact URLs, jurisdictions, source families and heading categories.",
      },
      { property: "og:title", content: "Library — Legal Source Atlas" },
      {
        property: "og:description",
        content:
          "Compact searchable directory of imported U.S. litigation source URLs with filters, detail drawer and exports.",
      },
    ],
  }),
  component: LibraryView,
});

function LibraryView() {
  const { bundle } = useAtlas();
  const sources = bundle?.sources ?? [];

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Library" }]}
      title="Library"
      description="Every distinct source URL in the V2.2A bundle shipped with this build (or your own browser import). URLs are shown exactly as supplied, including query strings and hash routes."
    >
      {sources.length === 0 ? (
        <EmptyBundleState view="The library" />
      ) : (
        <LibraryBrowser sources={sources} scope="library" />
      )}
    </AppShell>
  );
}
