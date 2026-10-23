import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { AnalyticsOverview } from "@/components/analytics/hub/AnalyticsOverview";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/analytics")({
  head: () =>
    pageHead(
      "Analytics overview",
      "Trends across the platform's published data: federal civil and criminal filings, MDL actions pending, enforcement activity, recalls and adverse events, consumer complaints, rulemaking, legislation and judicial vacancies, each with its source and period.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Analytics"
      description="Trends over time across the platform's data, each with its unit, period and source."
      breadcrumbs={[{ label: "Home", to: "/" }, { label: "Analytics" }]}
    >
      <AnalyticsOverview />
    </AppShell>
  );
}
