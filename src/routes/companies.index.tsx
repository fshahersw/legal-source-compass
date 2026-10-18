import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { CompaniesDashboard, companiesQuery } from "@/components/companies/CompaniesDashboard";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/companies/")({
  loader: ({ context }) => context.queryClient.prefetchQuery(companiesQuery),
  head: () =>
    pageHead(
      "Company intelligence",
      "Public companies whose own SEC filings name pending or recent mass-tort MDLs, with XBRL revenue, income and litigation accruals.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="SEC company intelligence"
      description="MDL defendants linked by their own SEC filings, ranked by docket exposure and litigation accruals."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Matters", to: "/matters" },
        { label: "Companies" },
      ]}
    >
      <CompaniesDashboard />
    </AppShell>
  );
}
