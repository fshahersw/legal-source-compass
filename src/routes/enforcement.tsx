import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { EnforcementPage } from "@/components/enforcement/EnforcementPage";
import { epaEnforcementQuery } from "@/components/enforcement/EpaEnforcement";
import {
  ENFORCEMENT_AGENCIES,
  isCanonicalEnforcementQuery,
  resolveEnforcementLocation,
  type EnforcementSearch,
} from "@/lib/atlas/legacyRoutes";
import { pageHead } from "@/lib/corpus/head";

const TAB_TITLES = {
  actions: "Actions by agency",
  exclusions: "Exclusions",
  oversight: "Oversight reports",
  merger: "Merger review",
  sources: "Agency data sources",
} as const;

export const Route = createFileRoute("/enforcement")({
  // Former tab values (?tab=cpsc, ?actions=sec, ?state=CA …) are rewritten to their place in the new layout.
  validateSearch: (raw: Record<string, unknown>): EnforcementSearch => {
    const target = resolveEnforcementLocation(raw);
    return target.to === "/enforcement" ? target.search : {};
  },
  beforeLoad: ({ location }) => {
    const raw = location.search as Record<string, unknown>;
    if (isCanonicalEnforcementQuery(raw)) return;
    const target = resolveEnforcementLocation(raw);
    throw redirect({ to: target.to, search: target.search as never, replace: true });
  },
  loaderDeps: ({ search }) => ({ agency: search.tab === "actions" ? search.agency : undefined }),
  loader: ({ context, deps }) =>
    deps.agency === "epa" ? context.queryClient.prefetchQuery(epaEnforcementQuery) : undefined,
  head: () =>
    pageHead(
      "Enforcement",
      "Federal enforcement actions by agency (DOJ, FTC, SEC, Federal Reserve, EPA, OSHA, CPSC, CFPB), exclusion lists, Inspector General oversight reports and merger review, from official agency data.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const agency =
    search.tab === "actions"
      ? ENFORCEMENT_AGENCIES.find((a) => a.id === (search.agency ?? "doj"))
      : undefined;
  const title = search.tab ? TAB_TITLES[search.tab] : "Enforcement";
  const description = !search.tab
    ? "Federal enforcement actions, exclusions, oversight reports and merger review from official agency data. Settlements are in Litigation; rulemaking is in Law & government."
    : agency
      ? `${agency.name}, from the agency's own published data.`
      : null;
  return (
    <AppShell
      title={agency ? `${title}: ${agency.label}` : title}
      {...(description ? { description } : {})}
      breadcrumbs={agency ? [{ label: agency.label }] : []}
    >
      <EnforcementPage
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true, resetScroll: false })}
      />
    </AppShell>
  );
}
