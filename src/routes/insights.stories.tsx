import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { VisualStories } from "@/components/stories/VisualStories";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/insights/stories")({
  head: () =>
    pageHead(
      "Visual stories",
      "The MDL docket in motion: the largest MDLs in every captured JPML pending report played as a race, the whole docket as a streamgraph, and the live network of companies SEC filings name as defendants.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Visual stories"
      description="The MDL docket in motion, from the JPML pending reports and SEC filings."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Insights", to: "/insights" },
        { label: "Visual stories" },
      ]}
    >
      <VisualStories />
    </AppShell>
  );
}
