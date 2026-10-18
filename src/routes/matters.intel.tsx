import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { MdlIntel, mdlIntelQuery } from "@/components/mdl/MdlIntel";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/matters/intel")({
  loader: ({ context }) => context.queryClient.prefetchQuery(mdlIntelQuery),
  head: () =>
    pageHead(
      "MDL intelligence",
      "JPML centralization statistics, hearing-session outcomes, transferee concentration and quoted transferee-court MDL pages.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="MDL intelligence"
      description="Centralization trends, hearing outcomes, concentration and official court-page statements."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Matters", to: "/matters" },
        { label: "MDL intelligence" },
      ]}
    >
      <MdlIntel />
    </AppShell>
  );
}
