import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { AnalyticsPageBody } from "@/components/analytics/hub/AnalyticsOverview";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/analytics_/safety")({
  head: () =>
    pageHead(
      "Safety trends",
      "FAERS reports by outcome and reporter, SaferProducts.gov reports, CPSC recalls by hazard and by death mention in the injury statement, and FDA Class I recall entries, by year.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Safety trends"
      description="Adverse-event and injury reports and recalls by kind, by year, each with its source and period."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Analytics", to: "/analytics" },
        { label: "Safety trends" },
      ]}
    >
      <AnalyticsPageBody
        page="safety"
        intro="Depth behind the recall and adverse-event blocks of the overview. Reports are submissions, not incidence or confirmed causes. Partial periods are marked * and never feed a latest value; gaps are not zero."
      />
    </AppShell>
  );
}
