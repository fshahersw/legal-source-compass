import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { MdlAnalytics, mdlAnalyticsQuery } from "@/components/matters/MdlAnalytics";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/matters/analytics")({
  loader: ({ context }) => context.queryClient.prefetchQuery(mdlAnalyticsQuery),
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
        { label: "Matters", to: "/matters" },
        { label: "MDL analytics" },
      ]}
    >
      <MdlAnalytics />
    </AppShell>
  );
}
