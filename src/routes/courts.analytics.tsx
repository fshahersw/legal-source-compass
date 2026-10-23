import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { DailyInsightCard } from "@/components/insights/DailyInsightCard";
import { CourtStatsDashboard, courtStatsQuery } from "@/components/courts/CourtStatsDashboard";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/courts/analytics")({
  loader: ({ context }) => context.queryClient.prefetchQuery(courtStatsQuery),
  head: () =>
    pageHead(
      "Federal court analytics",
      "Product liability and civil filings, time to disposition and appeals by federal district and circuit, FY2014-FY2025, from Judicial Business of the United States Courts.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Federal court analytics"
      description="Product liability filings, civil caseloads, time to disposition and appeals by district and circuit, from the official U.S. Courts Judicial Business tables."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Analytics", to: "/analytics" },
        { label: "Federal court analytics" },
      ]}
      actions={
        <>
          <Link
            to="/matters/analytics"
            className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            Pending MDL analytics →
          </Link>
          <Link
            to="/matters/intel"
            className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            MDL intelligence →
          </Link>
        </>
      }
    >
      <DailyInsightCard section="court" className="mb-3" />
      <CourtStatsDashboard />
    </AppShell>
  );
}
