import { createFileRoute } from "@tanstack/react-router";
import { SectionPage, dsSearch } from "@/components/corpus/SectionPage";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/matters/")({
  validateSearch: dsSearch,
  head: () => pageHead("Matters", "MDLs, dockets, case inventories, counsel, settlements, verdicts and expert rulings."),
  component: MattersPage,
});

function MattersPage() {
  const { ds } = Route.useSearch();
  return <SectionPage section="matters" path="/matters" ds={ds} />;
}
