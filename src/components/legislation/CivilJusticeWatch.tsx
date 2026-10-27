/**
 * /law/legislation lead section: state bills on litigation funding, damages limits, product liability and asbestos
 * trust claims (current and preceding sessions), and federal litigation-funding bills in the current Congress.
 * Membership is a text match on titles and summaries (model and rules: src/lib/law/legislationWatch.ts).
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/charts/ChartCard";
import { StackedBarsOverTime } from "@/components/charts/d3/charts";
import {
  AiSummary,
  AskAiButton,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import {
  EXCLUDED_STATE_BILLS,
  EXCLUSION_RULE,
  STAGE_LABEL,
  STATE_TOPICS,
  byState,
  byTopic,
  stageCounts,
  type FederalWatchBill,
  type WatchBill,
} from "@/lib/law/legislationWatch";
import { ordinal } from "@/lib/analytics/trend";
import { legislationWatchQuery } from "./legislationWatchQuery";

const OPEN_STATES = {
  label: "Open States bulk data (public domain)",
  url: "https://open.pluralpolicy.com/data/",
};
const CONGRESS = {
  label: "GovInfo Bill Status and Congress.gov",
  url: "https://www.govinfo.gov/bulkdata/BILLSTATUS",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const ID = "civil-justice-watch";
const TITLE = "Civil-justice and litigation-funding watch";
const STAGES = ["enacted", "no_final_action", "not_passed", "vetoed"] as const;
const TOPIC_LABEL = Object.fromEntries(STATE_TOPICS.map((t) => [t.id, t.label]));

export function CivilJusticeWatch() {
  const q = useQuery(legislationWatchQuery);
  const d = q.data;
  const state = q.isPending ? "loading" : q.isError ? "error" : "ready";
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({
          kind: "error",
          message: "This chart could not be loaded.",
          onRetry: () => void q.refetch(),
        } as const)
      : ({ kind: "ready" } as const);
  const bills = d?.stateBills ?? [];
  const counts = stageCounts(bills);
  const current = bills.filter((b) => b.current);
  const enactedStates = new Set(bills.filter((b) => b.stage === "enacted").map((b) => b.state));
  const topics = byTopic(bills);
  const funding = topics.find((t) => t.topic.id === "funding");
  const states = byState(bills);
  const federalPending = (d?.federal ?? []).filter((b) => !b.becameLaw);
  const congress = d ? `${ordinal(d.congress)} Congress` : "current Congress";

  const context = d
    ? buildSectionContext({
        id: ID,
        title: TITLE,
        scope:
          "State legislatures (current and preceding regular sessions) and the current Congress; bills whose title or summary mentions the topic",
        period: `State bills refreshed ${d.dataAsOf.stateBills ?? "on a date not recorded"}, federal bills ${d.dataAsOf.congressBills ?? "on a date not recorded"}; current sessions in progress`,
        source: `${OPEN_STATES.label}; ${CONGRESS.label}`,
        figures: [
          { label: "Matching state bills", value: bills.length, unit: "bills" },
          { label: "Enacted", value: counts.enacted, unit: "bills" },
          {
            label: "Current-session bills with no final action recorded",
            value: counts.no_final_action,
            unit: "bills",
          },
          { label: "States with an enactment", value: enactedStates.size, unit: "states" },
          ...topics.map((t) => ({
            label: `${t.topic.label}: bills (enacted)`,
            value: `${fmt(t.total)} (${fmt(t.counts.enacted)})`,
          })),
          ...states
            .slice(0, 5)
            .map((s) => ({ label: `${s.state}: matching bills`, value: s.total })),
          {
            label: `Federal litigation-funding bills, ${congress}`,
            value: d.federal.length,
            unit: "bills",
          },
          ...d.federal
            .slice(0, 3)
            .map((f) => ({ label: `${f.citation} cosponsors`, value: f.cosponsors })),
        ],
        maxFigures: 20,
      })
    : null;

  return (
    <Section
      id={ID}
      title={TITLE}
      description="State and federal bills on litigation funding, damages limits, product liability and asbestos trust claims."
      actions={
        <AskAiButton
          sectionId={ID}
          title={TITLE}
          context={context}
          questions={[
            "Which states enacted litigation-funding laws, and what do they require?",
            "Where are damages-limit bills moving this session?",
            "Which federal litigation-funding bills have the most support?",
          ]}
        />
      }
    >
      <KpiGrid columns={5} label="Civil-justice watch figures">
        <KpiCard
          as="li"
          label="Bills in current sessions"
          state={state}
          value={d ? fmt(current.length) : null}
          meta={d ? `${fmt(counts.no_final_action)} with no final action recorded` : undefined}
          partial="Sessions in progress"
          source={{ source: OPEN_STATES, asOf: d?.dataAsOf.stateBills ?? undefined }}
        />
        <KpiCard
          as="li"
          label="Enacted"
          state={state}
          value={d ? fmt(counts.enacted) : null}
          meta="Current and preceding sessions"
          source={{ source: OPEN_STATES, asOf: d?.dataAsOf.stateBills ?? undefined }}
        />
        <KpiCard
          as="li"
          label="States with an enactment"
          state={state}
          value={d ? fmt(enactedStates.size) : null}
          meta={d ? [...enactedStates].sort().join(", ") : undefined}
          source={{ source: OPEN_STATES, asOf: d?.dataAsOf.stateBills ?? undefined }}
        />
        <KpiCard
          as="li"
          label="Litigation-funding laws enacted"
          state={state}
          value={funding ? fmt(funding.counts.enacted) : null}
          meta={funding ? `of ${fmt(funding.total)} funding bills` : undefined}
          source={{ source: OPEN_STATES, asOf: d?.dataAsOf.stateBills ?? undefined }}
        />
        <KpiCard
          as="li"
          label="Federal funding bills pending"
          state={state}
          value={d ? fmt(federalPending.length) : null}
          meta={congress}
          source={{ source: CONGRESS, asOf: d?.dataAsOf.congressBills ?? undefined }}
        />
      </KpiGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={
            funding && d
              ? `${fmt(funding.total)} bills mention litigation funding; ${fmt(funding.counts.enacted)} became law`
              : "Bills by topic and outcome"
          }
          subtitle="State bills whose title or summary mentions the topic, by outcome · a bill can mention several topics"
          status={status}
          sources={[OPEN_STATES]}
          asOf={d?.dataAsOf.stateBills ?? undefined}
          about={<WatchAbout />}
          table={{
            caption: "State bills by topic and outcome",
            columns: [
              { label: "Topic" },
              ...STAGES.map((s) => ({ label: STAGE_LABEL[s] })),
              { label: "Total" },
            ],
            rows: topics.map((t) => ({
              key: t.topic.id,
              cells: [t.topic.label, ...STAGES.map((s) => t.counts[s]), t.total],
            })),
          }}
          actions={d ? <StateBillsDrawer bills={bills} asOf={d.dataAsOf.stateBills} /> : undefined}
        >
          {d ? (
            <StackedBarsOverTime
              rows={topics.map((t) => ({ period: t.topic.label, values: { ...t.counts } }))}
              keys={STAGES}
              labels={STAGE_LABEL}
              format={fmt}
              height={230}
            />
          ) : null}
        </ChartCard>
        <ChartCard
          variant="editorial"
          title={
            states[0]
              ? `${states[0].state} has the most matching bills (${fmt(states[0].total)})`
              : "Bills by state"
          }
          subtitle="Matching state bills by state and outcome, the 15 states with the most"
          status={status}
          sources={[OPEN_STATES]}
          asOf={d?.dataAsOf.stateBills ?? undefined}
          about={<WatchAbout />}
          table={{
            caption: "Matching state bills by state",
            columns: [
              { label: "State" },
              ...STAGES.map((s) => ({ label: STAGE_LABEL[s] })),
              { label: "Total" },
            ],
            rows: states.map((s) => ({
              key: s.state,
              cells: [s.state, ...STAGES.map((k) => s.counts[k]), s.total],
            })),
          }}
        >
          {d ? (
            <StackedBarsOverTime
              rows={states.slice(0, 15).map((s) => ({ period: s.state, values: { ...s.counts } }))}
              keys={STAGES}
              labels={STAGE_LABEL}
              format={fmt}
              height={230}
            />
          ) : null}
        </ChartCard>
      </div>
      {d && d.federal.length ? (
        <FederalBills bills={d.federal} congress={congress} asOf={d.dataAsOf.congressBills} />
      ) : null}
      <AiSummary context={context} className="mt-4" />
    </Section>
  );
}

function WatchAbout() {
  return (
    <ul className="list-disc space-y-1 pl-4">
      <li>
        A bill is listed when its title or summary mentions a watched phrase (for example
        “litigation financing” or “noneconomic damages”). That is a text match, not a legal
        classification; read the bill before relying on it.
      </li>
      <li>
        {EXCLUSION_RULE} {Object.keys(EXCLUDED_STATE_BILLS).length} bills are left out under this
        rule.
      </li>
      <li>
        A bill carried over between sessions under the same number, first action and title counts
        once. “No final action recorded” means no signature, enactment or veto is recorded for a
        current-session bill; the session may already have adjourned. “Not passed” bills died with
        the preceding session.
      </li>
    </ul>
  );
}

function StateBillsDrawer({ bills, asOf }: { bills: WatchBill[]; asOf: string | null }) {
  return (
    <DataDrawer
      title="Matching state bills"
      description="Latest action first; actions dated after today are shown as scheduled."
      triggerLabel={`View data (${fmt(bills.length)})`}
      filename="civil-justice-state-bills"
      rows={bills}
      rowKey={(b) => b.id}
      searchable
      searchLabel="Filter by state, bill or title"
      source={{ source: OPEN_STATES, asOf: asOf ?? undefined }}
      columns={[
        { key: "state", label: "State", value: (b) => b.state },
        {
          key: "bill",
          label: "Bill",
          value: (b) => b.identifier,
          render: (b) => (
            <Link
              to="/law/legislation/state/$id"
              params={{ id: b.id }}
              className="text-primary hover:underline"
            >
              {b.identifier}
            </Link>
          ),
        },
        { key: "title", label: "Title", value: (b) => b.title },
        {
          key: "topics",
          label: "Mentions",
          value: (b) => b.topics.map((t) => TOPIC_LABEL[t] ?? t).join(", "),
        },
        { key: "stage", label: "Outcome", value: (b) => STAGE_LABEL[b.stage] },
        { key: "session", label: "Session", value: (b) => b.session },
        {
          key: "latest",
          label: "Latest action",
          value: (b) =>
            b.latestActionDate ? `${b.latestActionDate}${b.scheduled ? " (scheduled)" : ""}` : null,
        },
      ]}
    />
  );
}

function FederalBills({
  bills,
  congress,
  asOf,
}: {
  bills: FederalWatchBill[];
  congress: string;
  asOf: string | null;
}) {
  const top = bills.slice(0, 5);
  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-label font-semibold text-foreground">
          Federal litigation-funding bills, {congress} ({fmt(bills.length)})
        </h3>
        <DataDrawer
          title={`Federal litigation-funding bills, ${congress}`}
          description="Bills whose title or summary mentions litigation funding, most cosponsors first."
          triggerLabel="View data"
          filename="federal-litigation-funding-bills"
          rows={bills}
          rowKey={(b) => b.id}
          source={{ source: CONGRESS, asOf: asOf ?? undefined }}
          columns={[
            { key: "bill", label: "Bill", value: (b) => b.citation },
            { key: "title", label: "Title", value: (b) => b.title },
            { key: "sponsor", label: "Sponsor", value: (b) => b.sponsor },
            { key: "co", label: "Cosponsors", align: "right", value: (b) => b.cosponsors },
            { key: "status", label: "Status", value: (b) => b.status },
            { key: "latest", label: "Latest action", value: (b) => b.latestActionDate },
          ]}
        />
      </div>
      <ul className="m-0 list-none divide-y divide-border/70 p-0 text-body">
        {top.map((b) => {
          const [c, type, number] = b.id.split("-");
          return (
            <li
              key={b.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
            >
              <span className="min-w-0">
                {c && type && number ? (
                  <Link
                    to="/law/legislation/federal/$congress/$type/$number"
                    params={{ congress: c, type, number }}
                    className="font-medium text-primary hover:underline"
                  >
                    {b.citation}
                  </Link>
                ) : (
                  b.citation
                )}{" "}
                <span className="text-foreground">{b.title}</span>
                <span className="block text-meta text-muted-foreground">
                  {b.bioguide && b.sponsor ? (
                    <Link
                      to="/law/legislation/members/$bioguide"
                      params={{ bioguide: b.bioguide }}
                      className="hover:underline"
                    >
                      {b.sponsor}
                    </Link>
                  ) : (
                    (b.sponsor ?? "Sponsor not recorded")
                  )}
                  {" · "}
                  {b.status ?? "Status not recorded"}
                  {b.latestActionDate ? ` · ${b.latestActionDate}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                {b.cosponsors == null
                  ? "Cosponsors not recorded"
                  : `${fmt(b.cosponsors)} cosponsors`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
