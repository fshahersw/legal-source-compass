import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import {
  ApiLawBrowser,
  validateBrowserSearch,
  type BrowserSearch,
} from "@/components/apiLaw/ApiLawBrowser";
import { pageHead } from "@/lib/corpus/head";

/** Companies › 10-K legal proceedings (SEC EDGAR, exact text). */
export const Route = createFileRoute("/companies/legal-proceedings")({
  validateSearch: (s: Record<string, unknown>): BrowserSearch =>
    validateBrowserSearch("company_sec_legal_proceedings", s),
  head: () =>
    pageHead(
      "10-K legal proceedings",
      "Item 3 Legal Proceedings and the litigation notes of Form 10-K filings by companies in this atlas, exact text with accession numbers, and the MDLs each filing mentions.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="10-K legal proceedings"
      description="What companies in this atlas say about their litigation in Form 10-K: Item 3 and the notes it points to, exact text as filed. An MDL named in a filing is a mention, not membership."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Companies", to: "/companies" },
        { label: "10-K legal proceedings" },
      ]}
    >
      <ApiLawBrowser
        dataset="company_sec_legal_proceedings"
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true, resetScroll: false })}
        placeholder="A company, or words in its legal proceedings (talc, opioid, securities class action)"
        hiddenFilters={["cik"]}
        columns={[
          ["company", "Company"],
          ["period", "Period"],
          ["filed", "Filed"],
          ["item3_chars", "Item 3 characters"],
          ["notes", "Notes read"],
          ["mdl_mentions", "MDLs mentioned"],
        ]}
      />
    </AppShell>
  );
}
