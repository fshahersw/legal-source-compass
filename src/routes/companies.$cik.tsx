import type { CSSProperties } from "react";
import { createFileRoute, Link, notFound, type NotFoundRouteProps } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import {
  CompanyProfile,
  companyDetailQuery,
  companyTitle,
} from "@/components/companies/CompanyProfile";
import { CompanyLogo } from "@/components/companies/CompanyHeader";
import { tickerLine } from "@/components/companies/companyStatements";
import { companyStatementsQuery } from "@/components/companies/companyQueries";
import { normalizeCompanySearch, tabOf, viewOf } from "@/components/companies/companySearch";
import { isCikAddress, paddedCik, requestedCik } from "@/components/companies/cik";
import { pageHead } from "@/lib/corpus/head";
import { CompanyEnforcementPanel } from "@/components/enforcement/actions/CompanyEnforcementPanel";
import { RegulatoryRecordPanel } from "@/components/enforcement/regulatory/RegulatoryRecordPanel";
import { CompanyCepPanel } from "@/components/enforcement/oversight/CompanyCepPanel";
import { CompanyLegalProceedings } from "@/components/apiLaw/CompanyLegalProceedings";
import { CompanyEnforcementTrend } from "@/components/companies/CompanyEnforcementTrend";
import { CompanyFederalAwardsPanel } from "@/components/calculators/CompanyFederalAwardsPanel";
import { accentVars, useBrandAccent } from "@/components/companies/brandAccent";

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
  validateSearch: normalizeCompanySearch,
  loader: async ({ context, params }) => {
    // The statements read overlaps the profile read; tabs other than litigation render from it.
    void context.queryClient.prefetchQuery(companyStatementsQuery(params.cik));
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
      `${name}: financial statements, segments, earnings releases and filings from SEC EDGAR, with the MDLs named in its own filings.`,
    );
  },
  component: Page,
  notFoundComponent: NotFound,
});

function Page() {
  const { cik } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useQuery(companyDetailQuery(cik));
  const st = useQuery(companyStatementsQuery(cik));
  const name = q.data ? companyTitle(q.data) : (st.data?.name ?? `CIK ${cik}`);
  const known = Boolean(q.data || st.data);
  const view = viewOf(tabOf(search)).id;
  // Charts on this page draw their first series in the colour of the company's own site icon when it passes the
  // palette checks (brandAccent.ts); otherwise the default palette stays.
  const accent = useBrandAccent(st.data?.logo?.path);
  const vars = accentVars(accent) as CSSProperties;
  return (
    <AppShell
      title={name}
      description={
        known
          ? `${tickerLine(st.data ?? null, q.data?.summary ?? null)} · ${st.data?.sicDescription ?? q.data?.summary.profile.sicDescription ?? "Industry not recorded"}`
          : "Financial statements, segments, investor documents and filings from SEC EDGAR, with MDL exposure from the company's own filings."
      }
      emblem={
        known ? (
          <span
            className="inline-flex rounded-xl"
            style={accent ? { ...vars, boxShadow: "0 0 0 2px var(--entity-mark)" } : undefined}
            title={accent ? "Page colour taken from the company's site icon" : undefined}
          >
            <CompanyLogo profile={st.data ?? null} cik={cik} settled={!st.isPending} />
          </span>
        ) : undefined
      }
      breadcrumbs={[...COMPANY_CRUMBS, { label: name }]}
    >
      <div style={vars} data-entity-accent={accent ? accent.light : undefined}>
        <CompanyProfile
          cik={cik}
          search={search}
          onNavigate={(next, opts) =>
            void navigate({ search: next, replace: opts?.replace ?? true, resetScroll: false })
          }
        />
        {/* Overview keeps the enforcement trend; the record lists sit with the litigation evidence. */}
        {view === "overview" || view === "litigation" ? (
          <CompanyEnforcementTrend cik={cik} className="mt-3" />
        ) : null}
        {view === "litigation" ? (
          <>
            <CompanyLegalProceedings cik={cik} className="mt-3" />
            <CompanyEnforcementPanel cik={cik} className="mt-3" />
            <RegulatoryRecordPanel cik={cik} className="mt-3" />
            <CompanyCepPanel cik={cik} className="mt-3" />
            <CompanyFederalAwardsPanel cik={cik} className="mt-3" />
          </>
        ) : null}
      </div>
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
