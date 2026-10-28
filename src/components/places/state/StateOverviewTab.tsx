import { CourtSystemDiagram } from "@/components/charts/hierarchy/CourtSystemDiagram";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BarChart3, MapPin } from "lucide-react";
import { StateCensusSection } from "@/components/places/census/StateCensusSection";
import { StateExposureSection } from "@/components/places/exposure/StateExposureSection";
import { StateSourcePanelWithRegistry } from "@/components/corpus/StateSourcePanelWithRegistry";
import { StateMetricsPanel } from "@/components/states/StateMetricsPanel";
import type { MergedStateSource } from "@/lib/atlas/stateSources";
import type { CourtRow } from "@/lib/external/directoryTree";
import { CourtsJudgesSection } from "./CourtsJudgesSection";
import { LawSection } from "./LawSection";
import { GovDomainsPanel } from "./GovDomainsPanel";
import { LitigationSection } from "./LitigationSection";
import type { Hidden } from "./resourceFilter";
import { StateHeaderBand } from "./StateHeaderBand";
import { SectionIdentity } from "@/components/visuals/SectionIdentity";

export const OVERVIEW_SECTIONS = [
  { id: "courts", label: "Courts and judges" },
  { id: "law", label: "Law" },
  { id: "litigation", label: "Litigation and enforcement" },
  { id: "exposure", label: "Exposure" },
  { id: "demographics", label: "Demographics and economy" },
  { id: "resources", label: "Research resources" },
  { id: "government-sites", label: "Government sites" },
] as const;

function Section({
  id,
  title,
  note,
  children,
  state,
  courtId,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  children: ReactNode;
  state: string;
  courtId?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-12 space-y-2">
      <SectionIdentity id={id} title={title} note={note} state={state} courtId={courtId} />
      {children}
    </section>
  );
}

/** Where to go next from the state page: county comparison, the analysis tab and the all-state analytics. */
function Explore({
  stateName,
  onOpenAnalysis,
  onOpenCounties,
}: {
  stateName: string;
  onOpenAnalysis: () => void;
  onOpenCounties: () => void;
}) {
  return (
    <section className="resource-panel" aria-label={`Compare ${stateName}`}>
      <div className="research-band">
        <h3 className="flex items-center gap-2 text-label font-semibold text-foreground">
          <MapPin className="size-4" aria-hidden />
          Compare within and across states
        </h3>
      </div>
      <button
        type="button"
        onClick={onOpenCounties}
        className="resource-row w-full text-left"
        data-testid="explore-counties"
      >
        <span className="resource-icon">
          <MapPin className="size-4" aria-hidden />
        </span>
        <span className="flex-1">
          <span className="block text-[13px] font-semibold">Counties of {stateName}</span>
          <span className="text-[11px] text-muted-foreground">
            Open a county for Census figures and legal activity
          </span>
        </span>
        <ArrowRight className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onOpenAnalysis}
        className="resource-row w-full border-t border-border text-left"
        data-testid="explore-analysis"
      >
        <span className="resource-icon">
          <BarChart3 className="size-4" aria-hidden />
        </span>
        <span className="flex-1">
          <span className="block text-[13px] font-semibold">Compare counties and districts</span>
          <span className="text-[11px] text-muted-foreground">
            Maps, rankings, cities and associations
          </span>
        </span>
        <ArrowRight className="size-3.5" aria-hidden />
      </button>
      <Link
        to="/places/analytics"
        search={{}}
        className="resource-row border-t border-border"
        data-testid="explore-state-analytics"
      >
        <span className="resource-icon">
          <BarChart3 className="size-4" aria-hidden />
        </span>
        <span className="flex-1">
          <span className="block text-[13px] font-semibold">State analytics</span>
          <span className="text-[11px] text-muted-foreground">Every state and DC side by side</span>
        </span>
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </section>
  );
}

/**
 * The state overview, top to bottom: the key facts band, then courts and judges, law, litigation and enforcement,
 * demographics and economy, and research resources. A section navigation keeps each one one click away; nothing sits in a
 * side strip.
 */
