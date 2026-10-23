import { Link } from "@tanstack/react-router";
import { BadgeDollarSign } from "lucide-react";
import { DailyInsightCard } from "@/components/insights/DailyInsightCard";
import { SectionHub } from "@/components/atlas/hub/SectionHub";
import {
  DEFAULT_ENFORCEMENT_AGENCY,
  ENFORCEMENT_AGENCIES,
  type EnforcementAgency,
  type EnforcementSearch,
} from "@/lib/atlas/legacyRoutes";
import { cn } from "@/lib/utils";
import { ActionsPanel } from "./actions/ActionsSection";
import { ConsumerComplaints } from "./ConsumerComplaints";
import { CpscRecalls } from "./CpscRecalls";
import { EnforcementSources } from "./EnforcementSources";
import { ExclusionsSearch } from "./extra/ExclusionsSearch";
import { EpaEnforcement } from "./EpaEnforcement";
import { FtcMergerReview } from "./FtcMergerReview";
import { OshaEnforcement } from "./OshaEnforcement";
import { OversightReports } from "./oversight/OversightReports";

export type { EnforcementSearch };

/**
 * /enforcement: the section's tabs (Overview, Actions by agency, Exclusions, Oversight reports, Merger review, Agency
 * data sources) are the shell's tab strip (`?tab=`); Actions by agency has one agency selector (`?agency=`). Rulemaking
 * moved to Law & government and settlements to Litigation (the former addresses redirect there).
 */
export function EnforcementPage({
  search,
  onSearch,
}: {
  search: EnforcementSearch;
  onSearch: (next: EnforcementSearch) => void;
}) {
  switch (search.tab) {
    case "actions":
      return (
        <AgencyActions
          agency={search.agency ?? DEFAULT_ENFORCEMENT_AGENCY}
          state={search.state}
          onState={(state) =>
            onSearch({ tab: "actions", agency: "epa", ...(state ? { state } : {}) })
          }
        />
      );
    case "exclusions":
      return <ExclusionsSearch />;
    case "oversight":
      return <OversightReports />;
    case "merger":
      return <FtcMergerReview />;
    case "sources":
      return <EnforcementSources />;
    default:
      return (
        <SectionHub section="enforcement">
          <DailyInsightCard section="enforcement" />
        </SectionHub>
      );
  }
}

/** Agencies whose figures are the publisher's own per release (never summed across releases). */
const PUBLISHED_ACTIONS = new Set<EnforcementAgency>(["doj", "ftc", "sec", "frb"]);

function AgencyActions({
  agency,
  state,
  onState,
}: {
  agency: EnforcementAgency;
  state: string | undefined;
  onState: (state: string | undefined) => void;
}) {
  const current = ENFORCEMENT_AGENCIES.find((a) => a.id === agency)!;
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav
          aria-label="Agency"
          className="flex max-w-full gap-1 overflow-x-auto rounded-md border border-border bg-surface p-1"
        >
          {ENFORCEMENT_AGENCIES.map((a) => (
            <Link
              key={a.id}
              to="/enforcement"
              search={{ tab: "actions", agency: a.id }}
              replace
              resetScroll={false}
              title={a.name}
              aria-current={a.id === agency ? "page" : undefined}
              className={cn(
                "shrink-0 whitespace-nowrap rounded px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                a.id === agency
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {a.label}
            </Link>
          ))}
        </nav>
        {PUBLISHED_ACTIONS.has(agency) ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <BadgeDollarSign className="size-3.5" aria-hidden />
            Figures are as stated by the publisher, never summed across releases
          </span>
        ) : null}
      </div>
      <h2 className="sr-only">{current.name}</h2>
      {agency === "doj" || agency === "ftc" || agency === "sec" || agency === "frb" ? (
        <ActionsPanel view={agency} />
      ) : agency === "epa" ? (
        <EpaEnforcement state={state} onState={onState} />
      ) : agency === "osha" ? (
        <OshaEnforcement />
      ) : agency === "cpsc" ? (
        <CpscRecalls />
      ) : (
        <ConsumerComplaints />
      )}
    </div>
  );
}
