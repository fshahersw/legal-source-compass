import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { SectionHub } from "@/components/atlas/hub/SectionHub";
import { CompaniesDashboard, companiesQuery } from "@/components/companies/CompaniesDashboard";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/companies/")({
  loader: ({ context }) => context.queryClient.prefetchQuery(companiesQuery),
  head: () =>
    pageHead(
      "Companies",
      "Public companies whose own SEC filings name pending or recent mass-tort MDLs, with XBRL revenue, income and litigation accruals, and industry payments to clinicians.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Companies"
      description="MDL defendants linked by their own SEC filings, ranked by docket exposure and litigation accruals, and what manufacturers paid clinicians."
      breadcrumbs={[]}
    >
      <SectionHub section="companies">
        <CompaniesDashboard />
      </SectionHub>
    </AppShell>
  );
}
