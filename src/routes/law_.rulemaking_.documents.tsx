import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { ApiLawBrowser, validateBrowserSearch, type BrowserSearch } from "@/components/apiLaw/ApiLawBrowser";
import { RulemakingTabs } from "@/components/apiLaw/RulemakingTabs";
import { pageHead } from "@/lib/corpus/head";

/** Law & government › Rulemaking › Regulations.gov documents (rules, proposed rules, notices). */
export const Route = createFileRoute("/law_/rulemaking_/documents")({
  validateSearch: (s: Record<string, unknown>): BrowserSearch => validateBrowserSearch("regulations_gov_documents", s),
  head: () =>
    pageHead(
      "Regulations.gov documents",
      "Rules, proposed rules and notices of twelve federal agencies on Regulations.gov, linked to the Federal Register and CFR parts by exact document number.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="Rulemaking"
      description="Rules, proposed rules and notices on Regulations.gov, each linked to its docket and, by exact document number, to the Federal Register record and its CFR parts."
      breadcrumbs={[{ label: "Law & government", to: "/law" }, { label: "Rulemaking", to: "/law/rulemaking" }, { label: "Documents" }]}
    >
      <RulemakingTabs active="documents" />
      <ApiLawBrowser
        dataset="regulations_gov_documents"
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true, resetScroll: false })}
        placeholder="Words in a title, or a document ID (CPSC-2022-0017-0018)"
        columns={[
          ["posted", "Posted"],
          ["docket", "Docket"],
          ["fr_doc", "FR doc."],
          ["comment_period", "Comment period"],
          ["comments", "Comments posted"],
        ]}
      />
    </AppShell>
  );
}
