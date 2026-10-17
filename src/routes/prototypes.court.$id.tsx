import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import { entityQuery } from "@/components/corpus/EntityPage";
import { PrototypeNotice } from "@/components/prototypes/PrototypeNotice";
import { CourtProfilePrototype } from "@/components/prototypes/CourtProfilePrototype";
import { getCourtAnalytics } from "@/lib/external/courtAnalytics.functions";
import { getCourtJudges } from "@/lib/external/judgeProfiles.functions";
import { pageHead } from "@/lib/corpus/head";

const FCMS_PDF =
  "https://www.uscourts.gov/sites/default/files/document/fcms_na_distprofile0630.2026.pdf";

export const Route = createFileRoute("/prototypes/court/$id")({
  head: () => pageHead("Court profile prototype", "Design prototype of the court profile page."),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  const record = useQuery(entityQuery("court_spine", id));
  const analytics = useQuery({
    queryKey: ["court-analytics", id],
    queryFn: () => getCourtAnalytics({ data: { id } }),
  });
  const judges = useQuery({
    queryKey: ["court-judges", id],
    queryFn: () => getCourtJudges({ data: { id } }),
  });
  const raw = (record.data as { raw?: Record<string, unknown> | null } | undefined)?.raw ?? null;
  const cells = (raw?.["cells"] ?? {}) as Record<string, unknown>;
  const loading = record.isLoading || analytics.isLoading || judges.isLoading;
  return (
    <AppShell
      title="Court profile — design prototype"
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Prototypes", to: "/prototypes" },
        { label: "Court" },
      ]}
    >
      <PrototypeNotice />
      {loading ? (
        <div
          className="h-96 animate-pulse rounded-lg border border-border bg-muted/40"
          aria-busy="true"
        />
      ) : analytics.isError || judges.isError ? (
        <p role="alert" className="text-sm text-destructive">
          The court record could not be loaded.
        </p>
      ) : analytics.data ? (
        <CourtProfilePrototype
          title={String(raw?.["title"] ?? analytics.data.court.name)}
          system={String(cells["system"] ?? "Federal")}
          state={typeof cells["state"] === "string" ? cells["state"] : null}
          court={analytics.data.court}
          judges={judges.data ?? []}
          distributions={analytics.data.national?.distributions ?? {}}
          sourceUrl={FCMS_PDF}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          No caseload statistics are recorded for this court.
        </p>
      )}
    </AppShell>
  );
}
