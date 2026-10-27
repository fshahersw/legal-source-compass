import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { DailyInsightCard } from "@/components/insights/DailyInsightCard";
import { JudgeCourtBench } from "@/components/judges/JudgeCourtBench";
import { JudgeCrossAnalytics } from "@/components/judges/JudgeCrossAnalytics";
import { judgeCrossQuery } from "@/components/judges/judgeCrossQuery";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/judges/analytics")({
  loader: ({ context }) => context.queryClient.prefetchQuery(judgeCrossQuery),
  head: () =>
    pageHead(
      "MDL judge analytics",
      "Transferee judges' MDL experience and load, district bench composition and a disclosure name-match review queue.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="MDL judges and district benches"
      description="Experience, current MDL load, appointing party and tenure, with a labelled disclosure review queue."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Analytics", to: "/analytics" },
        { label: "MDL judge analytics" },
      ]}
    >
      <DailyInsightCard section="judge" className="mb-3" />
      <JudgeCrossAnalytics />
      <div className="mt-10">
        <JudgeCourtBench />
      </div>
    </AppShell>
  );
}
