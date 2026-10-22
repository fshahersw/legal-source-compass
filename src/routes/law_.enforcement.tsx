import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { DailyInsightCard } from "@/components/insights/DailyInsightCard";
import {
  EnforcementPage,
  normalizeEnforcementSearch,
  type EnforcementSearch,
} from "@/components/enforcement/EnforcementPage";
import { epaEnforcementQuery } from "@/components/enforcement/EpaEnforcement";
import { ActionsNav, ActionsPanel } from "@/components/enforcement/actions/ActionsSection";
import {
  normalizeActionsView,
  type ActionsView,
} from "@/components/enforcement/actions/actionsView";
import { pageHead } from "@/lib/corpus/head";

type Search = EnforcementSearch & { actions?: ActionsView };

/** Agency-data tabs keep their own search; `actions` selects an enforcement-action section instead. */
function normalizeSearch(raw: Record<string, unknown>): Search {
  const actions = normalizeActionsView(raw["actions"]);
  return actions ? { actions } : normalizeEnforcementSearch(raw);
}

export const Route = createFileRoute("/law_/enforcement")({
  validateSearch: normalizeSearch,
  loader: ({ context }) => context.queryClient.prefetchQuery(epaEnforcementQuery),
  head: () =>
    pageHead(
      "Enforcement and rulemaking",
      "EPA civil enforcement cases by state, statute and defendant; DOJ press releases, FTC and SEC enforcement actions and settlements confirmed on their official pages; Federal Register rulemaking; CPSC recalls.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppShell
      title="Enforcement and rulemaking"
      description="Federal enforcement cases and actions, rulemaking activity, product recalls and confirmed settlements from official agency data."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Enforcement" },
      ]}
    >
      <DailyInsightCard section="enforcement" className="mb-3" />
      <div className="mb-3">
        <ActionsNav
          view={search.actions}
          onView={(actions) =>
            void navigate({ search: actions ? { actions } : {}, replace: true, resetScroll: false })
          }
        />
      </div>
      {search.actions ? (
        <ActionsPanel view={search.actions} />
      ) : (
        <EnforcementPage
          search={search}
          onSearch={(next) => void navigate({ search: next, replace: true, resetScroll: false })}
        />
      )}
    </AppShell>
  );
}
