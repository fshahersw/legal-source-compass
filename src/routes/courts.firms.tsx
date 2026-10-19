import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { FirmsPage } from "@/components/courts/firms/FirmsPage";
import { landscapeQuery } from "@/components/courts/firms/firmQueries";
import { normalizeFirmSearch } from "@/components/courts/firms/firmSearch";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/courts/firms")({
  validateSearch: normalizeFirmSearch,
  loader: ({ context }) => {
    const warm = context.queryClient.prefetchQuery(landscapeQuery);
    return typeof window === "undefined" ? warm : undefined;
  },
  head: () =>
    pageHead(
      "Law firms in MDL litigation",
      "Law firms on the MDL master dockets of the matter registry: appearances by side, concentration per MDL, co-counsel and opposing-counsel pairs, and patterns across MDLs. Counsel entries on master dockets, not complete caseloads.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="Law firms in MDL litigation"
      description="Who appears on the MDL master dockets, on which side, with which co-counsel and against whom, and how concentrated each MDL's plaintiff side is. Counsel entries on master dockets, not a firm's whole caseload."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Courts", to: "/courts" },
        { label: "Law firms" },
      ]}
    >
      <FirmsPage
        search={search}
        onNavigate={(next, opts) =>
          void navigate({ search: next, replace: opts?.replace ?? true, resetScroll: false })
        }
      />
    </AppShell>
  );
}
