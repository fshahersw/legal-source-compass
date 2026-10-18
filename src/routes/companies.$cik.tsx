import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import {
  CompanyProfile,
  companyDetailQuery,
  companyTitle,
} from "@/components/companies/CompanyProfile";
import { pageHead } from "@/lib/corpus/head";

const CIK = /^\d{10}$/;

export const Route = createFileRoute("/companies/$cik")({
  beforeLoad: ({ params }) => {
    if (!CIK.test(params.cik)) throw notFound();
  },
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(companyDetailQuery(params.cik));
    return { name: data?.summary.profile.name ?? null };
  },
  head: ({ loaderData }) => {
    const name = loaderData?.name ?? "Company";
    return pageHead(
      name,
      `${name}: MDLs named in its own SEC filings, evidence filings, and XBRL revenue, income and litigation accruals.`,
    );
  },
  component: Page,
  notFoundComponent: () => (
    <p className="p-6 text-sm">
      A company page needs a 10-digit SEC CIK, for example /companies/0000200406.
    </p>
  ),
});

function Page() {
  const { cik } = Route.useParams();
  const q = useQuery(companyDetailQuery(cik));
  const name = companyTitle(q.data);
  return (
    <AppShell
      title={q.data ? name : `CIK ${cik}`}
      description="MDL exposure from the company's own SEC filings, with XBRL financial trends."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Companies", to: "/companies" },
        { label: q.data ? name : `CIK ${cik}` },
      ]}
    >
      <CompanyProfile cik={cik} />
    </AppShell>
  );
}
