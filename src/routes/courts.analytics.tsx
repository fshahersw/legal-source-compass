import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { DailyInsightCard } from "@/components/insights/DailyInsightCard";
import { CourtStatsDashboard, courtStatsQuery } from "@/components/courts/CourtStatsDashboard";
import { Section, SectionIndex } from "@/components/kit";
import { MdlHubHistorySection } from "@/components/courts/venue/MdlHubHistorySection";
import { VenueScorecardSection } from "@/components/courts/venue/VenueScorecardSection";
import { VenueSpeedSection } from "@/components/courts/venue/VenueSpeedSection";
import { VenuePracticeSection } from "@/components/courts/venue/VenuePracticeSection";
import { mdlHubsQuery, venueScorecardQuery } from "@/components/courts/venue/venueQueries";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/courts/analytics")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.prefetchQuery(mdlHubsQuery),
      context.queryClient.prefetchQuery(venueScorecardQuery),
      context.queryClient.prefetchQuery(courtStatsQuery),
    ]),
  head: () =>
    pageHead(
      "Federal court analytics",
      "Where MDL actions sit, how congested each MDL venue is, local motion practice, and federal civil caseloads by district and circuit, from the official U.S. Courts statistics.",
    ),
  component: Page,
});

const SECTIONS = [
  { id: "mdl-hubs", label: "MDL hubs" },
  { id: "venue-scorecard", label: "Venues and jury pools" },
  { id: "venue-speed", label: "Speed and backlog" },
  { id: "venue-practice", label: "Motion practice" },
  { id: "judicial-business", label: "Caseload tables" },
];

function Page() {
  return (
    <AppShell
      title="Federal court analytics"
      description="Where MDL actions sit and how each MDL venue performs, from official U.S. Courts statistics."
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
      <SectionIndex items={SECTIONS} />
      <div className="stack-block space-y-10">
        <MdlHubHistorySection />
        <VenueScorecardSection />
        <VenueSpeedSection />
        <VenuePracticeSection />
        <Section
          id="judicial-business"
          title="Civil caseloads and product liability"
          description="Judicial Business tables by fiscal year: filings, disposition times and appeals, FY2014 to FY2025."
        >
          <DailyInsightCard section="court" className="mb-3" />
          <CourtStatsDashboard />
        </Section>
      </div>
    </AppShell>
  );
}
