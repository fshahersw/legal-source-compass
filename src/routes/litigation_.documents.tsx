import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { documentSearchQuery } from "@/components/documents/documentQueries";
import { DocumentSearch } from "@/components/documents/DocumentSearch";
import { normalizeDocumentSearch } from "@/lib/documents/documents";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/litigation_/documents")({
  validateSearch: normalizeDocumentSearch,
  loaderDeps: ({ search }) => search,
  // The first server render waits for the results; later searches load in the browser with their own states.
  loader: ({ context, deps }) => {
    const warm = context.queryClient.prefetchQuery(documentSearchQuery(deps));
    return typeof window === "undefined" ? warm : undefined;
  },
  head: () =>
    pageHead(
      "Court filings",
      "Search the text of the stored court filings of the tracked dockets, with page-numbered passages, filters by court, MDL, type and date, and an in-app viewer.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="Court filings"
      description="The text of the stored court filings of the tracked dockets: search words and phrases, filter by court, MDL, type and filing date, and open a filing at the matching page."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Litigation", to: "/matters" },
        { label: "Court filings" },
      ]}
    >
      <DocumentSearch
        s={search}
        nav={(next) =>
          void navigate({
            search: normalizeDocumentSearch(next),
            replace: false,
            resetScroll: false,
          })
        }
      />
    </AppShell>
  );
}
