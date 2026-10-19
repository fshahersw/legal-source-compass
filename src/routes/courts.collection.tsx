import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { CollectionPage } from "@/components/courts/collection/CollectionPage";
import {
  docketOverviewQuery,
  docketYearsQuery,
  notesQuery,
} from "@/components/courts/collection/collectionQueries";
import { normalizeCollectionSearch } from "@/components/courts/collection/collectionSearch";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/courts/collection")({
  validateSearch: normalizeCollectionSearch,
  loaderDeps: ({ search }) => ({ tab: search.tab ?? "dockets" }),
  // The first server render waits for the totals of the default tab; a switch between tabs in the browser never waits,
  // so the tab changes at once and each panel shows its own loading state.
  loader: ({ context, deps }) => {
    if (deps.tab !== "dockets") return undefined;
    const warm = Promise.all([
      context.queryClient.prefetchQuery(docketOverviewQuery),
      context.queryClient.prefetchQuery(docketYearsQuery),
      context.queryClient.prefetchQuery(notesQuery),
    ]);
    return typeof window === "undefined" ? warm : undefined;
  },
  head: () =>
    pageHead(
      "CourtListener collection",
      "Dockets, citation flows, most-cited opinions and how later opinions describe them, citations CourtListener could not match, financial-disclosure report counts and bulk-data coverage in CourtListener's collection, snapshot of its bulk files. Counts of rows in the collection, not complete court totals.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="CourtListener collection"
      description="What CourtListener's bulk files hold: dockets by year, court level, state and nature of suit; citation flows between courts; the most-cited opinions and how later opinions describe them; citations CourtListener could not match to a case; financial-disclosure report counts; and which database tables have no public bulk file. Counts of rows in the collection, not complete court totals."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Courts", to: "/courts" },
        { label: "Collection" },
      ]}
    >
      <CollectionPage
        search={search}
        onNavigate={(next, opts) =>
          void navigate({ search: next, replace: opts?.replace ?? true, resetScroll: false })
        }
      />
    </AppShell>
  );
}
