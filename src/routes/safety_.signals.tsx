import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { MassTortSignals, massTortSignalsQuery } from "@/components/regulatory/MassTortSignals";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/safety_/signals")({
  loader: ({ context }) => context.queryClient.prefetchQuery(massTortSignalsQuery),
  head: () =>
    pageHead(
      "Mass-tort product signals",
      "Products-liability MDLs matched to FDA adverse-event and recall data and NHTSA vehicle complaints.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Mass-tort product signals"
      description="Litigation volume next to adverse-event reporting and recalls for the same products."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Product safety", to: "/safety" },
        { label: "Mass-tort signals" },
      ]}
    >
      <MassTortSignals />
    </AppShell>
  );
}
