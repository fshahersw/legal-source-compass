import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { CaseloadPage } from "@/components/courts/caseload/CaseloadPage";
import { districtsQuery, nationalQuery } from "@/components/courts/caseload/caseloadQueries";
import { normalizeCaseloadSearch } from "@/components/courts/caseload/caseloadSearch";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/courts/caseload")({
  validateSearch: normalizeCaseloadSearch,
  loaderDeps: ({ search }) => ({ tab: search.tab ?? "districts" }),
  // The first server render waits for the Districts data; a switch between tabs in the browser never waits on it,
  // so the tab changes at once and the tab shows its own loading state.
  loader: ({ context, deps }) => {
    if (deps.tab !== "districts") return undefined;
    const warm = Promise.all([
      context.queryClient.prefetchQuery(districtsQuery),
      context.queryClient.prefetchQuery(nationalQuery),
    ]);
    return typeof window === "undefined" ? warm : undefined;
  },
  head: () =>
    pageHead(
      "Federal caseload statistics",
      "Federal civil cases by district and nature of suit from the Federal Judicial Center Integrated Database (FY1988 to FY2026), and every U.S. Courts published statistical table series (Judicial Business, Statistical Tables, Caseload Statistics, Bankruptcy Filings, BAPCPA and Wiretap reports) as trends by period, with quarterly bankruptcy filings through September 30, 2026.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="Federal caseload statistics"
      description="Federal civil cases by district and nature of suit from the Federal Judicial Center Integrated Database (FY1988 to FY2026; the newest fiscal year is partial and never ranked), and the U.S. Courts published statistical tables as trends by period, with quarterly bankruptcy filings."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Courts", to: "/courts" },
        { label: "Caseload" },
      ]}
    >
      <CaseloadPage
        search={search}
        onNavigate={(next, opts) =>
          void navigate({ search: next, replace: opts?.replace ?? true, resetScroll: false })
        }
      />
    </AppShell>
  );
}
