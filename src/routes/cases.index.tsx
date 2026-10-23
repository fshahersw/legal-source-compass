import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { casesSearchQuery } from "@/components/caselaw/caseQueries";
import { CaseSearchPage } from "@/components/caselaw/CaseSearchPage";
import { normalizeCaseSearch } from "@/components/caselaw/caseSearch";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/cases/")({
  validateSearch: normalizeCaseSearch,
  loaderDeps: ({ search }) => search,
  // The first server render waits for name/citation results; the other modes load in the browser with their own states.
  loader: ({ context, deps }) => {
    if (deps.mode && deps.mode !== "cases") return undefined;
    const warm = context.queryClient.prefetchQuery(casesSearchQuery(deps));
    return typeof window === "undefined" ? warm : undefined;
  },
  head: () =>
    pageHead(
      "Case law",
      "Read and search opinions of every court level from CourtListener's bulk data: the Supreme Court, federal courts of appeals and district courts, state highest and intermediate appellate courts, and other courts.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="Case law"
      description="Every court level, from the Supreme Court to federal district and state appellate courts: find a case by name or citation, filter by court level, state and court, and search opinion text."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Case law" },
      ]}
    >
      <CaseSearchPage
        s={search}
        nav={(next) => void navigate({ search: next, replace: false, resetScroll: false })}
      />
    </AppShell>
  );
}