export function StateOverviewTab(props: {
  usps: string;
  stateName: string;
  courts: CourtRow[] | undefined;
  courtsLoading: boolean;
  courtsError: boolean;
  onRetryCourts: () => void;
  sources: MergedStateSource[];
  hiddenSources: Hidden<MergedStateSource>[];
  sourcesLoading: boolean;
  sourcesError: boolean;
  onRetrySources: () => void;
  onOpenTab: (tab: "courts" | "judges" | "analysis" | "counties") => void;
}) {
  const { usps, stateName } = props;
  return (
    <div className="space-y-5" data-testid="state-overview">
      <StateHeaderBand
        usps={usps}
        stateName={stateName}
        courts={props.courts}
        courtsLoading={props.courtsLoading}
      />
      <nav
        aria-label="On this page"
        className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1 border-b border-border bg-background/95 px-1 py-1.5 backdrop-blur"
      >
        {OVERVIEW_SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {s.label}
          </a>
        ))}
      </nav>
      <Section
        id="courts"
        state={usps}
        courtId={props.courts?.find((c) => c.state === usps && c.type === "Federal district")?.id}
        title="Courts and judges"
        note="Federal districts and state courts as recorded"
      >
        <CourtsJudgesSection
          usps={usps}
          stateName={stateName}
          courts={props.courts}
          courtsLoading={props.courtsLoading}
          courtsError={props.courtsError}
          onRetryCourts={props.onRetryCourts}
          onOpenCourts={() => props.onOpenTab("courts")}
          onOpenJudges={() => props.onOpenTab("judges")}
        />
        {props.courts?.some((c) => c.system === "State" && c.state === usps) ? (
          <CourtSystemDiagram key={usps} rows={props.courts} initialState={usps} showFederal={false} />
        ) : null}
      </Section>
      <Section
        id="law"
        state={usps}
        title="Law"
        note="Codes, constitution, regulations, court rules and time limits, each from its official publisher"
      >
        <LawSection
          usps={usps}
          stateName={stateName}
          onOpenCourts={() => props.onOpenTab("courts")}
        />
      </Section>
      <Section
        id="litigation"
        state={usps}
        title="Litigation and enforcement"
        note="Federal civil caseload, MDLs, consumer complaints and workplace safety"
      >
        <LitigationSection usps={usps} stateName={stateName} />
      </Section>
      <StateExposureSection usps={usps} stateName={stateName} />
      <Section
        id="demographics"
        state={usps}
        title="Demographics and economy"
        note="U.S. Census Bureau: American Community Survey, Population Estimates and County Business Patterns"
      >
        <StateCensusSection usps={usps} stateName={stateName} />
        <div className="grid items-start gap-3 xl:grid-cols-2">
          <StateMetricsPanel
            key={usps}
            usps={usps}
            heading="Health, safety and other state metrics"
            metrics={[
              "overdose_rate",
              "synthetic_opioid_rate",
              "fars_rate",
              "nhtsa_complaint_rate",
              "fda_recalls",
            ]}
            note="Population, income and unemployment are the Census figures above; these are other official series, each from its own agency."
          />
          <Explore
            stateName={stateName}
            onOpenAnalysis={() => props.onOpenTab("analysis")}
            onOpenCounties={() => props.onOpenTab("counties")}
          />
        </div>
      </Section>
      <Section
        id="resources"
        state={usps}
        title="Research resources"
        note="Official and library sources; commercial publishers and other states' pages are not listed"
      >
        <StateSourcePanelWithRegistry
          key={usps}
          compact
          heading="Research resources"
          rows={props.sources}
          hidden={props.hiddenSources}
          state={usps}
          loading={props.sourcesLoading}
          error={props.sourcesError}
          onRetry={props.onRetrySources}
        />
      </Section>
      <Section
        id="government-sites"
        state={usps}
        title="Official government websites"
        note="Domains the CISA .gov registry and the GSA list register to this state, as the publishers give them"
      >
        <GovDomainsPanel key={usps} usps={usps} stateName={stateName} />
      </Section>
    </div>
  );
}
