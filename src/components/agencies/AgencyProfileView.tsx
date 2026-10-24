import { useMemo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { HowToRead } from "@/components/analysis/HowToRead";
import { ProfileSections } from "@/components/kit/ProfileSections";
import { AiSummary } from "@/components/kit/ai/AiSummary";
import { AskAiButton } from "@/components/kit/ai/AskAiButton";
import { buildSectionContext } from "@/components/kit/ai/buildSectionContext";
import { Kpi, Panel, SourceLink, StateNote } from "@/components/enforcement/parts";
import type { AgencyProfileData } from "@/lib/external/agencyProfile.functions";
import { ActivityChart } from "./ActivityChart";
import { AgencySeriesCards } from "./AgencySeriesCards";
import {
  AdminTable,
  AgendaPanelBody,
  BudgetPanelBody,
  CfrPanelBody,
  CommentsTable,
  DocList,
  EnforcementPanelBody,
  FR_API_DOCS,
  MonthlyChart,
  NOT_RECORDED,
  SpendingPanelBody,
  StructurePanelBody,
} from "./AgencyPanels";
import { agencyTakeaways, fmt, KIND_LABEL, monthRows, usd } from "./agencyView";

const UA_INDEX = "https://www.reginfo.gov/public/do/eAgendaXmlReport";
const CENSUS = "https://www.census.gov/data/tables/time-series/demo/popest/2020s-state-total.html";

/**
 * The analytical overview of one agency: KPIs with an AI summary, takeaways, then one scrollable page in sections
 * (rulemaking, pipeline, money, law and structure, enforcement and data) behind a sticky index. `after` renders at
 * the end of the last section (the oversight panel).
 */
export function AgencyProfileView({ data, after }: { data: AgencyProfileData; after?: ReactNode }) {
  const { profile, trends, budget, spending } = data;
  const takeaways = useMemo(() => agencyTakeaways(data), [data]);
  const months = useMemo(() => (trends ? monthRows(trends) : []), [trends]);
  if (!profile) return null;
  const s = profile.stats;
  const fy = budget?.years.find((y) => y.fy === s.latestFy);
  const active =
    !!trends && Object.entries(trends.yearly.ALL).some(([y, n]) => y >= "1995" && n > 0);
  const isComponentWithParentBudget = !budget && profile.subtierObligations;
  const aiContext = buildSectionContext({
    id: "agency-glance",
    title: `${profile.name}: headline figures`,
    scope: profile.name,
    source: "Federal Register API; Unified Agenda (reginfo.gov); USAspending",
    period: trends ? `Federal Register to ${trends.asOf}` : null,
    figures: [
      {
        label: "Final rules",
        value: s.rulesLastYear,
        unit: "documents",
        period: String(s.lastFullYear),
      },
      {
        label: "Final rules so far",
        value: s.rulesThisYear,
        unit: "documents",
        period: `${Number(s.lastFullYear) + 1}, partial year`,
      },
      {
        label: "Proposed rules",
        value: s.proposedLastYear,
        unit: "documents",
        period: String(s.lastFullYear),
      },
      {
        label: "Notices",
        value: s.noticesLastYear,
        unit: "documents",
        period: String(s.lastFullYear),
      },
      { label: "Significant final rules since 1994", value: s.significantRules, unit: "rules" },
      {
        label: "Open comment periods",
        value: s.openComments,
        unit: "documents",
        period: trends ? `as of ${trends.openComments.asOf}` : undefined,
      },
      { label: "Unified Agenda actions", value: s.agendaActions, unit: "actions" },
      {
        label: "Economically significant agenda actions",
        value: s.agendaEconomicallySignificant,
        unit: "actions",
      },
      {
        label: "Obligations",
        value: fy ? usd(fy.obligated) : null,
        period: `FY${s.latestFy}`,
      },
      {
        label: "Budgetary resources",
        value: fy ? usd(fy.budgetaryResources) : null,
        period: `FY${s.latestFy}`,
      },
    ],
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="rounded border border-border px-1.5 py-px text-[11px]">
          {KIND_LABEL[profile.kind]}
        </span>
        {profile.shortName ? <span className="font-mono">{profile.shortName}</span> : null}
        {profile.parent ? (
          <span>
            Part of{" "}
            <Link
              to="/agencies/$id"
              params={{ id: String(profile.parent.id) }}
              className="text-primary hover:underline"
            >
              {profile.parent.name}
            </Link>
          </span>
        ) : null}
        {profile.agencyUrl ? (
          <SourceLink href={profile.agencyUrl}>Official website</SourceLink>
        ) : null}
        <SourceLink href={profile.frUrl}>federalregister.gov</SourceLink>
        {profile.usaspending?.usaspendingUrl ? (
          <SourceLink href={profile.usaspending.usaspendingUrl}>USAspending</SourceLink>
        ) : null}
      </div>
      {profile.description ? (
        <details className="group rounded-md border border-border bg-surface px-3 py-1.5 text-xs">
          <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
            About this agency{" "}
            <span className="font-normal text-muted-foreground">
              · Federal Register description
            </span>
          </summary>
          <p className="mt-1 max-w-4xl leading-relaxed text-muted-foreground">
            {profile.description}
          </p>
        </details>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label={`Final rules ${s.lastFullYear}`}
          value={fmt(s.rulesLastYear)}
          note={`${fmt(s.rulesThisYear)} so far in ${Number(s.lastFullYear) + 1}`}
        />
        <Kpi
          label={`Proposed rules ${s.lastFullYear}`}
          value={fmt(s.proposedLastYear)}
          note={`${fmt(s.noticesLastYear)} notices`}
        />
        <Kpi
          label="Significant final rules"
          value={fmt(s.significantRules)}
          note="Published since 1994 (EO 12866)"
        />
        <Kpi
          label="Open comment periods"
          value={fmt(s.openComments)}
          note={trends ? `As of ${trends.openComments.asOf}` : undefined}
        />
        <Kpi
          label="Unified Agenda actions"
          value={fmt(s.agendaActions)}
          note={`${fmt(s.agendaEconomicallySignificant)} economically significant`}
        />
        <Kpi
          label={`Obligations FY${s.latestFy}`}
          value={
            fy
              ? usd(fy.obligated)
              : isComponentWithParentBudget
                ? usd(profile.subtierObligations!.obligations)
                : NOT_RECORDED
          }
          note={
            fy
              ? `of ${usd(fy.budgetaryResources)} budgetary resources`
              : isComponentWithParentBudget
                ? "Sub-agency award obligations (USAspending)"
                : "No USAspending agency with this name"
          }
        />
      </div>

      <AiSummary
        context={aiContext}
        actions={
          <AskAiButton
            sectionId="agency-glance"
            title={`${profile.name}: headline figures`}
            context={aiContext}
            questions={[
              "Is this agency issuing more or fewer rules than usual?",
              "What is in its regulatory pipeline?",
              "How large is its budget, and where does the money go?",
            ]}
          />
        }
      />

      <KeyTakeaways
        title="What stands out"
        items={takeaways}
        scope={trends ? `Federal Register to ${trends.asOf}` : undefined}
        note="Each line is computed from the figures below; comparisons name their base period."
      />

      <ProfileSections
        sections={[
          {
            id: "agency-sec-rulemaking",
            title: "Rulemaking",
            content: (
              <>
                {trends && !active ? (
                  <StateNote>
                    The Federal Register lists no document from this agency since 1995
                    {s.lastActiveYear ? ` (last recorded year: ${s.lastActiveYear})` : ""}. It may
                    be a former agency or one whose documents appear under another name.
                  </StateNote>
                ) : trends ? (
                  <>
                    <Panel
                      id="agency-activity"
                      title="Federal Register activity"
                      subtitle="Documents published per calendar year since 1995, with the administration in office"
                      footnote={
                        <>
                          Counts are the Federal Register API's facet counts by publication date; a
                          document naming several agencies counts for each, so department totals
                          include documents their components publish with them. Significant = a
                          Unified Agenda entry deemed significant under EO 12866.{" "}
                          <SourceLink href={FR_API_DOCS}>Federal Register API</SourceLink>
                        </>
                      }
                    >
                      <ActivityChart trends={trends} />
                    </Panel>
                    <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                      <Panel
                        id="agency-administrations"
                        title="By administration"
                        subtitle="Windows run January 20 to January 19 (Amendment XX); counted by publication date"
                        footnote="A year rate divides the count by the days in the window. Rules published early in a term can stem from the prior administration's work."
                      >
                        <AdminTable rows={trends.byAdministration} />
                      </Panel>
                      <Panel
                        title="Last 36 months"
                        subtitle={`Final and proposed rules per month; ${trends.partialMonth} is partial`}
                      >
                        <MonthlyChart rows={months} />
                      </Panel>
                    </div>
                    <div className="grid gap-3 xl:grid-cols-2">
                      <Panel
                        title="Significant final rules"
                        subtitle={`Latest of ${fmt(trends.significantTotals.RULE)} since 1994`}
                      >
                        <DocList
                          docs={trends.latestSignificantRules}
                          empty="No significant final rules recorded for this agency."
                        />
                      </Panel>
                      <Panel
                        title="Significant proposed rules"
                        subtitle={`Latest of ${fmt(trends.significantTotals.PRORULE)} since 1994`}
                      >
                        <DocList
                          docs={trends.latestSignificantProposed}
                          empty="No significant proposed rules recorded for this agency."
                        />
                      </Panel>
                    </div>
                    <Panel
                      id="agency-comments"
                      title="Open comment periods"
                      subtitle={`${fmt(trends.openComments.count)} documents accept comments on or after ${trends.openComments.asOf}; ${fmt(trends.openComments.closingWithin30Days)} close within 30 days`}
                      footnote="Closing dates are the comment dates the Federal Register lists; extensions published later are separate documents."
                    >
                      <CommentsTable comments={trends.openComments} />
                    </Panel>
                  </>
                ) : (
                  <StateNote>Federal Register activity is not recorded for this agency.</StateNote>
                )}
              </>
            ),
          },
          {
            id: "agency-sec-pipeline",
            title: "Regulatory pipeline",
            label: "Pipeline",
            content: (
              <>
                <Panel
                  id="agency-agenda"
                  title="Regulatory pipeline (Unified Agenda)"
                  subtitle={
                    profile.agenda
                      ? `${fmt(profile.agenda.total)} actions in publication ${profile.agenda.edition}${profile.agenda.runDate ? ` (file dated ${profile.agenda.runDate.slice(0, 10)})` : ""}`
                      : "No entry in the latest Unified Agenda"
                  }
                  footnote={
                    <>
                      Stages and priorities as the agency reported them to reginfo.gov. Department
                      figures include their components' entries.{" "}
                      <SourceLink href={UA_INDEX}>Unified Agenda XML</SourceLink>
                    </>
                  }
                >
                  {profile.agenda ? (
                    <AgendaPanelBody agenda={profile.agenda} agencyId={profile.id} />
                  ) : (
                    <p className="px-3 py-3 text-xs text-muted-foreground">
                      The latest Unified Agenda lists no action under this agency's name or its
                      parent's.
                    </p>
                  )}
                </Panel>
              </>
            ),
          },
          {
            id: "agency-sec-money",
            title: "Budget and spending",
            label: "Money",
            content: (
              <>
                {!budget && !spending && !profile.subtierObligations ? (
                  <p
                    id="agency-budget"
                    className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground"
                  >
                    Budget and state spending: no USAspending agency carries this agency's name, so
                    neither is recorded here.
                  </p>
                ) : null}
                {budget || profile.subtierObligations ? (
                  <Panel
                    id="agency-budget"
                    title="Budget and obligations"
                    subtitle={
                      budget
                        ? `${budget.name}, fiscal years ${budget.years[0]?.fy ?? ""}–${budget.years.at(-1)?.fy ?? ""} (USAspending)`
                        : "USAspending agency budget"
                    }
                    footnote={
                      budget ? (
                        <>
                          Budgetary resources, obligations and outlays as agencies report them under
                          the DATA Act.{" "}
                          {budget.usaspendingUrl ? (
                            <SourceLink href={budget.usaspendingUrl}>
                              USAspending agency page
                            </SourceLink>
                          ) : null}
                        </>
                      ) : undefined
                    }
                  >
                    {budget ? (
                      <BudgetPanelBody budget={budget} />
                    ) : (
                      <p className="px-3 py-3 text-xs text-muted-foreground">
                        {profile.subtierObligations
                          ? `USAspending reports this agency as a sub-agency: ${usd(profile.subtierObligations.obligations)} in FY${profile.subtierObligations.fy} award obligations. Budgetary resources and state award obligations are reported for the parent department.`
                          : NOT_RECORDED}
                      </p>
                    )}
                  </Panel>
                ) : null}

                {spending ? (
                  <Panel
                    id="agency-spending"
                    title="Award obligations by state"
                    subtitle={
                      spending
                        ? `FY${spending.fiscalYear} prime award obligations by place of performance, per resident`
                        : "State comparison"
                    }
                    footnote={
                      spending ? (
                        <>
                          Per resident = FY{spending.fiscalYear} obligations ÷{" "}
                          {spending.denominator?.measure ?? "resident population"}.{" "}
                          <SourceLink href={CENSUS}>Census population estimates</SourceLink>.
                          Obligations follow where work is performed, not where money is spent or
                          who benefits; de-obligations can make a state negative.
                        </>
                      ) : undefined
                    }
                  >
                    <SpendingPanelBody spending={spending} />
                  </Panel>
                ) : budget ? (
                  <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                    State award obligations: USAspending returned no FY2025 awards by place of
                    performance for this agency.
                  </p>
                ) : null}
              </>
            ),
          },
          {
            id: "agency-sec-law",
            title: "Law and structure",
            content: (
              <>
                <Panel
                  id="agency-cfr"
                  title="Law: CFR footprint"
                  subtitle="Chapters assigned by eCFR and parts cited by this agency's rules and proposed rules"
                  footnote={
                    profile.cfrParts?.corpusRange
                      ? `Part counts come from the saved Federal Register index (${profile.cfrParts.corpusRange[0]} to ${profile.cfrParts.corpusRange[1]}); a document that cites a part may amend, propose, correct or discuss it.`
                      : undefined
                  }
                >
                  <CfrPanelBody profile={profile} />
                </Panel>

                <Panel id="agency-structure" title="Structure and mission">
                  <StructurePanelBody profile={profile} />
                </Panel>
              </>
            ),
          },
          {
            id: "agency-sec-data",
            title: "Enforcement and program data",
            label: "Data",
            content: (
              <>
                <AgencySeriesCards
                  agencyId={profile.id}
                  label={profile.shortName ?? profile.name}
                />

                <Panel title="Enforcement and program data in this corpus">
                  <EnforcementPanelBody profile={profile} />
                </Panel>

                {after}
                <HowToRead
                  measures={[
                    {
                      term: "Final rule / proposed rule",
                      means:
                        "Federal Register document types RULE and PRORULE, counted by publication date.",
                      caveat: "Corrections and technical amendments are rules too.",
                    },
                    {
                      term: "Significant",
                      means:
                        "The rule's Unified Agenda entry was deemed significant under EO 12866 (Federal Register API filter).",
                    },
                    {
                      term: "Administration",
                      means:
                        "January 20 to January 19 windows; the first starts 1995-01-01 because the source types most 1994 documents as uncategorized.",
                      caveat: "Publication timing, not authorship.",
                    },
                    {
                      term: "Obligations",
                      means:
                        "Binding commitments to pay, as reported to USAspending; outlays are payments made.",
                    },
                    {
                      term: "Per resident",
                      means:
                        "State obligations divided by the Census Bureau's July 1 population estimate for the same year.",
                      caveat: "Territories without an estimate show Not recorded.",
                    },
                  ]}
                />
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
