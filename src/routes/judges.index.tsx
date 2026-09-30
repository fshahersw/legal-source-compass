import { createFileRoute } from "@tanstack/react-router";
import { SectionPage, dsSearch } from "@/components/corpus/SectionPage";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/judges/")({
  validateSearch: dsSearch,
  head: () => pageHead("Judges", "Judge directory, disclosures, enrichment, entities and biographies from the connected corpus."),
  component: JudgesPage,
});

function JudgesPage() {
  const { ds } = Route.useSearch();
  return <SectionPage section="judges" path="/judges" ds={ds} />;
}
