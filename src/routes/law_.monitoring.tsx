import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { RegulatoryMonitoring } from "@/components/regulatory/RegulatoryMonitoring";
import {
  MONITORING_VIEW_LABELS,
  normalizeMonitoringSearch,
} from "@/components/regulatory/monitoringView";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/law_/monitoring")({
  validateSearch: normalizeMonitoringSearch,
  head: () =>
    pageHead(
      "Regulatory intelligence",
      "Recall patterns, complaint types, FDA source analytics and versioned regulatory evidence.",
    ),
  component: MonitoringPage,
});

function MonitoringPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title={
        search.view === "analytics"
          ? "FDA analytics"
          : search.view === "patterns"
            ? "Recall patterns"
            : "Regulatory intelligence"
      }
      description={
        search.view === "patterns"
          ? "Problem themes, repeat-recall firms, multi-firm clusters, named suppliers, unusual months and complaint types."
          : search.view === "analytics"
            ? ""
            : "Source changes and retained evidence."
      }
      // Products & safety › Regulatory intelligence › <view> (the shell adds the section and tab).
      breadcrumbs={[{ label: MONITORING_VIEW_LABELS[search.view] }]}
    >
      <RegulatoryMonitoring search={search} onSearch={(next) => void navigate({ search: next })} />
    </AppShell>
  );
}
