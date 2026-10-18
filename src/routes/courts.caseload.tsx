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
      "Federal civil caseload",
      "Federal civil cases filed, terminated and pending by district and nature of suit, FY1988 to FY2026, from the Federal Judicial Center Integrated Database, with the MDL docket numbers the data carries.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="Federal civil caseload"
      description="Official federal civil case statistics by district court and nature of suit, FY1988 to FY2026, from the Federal Judicial Center Integrated Database. The newest fiscal year is partial and is never ranked."
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
