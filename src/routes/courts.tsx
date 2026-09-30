import { createFileRoute } from "@tanstack/react-router";
import { SectionPage, dsSearch } from "@/components/corpus/SectionPage";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/courts")({
  validateSearch: dsSearch,
  head: () => pageHead("Courts", "Court registry, seals, statistics, rules, forms and court documents from the connected corpus."),
  component: CourtsPage,
});

function CourtsPage() {
  const { ds } = Route.useSearch();
  return <SectionPage section="courts" path="/courts" ds={ds} />;
}
