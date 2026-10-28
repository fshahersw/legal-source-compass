import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { DocketHealth } from "@/components/console/DocketHealth";
import { districtsQuery, nationalQuery } from "@/components/courts/caseload/caseloadQueries";
import { pageHead } from "@/lib/corpus/head";

const DESCRIPTION =
  "How the federal civil docket is moving: filings against terminations, cases pending, time to disposition, the slowest and heaviest districts, and the MDL dockets.";

export const Route = createFileRoute("/courts/docket-health")({
  loader: ({ context }) => {
    const warm = Promise.all([
      context.queryClient.prefetchQuery(nationalQuery),
      context.queryClient.prefetchQuery(districtsQuery),
    ]);
    // The MDL analytics read is large; the browser fetches it after the first paint.
    return typeof window === "undefined" ? warm : undefined;
  },
  head: () => pageHead("Docket health", DESCRIPTION),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Docket health"
      description={DESCRIPTION}
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Courts", to: "/courts" },
        { label: "Docket health" },
      ]}
    >
      <DocketHealth />
    </AppShell>
  );
}
