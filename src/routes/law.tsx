import { createFileRoute } from "@tanstack/react-router";
import { SectionPage, dsSearch } from "@/components/corpus/SectionPage";
import { LawOutline } from "@/components/corpus/LawOutline";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/law")({
  validateSearch: dsSearch,
  head: () => pageHead("Law", "State and federal statutes, regulations, Federal Register, limitation periods and citations."),
  component: LawPage,
});

function LawPage() {
  const { ds } = Route.useSearch();
  return <SectionPage section="law" path="/law" ds={ds} extraTabs={[{ id: "outline", label: "Law outlines", render: () => <LawOutline /> }]} />;
}
