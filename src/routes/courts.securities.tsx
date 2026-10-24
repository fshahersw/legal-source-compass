import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { SecuritiesPage } from "@/components/courts/securities/SecuritiesPage";
import { alignmentQuery, statisticsQuery } from "@/components/courts/securities/scacQueries";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/courts/securities")({
  loader: ({ context }) => {
    const warm = Promise.all([
      context.queryClient.prefetchQuery(statisticsQuery),
      context.queryClient.prefetchQuery(alignmentQuery),
    ]);
    return typeof window === "undefined" ? warm : undefined;
  },
  head: () =>
    pageHead(
      "Securities class actions",
      "Federal securities class action filings 1996 to July 2025 from the public pages of the Stanford Securities Class Action Clearinghouse: years, circuits, sectors, outcomes, litigation waves, top settlements and firms, and how filings line up with market volatility and federal court counts.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Securities class actions"
      description="Federal securities class action filings since 1996: when and where they are filed, against which sectors, how they end, the largest settlements, and how filing volume lines up with markets and court counts."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Courts", to: "/courts" },
        { label: "Securities class actions" },
      ]}
    >
      <SecuritiesPage />
    </AppShell>
  );
}
