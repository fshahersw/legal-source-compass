import { createFileRoute } from "@tanstack/react-router";
import { SectionPage, dsSearch } from "@/components/corpus/SectionPage";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/safety")({
  validateSearch: dsSearch,
  head: () => pageHead("Safety", "FDA, openFDA and CPSC recall, enforcement and injury records."),
  component: SafetyPage,
});

function SafetyPage() {
  const { ds } = Route.useSearch();
  return <SectionPage section="safety" path="/safety" ds={ds} />;
}
