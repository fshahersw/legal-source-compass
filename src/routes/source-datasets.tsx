import { createFileRoute } from "@tanstack/react-router";
import { SectionPage, dsSearch } from "@/components/corpus/SectionPage";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/source-datasets")({
  validateSearch: dsSearch,
  head: () => pageHead("Corpus sources", "Source directories, saved pages, URL directory and coverage labels held in the corpus."),
  component: SourceDatasetsPage,
});

function SourceDatasetsPage() {
  const { ds } = Route.useSearch();
  return <SectionPage section="sources" path="/source-datasets" ds={ds} />;
}
