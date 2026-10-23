import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { SignalsView } from "@/components/insights/SignalsView";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/insights/signals")({
  head: () =>
    pageHead(
      "Signals",
      "Time from MDL creation to termination (Kaplan–Meier), growth of new MDLs after centralization, recall-to-MDL timing, clusters of states, originating courts of the largest MDLs and co-counsel networks, each with its method and n.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Signals"
      description="Event studies, survival curves, clusters, flows and networks across many records, each with its method."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Insights", to: "/insights" },
        { label: "Signals" },
      ]}
    >
      <SignalsView />
    </AppShell>
  );
}
