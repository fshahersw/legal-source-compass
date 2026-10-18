import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import {
  EnforcementPage,
  normalizeEnforcementSearch,
} from "@/components/enforcement/EnforcementPage";
import { epaEnforcementQuery } from "@/components/enforcement/EpaEnforcement";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/law_/enforcement")({
  validateSearch: normalizeEnforcementSearch,
  loader: ({ context }) => context.queryClient.prefetchQuery(epaEnforcementQuery),
  head: () =>
    pageHead(
      "Enforcement and rulemaking",
      "EPA civil enforcement cases by state, statute and defendant; Federal Register rulemaking; CPSC recalls by hazard and manufacturing country.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="Enforcement and rulemaking"
      description="Federal enforcement cases, rulemaking activity and product recalls from official agency data."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Enforcement" },
      ]}
    >
      <EnforcementPage
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true, resetScroll: false })}
      />
    </AppShell>
  );
}
