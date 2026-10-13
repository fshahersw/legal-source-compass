import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { RegulatoryMonitoring } from "@/components/regulatory/RegulatoryMonitoring";
import { normalizeMonitoringSearch } from "@/components/regulatory/monitoringView";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/law_/monitoring")({
  validateSearch: normalizeMonitoringSearch,
  head: () =>
    pageHead(
      "Regulatory intelligence",
      "Review versioned regulatory source changes, retained evidence, coverage and browser-saved investigations.",
    ),
  component: MonitoringPage,
});

function MonitoringPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="Regulatory intelligence"
      description="Source changes, evidence and investigation review."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Monitoring" },
      ]}
    >
      <RegulatoryMonitoring search={search} onSearch={(next) => void navigate({ search: next })} />
    </AppShell>
  );
}
