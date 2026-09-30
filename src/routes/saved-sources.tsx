import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { AppShell } from "@/components/atlas/AppShell";
import { EmptyBundleState } from "@/components/atlas/EmptyBundleState";
import { LibraryBrowser } from "@/components/atlas/LibraryBrowser";
import { useAtlas } from "@/lib/atlas/store";
import { useMergedSources } from "@/lib/atlas/useMergedSources";

export const Route = createFileRoute("/saved-sources")({
  head: () => ({
    meta: [
      { title: "Saved Sources — Legal Source Atlas" },
      {
        name: "description",
        content:
          "Sources bookmarked in this browser, exportable to CSV or JSON alongside their imported metadata.",
      },
      { property: "og:title", content: "Saved Sources — Legal Source Atlas" },
      {
        property: "og:description",
        content: "Your browser-local bookmarks of imported litigation sources.",
      },
    ],
  }),
  component: SavedSourcesView,
});

function SavedSourcesView() {
  const { bundle, bookmarks } = useAtlas();
  const { sources } = useMergedSources();
  const saved = useMemo(() => sources.filter((s) => bookmarks[s.id]), [sources, bookmarks]);

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Saved Work" }, { label: "Saved Sources" }]}
      title="Saved Work"
      description="Bookmarks are stored in this browser only. Clearing site data removes them."
    >
      {sources.length === 0 ? (
        <EmptyBundleState view="Saved sources" />
      ) : saved.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong bg-surface p-6 text-center text-[13px] text-muted-foreground">
          No sources saved yet. Open a source from the Library and choose Save.
        </p>
      ) : (
        <LibraryBrowser sources={saved} scope="saved" />
      )}
    </AppShell>
  );
}
