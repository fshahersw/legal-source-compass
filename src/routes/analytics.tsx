import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { InsightsHub } from "@/components/insights/InsightsHub";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/analytics")({
  head: () =>
    pageHead(
      "Data visualizations",
      "One insight of the day for each analytics section (states, courts, judges, MDLs, enforcement, product safety and industry payments), with the figures behind it and a link to the charts.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Data visualizations"
      description="The insight of the day for each analytics section, with the main points and a link to its charts."
      breadcrumbs={[{ label: "States & courts", to: "/" }, { label: "Data visualizations" }]}
    >
      <InsightsHub />
    </AppShell>
  );
}
