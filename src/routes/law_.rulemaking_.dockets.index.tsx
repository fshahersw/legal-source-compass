import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { ApiLawBrowser } from "@/components/apiLaw/ApiLawBrowser";
import { validateBrowserSearch, type BrowserSearch } from "@/components/apiLaw/browserSearch";
import { RegsOverview } from "@/components/apiLaw/RegsOverview";
import { RulemakingTabs } from "@/components/apiLaw/RulemakingTabs";
import { pageHead } from "@/lib/corpus/head";

/** Law & government › Rulemaking › Dockets & comments (Regulations.gov). */
export const Route = createFileRoute("/law_/rulemaking_/dockets/")({
  validateSearch: (s: Record<string, unknown>): BrowserSearch =>
    validateBrowserSearch("regulations_gov_dockets", s),
  head: () =>
    pageHead(
      "Rulemaking dockets and comments",
      "Regulations.gov dockets of twelve federal agencies, documents open for comment and public comment counts.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="Rulemaking"
      description="Dockets on Regulations.gov for twelve federal agencies, what is open for comment and how many public comments each docket has posted."
      breadcrumbs={[
        { label: "Law & government", to: "/law" },
        { label: "Rulemaking", to: "/law/rulemaking" },
        { label: "Dockets & comments" },
      ]}
    >
      <RulemakingTabs active="dockets" />
      <div className="space-y-6">
        <RegsOverview />
        <section aria-labelledby="dockets-h" className="space-y-2">
          <h2 id="dockets-h" className="text-sm font-semibold">
            Dockets
          </h2>
          <ApiLawBrowser
            dataset="regulations_gov_dockets"
            search={search}
            onSearch={(next) => void navigate({ search: next, replace: true, resetScroll: false })}
            placeholder="Words in a docket title, or a docket ID (FDA-2019-N-4611)"
            columns={[
              ["docket_type", "Type"],
              ["modified", "Last modified"],
              ["comments", "Comments posted"],
            ]}
          />
        </section>
      </div>
    </AppShell>
  );
}
