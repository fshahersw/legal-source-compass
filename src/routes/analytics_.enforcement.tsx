import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { AnalyticsPageBody } from "@/components/analytics/hub/AnalyticsOverview";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/analytics_/enforcement")({
  head: () =>
    pageHead(
      "Enforcement trends",
      "Which DOJ divisions issue press releases, how many DOJ and SEC releases state a resolution figure of $10 million or more, and the penalties EPA and OSHA record, by year.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Enforcement trends"
      description="DOJ and SEC releases by division and stated resolution size, and EPA and OSHA penalties, by year, each with its source and period."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Analytics", to: "/analytics" },
        { label: "Enforcement trends" },
      ]}
    >
      <AnalyticsPageBody
        page="enforcement"
        intro="Depth behind the enforcement blocks of the overview. A stated resolution figure is what a release says, not a verified payment; dollar totals are sums of the amounts each agency's own file records, not adjusted for inflation. Partial periods are marked * and never feed a latest value; gaps are not zero."
      />
    </AppShell>
  );
}
