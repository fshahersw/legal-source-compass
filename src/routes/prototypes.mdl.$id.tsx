import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import { mdlAnalyticsQuery } from "@/components/matters/MdlAnalytics";
import { massTortSignalsQuery } from "@/components/regulatory/MassTortSignals";
import { PrototypeNotice } from "@/components/prototypes/PrototypeNotice";
import { MdlDossierPrototype } from "@/components/prototypes/MdlDossierPrototype";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/prototypes/mdl/$id")({
  head: () => pageHead("MDL dossier prototype", "Design prototype of an MDL dossier page."),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  const analytics = useQuery(mdlAnalyticsQuery);
  const signals = useQuery(massTortSignalsQuery);
  const mdl = analytics.data?.mdls.find((m) => String(m.mdl) === id) ?? null;
  const signal = signals.data?.find((s) => String(s.mdl) === id) ?? null;
  const peers =
    mdl && analytics.data
      ? analytics.data.mdls.filter(
          (m) => m.status === "pending" && m.type === mdl.type && m.mdl !== mdl.mdl,
        )
      : [];
  return (
    <AppShell
      title="MDL dossier — design prototype"
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Prototypes", to: "/prototypes" },
        { label: `MDL ${id}` },
      ]}
    >
      <PrototypeNotice />
      {analytics.isLoading || signals.isLoading ? (
        <div
          className="h-96 animate-pulse rounded-lg border border-border bg-muted/40"
          aria-busy="true"
        />
      ) : analytics.isError ? (
        <p role="alert" className="text-sm text-destructive">
          MDL analytics could not be loaded.
        </p>
      ) : mdl ? (
        <MdlDossierPrototype mdl={mdl} signal={signal} peers={peers} />
      ) : (
        <p className="text-sm text-muted-foreground">No MDL {id} in the JPML series.</p>
      )}
    </AppShell>
  );
}
