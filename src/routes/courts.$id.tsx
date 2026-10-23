import { createFileRoute, Link } from "@tanstack/react-router";
import { EntityError, EntityPage, entityQuery } from "@/components/corpus/EntityPage";
import { pageHead } from "@/lib/corpus/head";
import { recordedCourtState } from "@/lib/courts/recordedState";
import { courtLinkCompatible } from "@/lib/corpus/courtLinks";
import { buildEntityView } from "@/lib/external/entityView";
import { CourtArtwork } from "@/components/corpus/CourtArtwork";
import { CourtResources } from "@/components/corpus/CourtResources";
import { CourtAnalyticsPanel } from "@/components/corpus/CourtAnalyticsPanel";
import { CaseloadHistoryPanel } from "@/components/courts/CaseloadHistoryPanel";
import { CourtStatsTrendsPanel } from "@/components/courts/stats/CourtStatsTrendsPanel";
import { CourtLocationsPanel } from "@/components/courts/CourtLocationsPanel";
import { CourtRulesPanel } from "@/components/courts/rules/CourtRulesPanel";
import { CourtStructurePanel } from "@/components/courts/CourtStructurePanel";
import { CourtJudgesPanel } from "@/components/corpus/JudgeFjcPanel";
import { AppealsOutcomesPanel } from "@/components/judiciary/AppealsOutcomesPanel";
import { BankruptcyFilingsPanel } from "@/components/judiciary/BankruptcyFilingsPanel";
import { CourtVacanciesPanel } from "@/components/judiciary/CourtVacanciesPanel";
import { CriminalCaseloadPanel } from "@/components/judiciary/CriminalCaseloadPanel";
import { CourtCollectionPanel } from "@/components/courts/clb/CourtCollectionPanel";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { AppellatePanel } from "@/components/courts/clb/AppellatePanel";
import { BankruptcyActivityPanel } from "@/components/courts/clb/BankruptcyActivityPanel";
import { OralArgumentsPanel } from "@/components/courts/clb/OralArgumentsPanel";
import { DistrictGlancePanel } from "@/components/courts/clb/DistrictGlancePanel";
import { ProsecutionsPanel } from "@/components/enforcement/extra/ProsecutionsPanel";
import { SentencingPanel } from "@/components/enforcement/extra/SentencingPanel";
import { CourtJudgesRosterPanel } from "@/components/courts/CourtJudgesRosterPanel";

/** Court ids the filings index accepts (documents_for_entity_v1). */
const COURT_ID = /^[a-z0-9_-]{1,40}$/;
export const Route = createFileRoute("/courts/$id")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(entityQuery("court_spine", params.id)),
  head: ({ loaderData }) => {
    const raw = (loaderData as { raw?: Record<string, unknown> | null } | undefined)?.raw;
    const name = String(raw?.["title"] ?? raw?.["name"] ?? "Court profile");
    return pageHead(name, `Court profile for ${name}: court information and recorded sources.`);
  },
  component: Page,
  errorComponent: ({ error }) => (
    <EntityError error={error instanceof Error ? error : new Error(String(error))} />
  ),
  notFoundComponent: () => <p className="p-6 text-sm">Court not found.</p>,
});
function Page() {
  const { id } = Route.useParams();
  const { raw } = Route.useLoaderData();
  const view = buildEntityView(raw ?? {});
  const facts = new Map(view.facts.map(([key, value]) => [key.toLowerCase(), value]));
  const fact = (key: string) =>
    typeof facts.get(key) === "string" ? String(facts.get(key)) : null;
  const cells = (raw?.["cells"] && typeof raw["cells"] === "object" ? raw["cells"] : {}) as Record<
    string,
    unknown
  >;
  const state = recordedCourtState(raw?.["state"] ?? cells["state"] ?? fact("state"));
  const system = String(raw?.["system"] ?? cells["system"] ?? fact("system") ?? "Unknown system");
  const type = String(
    raw?.["type"] ?? cells["type"] ?? fact("type") ?? view.subtitle?.split(" · ")[0] ?? "Court",
  );
  // Courts & judges › <state> (the court directory narrowed to this court's system and state) › <court>.
  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [
    { label: "Courts", to: "/courts" },
  ];
  if (state)
    crumbs.push({
      label: state.name,
      to: "/courts",
      search:
        system === "Federal" || system === "State"
          ? { system, state: state.usps }
          : { state: state.usps },
    });
  const withheld = view.links.filter((link) => !courtLinkCompatible(link, system)).length;
  return (
    <EntityPage
      dataset="court_spine"
      id={id}
      crumbs={crumbs}
      linkFilter={(links) => links.filter((link) => courtLinkCompatible(link, system))}
      lead={(_raw, v) => (
        <CourtArtwork
          courtId={id}
          title={v.title}
          system={system}
          type={type}
          recordedLinks={v.links}
        />
      )}
      extra={(record) => (
        <>
          <CourtStructurePanel courtId={id} />
          <CourtLocationsPanel courtId={id} />
          <CourtRulesPanel courtId={id} />
          <CourtJudgesRosterPanel courtId={id} />
          <CourtAnalyticsPanel courtId={id} />
          <CaseloadHistoryPanel courtId={id} />
          <CourtStatsTrendsPanel courtId={id} />
          <CourtJudgesPanel courtId={id} />
          <CourtVacanciesPanel courtId={id} />
          <AppealsOutcomesPanel courtId={id} />
          <CriminalCaseloadPanel courtId={id} />
          <BankruptcyFilingsPanel courtId={id} />
          <DistrictGlancePanel courtId={id} />
          <SentencingPanel courtId={id} />
          <ProsecutionsPanel courtId={id} />
          <CourtCollectionPanel courtId={id} />
          {COURT_ID.test(id) ? <DocumentsPanel type="court" id={id} className="mb-6" /> : null}
          <BankruptcyActivityPanel courtId={id} />
          <AppellatePanel courtId={id} />
          <OralArgumentsPanel courtId={id} />
          <CourtResources raw={record} courtId={id} system={system} />
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            {state ? (
              <Link
                to="/places/$state"
                params={{ state: state.usps }}
                search={{ tab: "courts" }}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-muted"
              >
                ← Courts in {state.name}
              </Link>
            ) : null}
            {withheld ? (
              <details className="max-w-2xl text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {withheld} conflicting court homepage link withheld
                </summary>
                <p className="mt-2 leading-relaxed">
                  The source combines a state-court identity with a federal-court homepage. That
                  link is not presented as this court’s website. The original source record remains
                  unchanged for review.
                </p>
              </details>
            ) : null}
          </div>
        </>
      )}
    />
  );
}
