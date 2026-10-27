/**
 * Agency page (FDA, NHTSA, CPSC, EPA, FTC only): the agency's slice of the mass-tort rulemaking tracker, i.e. its
 * Regulations.gov comment periods open today and closing soon, and how much of its Unified Agenda schedule is past
 * the projected month. Same read and rules as /law/rulemaking, so both pages show the same numbers.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { KpiCard, KpiGrid, Section } from "@/components/kit";
import { rulemakingTrackerQuery } from "@/components/rulemaking/rulemakingQueries";
import {
  TRACKED_AGENCIES,
  agencySummaries,
  agendaSummaries,
  editionLabel,
} from "@/lib/law/rulemakingTracker";

const REGS = { label: "Regulations.gov", url: "https://www.regulations.gov/" };
const AGENDA = { label: "Unified Agenda (reginfo.gov)", url: "https://www.reginfo.gov/public/do/eAgendaMain" };
const fmt = (v: number) => v.toLocaleString("en-US");

export function AgencyMassTortPanel({ frId }: { frId: string }) {
  const agency = TRACKED_AGENCIES.find((a) => a.fr === frId);
  const q = useQuery({ ...rulemakingTrackerQuery, enabled: !!agency });
  if (!agency || q.isError) return null;
  const d = q.data;
  const s = d ? agencySummaries(d.deadlines, [agency.code])[0] : undefined;
  const a = d ? agendaSummaries(d.agenda, [agency.code], d.today)[0] : undefined;
  const state = q.isPending ? "loading" : "ready";
  const edition = editionLabel(d?.agendaEdition ?? null);
  return (
    <Section
      id="agency-mass-tort"
      title="Comment deadlines and agenda"
      description={`${agency.code} documents open for comment on Regulations.gov, and its agenda schedule.`}
      actions={
        <Link to="/law/rulemaking" hash="mass-tort-rulemaking" className="text-meta font-medium text-primary hover:underline">
          All five agencies
        </Link>
      }
    >
      <KpiGrid columns={4} label={`${agency.code} comment deadlines`}>
        <KpiCard
          as="li"
          size="sm"
          label="Open comment periods"
          state={state}
          value={s ? fmt(s.open) : null}
          meta={s?.openEnded ? `${fmt(s.openEnded)} more with no fixed close date` : "Regulations.gov documents"}
          source={{ source: REGS, asOf: d?.today }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="Closing within 30 days"
          state={state}
          value={s ? fmt(s.within30) : null}
          meta={s?.nextClose ? `Next closes ${s.nextClose}` : undefined}
          source={{ source: REGS, asOf: d?.today }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="Proposed rules open"
          state={state}
          value={s ? fmt(s.proposedRules) : null}
          source={{ source: REGS, asOf: d?.today }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="Agenda items past projected month"
          state={state}
          value={a ? fmt(a.passed) : null}
          meta={a ? `of ${fmt(a.dated)} dated · ${edition ?? "edition not recorded"} edition` : undefined}
          source={{ source: AGENDA, period: edition ? `${edition} edition` : undefined }}
        />
      </KpiGrid>
    </Section>
  );
}
