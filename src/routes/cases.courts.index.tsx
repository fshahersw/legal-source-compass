import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { CourtDirectory } from "@/components/caselaw/CourtDirectory";
import { normalizeDirectory } from "@/components/caselaw/courtCaseLawData";
import { courtsQuery } from "@/components/caselaw/caseQueries";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/cases/courts/")({
  validateSearch: normalizeDirectory,
  loader: ({ context }) => {
    const warm = context.queryClient.prefetchQuery(courtsQuery);
    return typeof window === "undefined" ? warm : undefined;
  },
  head: () =>
    pageHead(
      "Case law by court",
      "Every court with case law held here, by court level and state: Supreme Court, federal courts of appeals, state highest and intermediate appellate courts, federal district courts and other courts.",
    ),
  component: Page,
});

function Page() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="Case law by court"
      description="Courts with decisions held here, by court level and state, with how much opinion text is stored and searchable."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Case law", to: "/cases" },
        { label: "By court" },
      ]}
    >
      <CourtDirectory
        s={s}
        nav={(next) => void navigate({ search: next, replace: true, resetScroll: false })}
      />
    </AppShell>
  );
}
