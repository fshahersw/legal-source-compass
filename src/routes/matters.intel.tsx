import { createFileRoute, Link } from "@tanstack/react-router";
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
        { label: "Analytics", to: "/analytics" },
        { label: "Federal court analytics", to: "/courts/analytics" },
        { label: "MDL intelligence" },
      ]}
      actions={
        <Link
          to="/matters/analytics"
          className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          Pending MDL analytics →
        </Link>
      }
    >
      <MdlIntel />
    </AppShell>
  );
}
