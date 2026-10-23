import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { SourcesHub } from "@/components/sources/SourcesHub";
import { FreshnessTable } from "@/components/freshness/FreshnessTable";
import { pageHead } from "@/lib/corpus/head";
import { normalizeSourcesSearch, type SourcesSearch } from "@/lib/external/sourcesCatalog";

export const Route = createFileRoute("/sources/")({
  validateSearch: normalizeSourcesSearch,
  head: () =>
    pageHead(
      "Sources",
      "Every published dataset by category, the official sites they come from, and task workflows that open the right pages.",
    ),
  component: SourcesPage,
});

function SourcesPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Tab and category changes are history entries; typing in the search box replaces the current one.
  const onSearch = useCallback(
    (next: SourcesSearch) =>
      void navigate({
        search: next,
        replace: next.tab === search.tab && next.cat === search.cat,
      }),
    [navigate, search.tab, search.cat],
  );
  return (
    <AppShell
      breadcrumbs={[{ label: "Home", to: "/" }, { label: "Sources" }]}
      title="Sources"
      description="Published datasets by category with the pages that use them, the official sites they come from, and workflows for common research tasks."
    >
      <SourcesHub search={search} onSearch={onSearch} />
      <FreshnessTable className="mt-6" />
    </AppShell>
  );
}
