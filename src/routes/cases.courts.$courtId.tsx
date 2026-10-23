import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { CourtCaseLaw } from "@/components/caselaw/CourtCaseLaw";
import { normalizeCourtCases } from "@/components/caselaw/courtCaseLaw";
import { courtYearsQuery } from "@/components/caselaw/caseQueries";
import { pageHead } from "@/lib/corpus/head";

const COURT_ID = /^[a-z0-9_-]{1,40}$/;

export const Route = createFileRoute("/cases/courts/$courtId")({
  validateSearch: normalizeCourtCases,
  loader: async ({ context, params }) =>
    COURT_ID.test(params.courtId)
      ? context.queryClient.ensureQueryData(courtYearsQuery(params.courtId))
      : null,
  head: ({ loaderData }) => {
    const name = loaderData?.court?.name ?? "Court";
    return pageHead(
      `${name}: case law`,
      `Decisions of ${name} held here, by year, with their opinion text and citations.`,
    );
  },
  component: Page,
  pendingComponent: () => (
    <div className="space-y-2 p-6" aria-busy="true" aria-label="Loading the court's case law">
      <div className="h-6 w-1/2 animate-pulse rounded bg-muted/60" />
      <div className="h-40 animate-pulse rounded bg-muted/50" />
    </div>
  ),
  errorComponent: () => (
    <p role="alert" className="p-6 text-[13px]">
      This court's case law could not be loaded. Try again shortly.
    </p>
  ),
});

function Page() {
  const { courtId } = Route.useParams();
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const data = Route.useLoaderData();
  const name = data?.court?.name ?? courtId;
  return (
    <AppShell
      title={name}
      description="Decisions held here from CourtListener's bulk data, by year filed."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Case law", to: "/cases" },
        { label: "By court", to: "/cases/courts" },
        { label: name.length > 60 ? `${name.slice(0, 57)}…` : name },
      ]}
    >
      {COURT_ID.test(courtId) ? (
        <CourtCaseLaw
          courtId={courtId}
          s={s}
          nav={(next) => void navigate({ search: next, replace: true, resetScroll: false })}
        />
      ) : (
        <p className="text-[13px] text-muted-foreground">This is not a court id.</p>
      )}
    </AppShell>
  );
}
