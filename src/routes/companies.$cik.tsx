import { createFileRoute, Link, notFound, type NotFoundRouteProps } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import {
  CompanyProfile,
  companyDetailQuery,
  companyTitle,
} from "@/components/companies/CompanyProfile";
import { isCikAddress, paddedCik, requestedCik } from "@/components/companies/cik";
import { pageHead } from "@/lib/corpus/head";

const COMPANY_CRUMBS = [
  { label: "Home", to: "/" },
  { label: "Law & regulation", to: "/law" },
  { label: "Companies", to: "/companies" },
];

/**
 * The CIK check runs in params.parse, not beforeLoad: with `defaultSsr: false` (src/start.ts) beforeLoad does not
 * run during SSR, but params are parsed while matching on the server too, so a notFound thrown here gives the
 * document response HTTP 404 as well as the not-found page.
 *
 * Known limit: a well-formed CIK with no published record (e.g. /companies/0000000001) still answers HTTP 200 (a
 * soft 404). The loader does not run on the server while `defaultSsr` is false, so existence is only known on the
 * client, where the page says no record is published. A real 404 there needs server-side data for this route
 * (route-level `ssr: "data-only"` or a server-side existence check in params/beforeLoad).
 */
function parseCompanyParams(params: { cik: string }) {
  if (!isCikAddress(params.cik)) throw notFound({ data: { cik: params.cik } });
  return { cik: params.cik };
}

export const Route = createFileRoute("/companies/$cik")({
  params: { parse: parseCompanyParams, stringify: (params) => ({ cik: params.cik }) },
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(companyDetailQuery(params.cik));
    return { found: data != null, name: data?.summary.profile.name ?? null };
  },
  // The params notFound skips the loader, so the tab title follows the match status.
  head: ({ loaderData, match, params }) => {
    if (match.status === "notFound")
      return pageHead(
        "Company not found",
        "Company pages are addressed by a 10-digit SEC Central Index Key (CIK).",
      );
    if (loaderData && !loaderData.found)
      return pageHead(
        `CIK ${params.cik}`,
        `No SEC company-intelligence record is published for CIK ${params.cik}.`,
      );
    const name = loaderData?.name ?? `CIK ${params.cik}`;
    return pageHead(
      name,
      `${name}: MDLs named in its own SEC filings, evidence filings, and XBRL revenue, income and litigation accruals.`,
    );
  },
  component: Page,
  notFoundComponent: NotFound,
});

function Page() {
  const { cik } = Route.useParams();
  const q = useQuery(companyDetailQuery(cik));
  const name = companyTitle(q.data);
  return (
    <AppShell
      title={q.data ? name : `CIK ${cik}`}
      description="MDL exposure from the company's own SEC filings, with XBRL financial trends."
      breadcrumbs={[...COMPANY_CRUMBS, { label: q.data ? name : `CIK ${cik}` }]}
    >
      <CompanyProfile cik={cik} />
    </AppShell>
  );
}

function NotFound({ data }: NotFoundRouteProps) {
  const requested = requestedCik(data);
  const padded = paddedCik(requested);
  return (
    <AppShell
      title="Company not found"
      description="Company pages are addressed by SEC Central Index Key (CIK)."
      breadcrumbs={[...COMPANY_CRUMBS, { label: "Not found" }]}
    >
      <div
        role="status"
        className="max-w-2xl space-y-2 rounded-md border border-border bg-surface px-4 py-5 text-sm"
      >
        <p>
          {requested ? (
            <>
              “<span className="break-all font-medium">{requested}</span>” is not a 10-digit SEC
              CIK.{" "}
            </>
          ) : null}
          A company page needs the registrant&rsquo;s CIK written as 10 digits, including leading
          zeros (for example <span className="tabular-nums">/companies/0000200406</span>).
        </p>
        {padded ? (
          <p>
            With leading zeros:{" "}
            <Link
              to="/companies/$cik"
              params={{ cik: padded }}
              className="tabular-nums text-primary hover:underline"
            >
              /companies/{padded}
            </Link>
          </p>
        ) : null}
        <p>
          <Link to="/companies" className="text-primary hover:underline">
            Back to all companies
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
