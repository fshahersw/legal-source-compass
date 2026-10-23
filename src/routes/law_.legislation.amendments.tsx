import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { ApiLawBrowser } from "@/components/apiLaw/ApiLawBrowser";
import { validateBrowserSearch, type BrowserSearch } from "@/components/apiLaw/browserSearch";
import { LegislationTabs } from "@/components/legislation/LegislationTabs";
import { pageHead } from "@/lib/corpus/head";

/** Law & government › Legislation › Amendments (Congress.gov). */
export const Route = createFileRoute("/law_/legislation/amendments")({
  validateSearch: (s: Record<string, unknown>): BrowserSearch =>
    validateBrowserSearch("congress_amendments", s),
  head: () =>
    pageHead(
      "Amendments in Congress",
      "House and Senate amendments from the Congress.gov API: the measure each amends, sponsor, purpose and latest action, updated daily.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="Legislation"
      description="House and Senate amendments as Congress.gov publishes them: the measure each amends, its sponsor, purpose and latest action."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Legislation", to: "/law/legislation" },
        { label: "Amendments" },
      ]}
    >
      <LegislationTabs active="amendments" />
      <ApiLawBrowser
        dataset="congress_amendments"
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true, resetScroll: false })}
        placeholder="Words in a purpose or description, or an amendment number (S.Amdt. 6848)"
        hiddenFilters={["amended_bill", "sponsor"]}
        columns={[
          ["amends", "Amends"],
          ["sponsor", "Sponsor"],
          ["latest_action_date", "Latest action"],
          ["latest_action", "Action"],
        ]}
      />
    </AppShell>
  );
}
