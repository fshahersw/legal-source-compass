import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { DailyInsightCard } from "@/components/insights/DailyInsightCard";
import { MdlAnalytics, mdlAnalyticsQuery } from "@/components/matters/MdlAnalytics";
import { CitationGridOverview } from "@/components/litviz/CitationMap";
import { MdlLanesOverview } from "@/components/litviz/MdlLanesOverview";
import { JpmlNationalPanel } from "@/components/mdl/jpml-series/JpmlNationalPanel";
import { jpmlNationalQuery } from "@/components/mdl/jpml-series/queries";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/matters/analytics")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.prefetchQuery(mdlAnalyticsQuery),
      context.queryClient.prefetchQuery(jpmlNationalQuery),
    ]),
  head: () =>
    pageHead(
      "MDL analytics",
      "Pending MDL and mass-tort dockets over time from JPML monthly reports, with terminated-MDL history.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="MDL and mass-tort analytics"
      description="Docket growth, concentration and outcomes from JPML statistics reports."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Analytics", to: "/analytics" },
        { label: "Federal court analytics", to: "/courts/analytics" },
        { label: "MDL analytics" },
      ]}
    >
      <DailyInsightCard section="mdl" className="mb-3" />
      <section aria-labelledby="mdl-lanes-heading" className="mb-6 space-y-3">
        <h2 id="mdl-lanes-heading" className="sr-only">
          MDL lifecycle lanes and citations
        </h2>
        <MdlLanesOverview />
        <CitationGridOverview />
      </section>
      <JpmlNationalPanel />
      <MdlAnalytics />
    </AppShell>
  );
}
