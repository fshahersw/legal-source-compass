/**
 * "Legislative change watch" on /limitations: current-session state bills whose title, summary or subject mentions
 * a statute of limitations, a statute of repose or limitation of actions. A review queue only: it never changes a
 * Time Limits rule (rules ship only through the staged release scripts).
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { ChartCard as TrendCard, TrendColumns, periodTable } from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  BarList,
  ChartCard,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
  type DataColumn,
} from "@/components/kit";
import { STATES } from "@/lib/corpus/geo";
import {
  OUTCOME_LABEL,
  WATCH_PHRASES,
  summarizeWatch,
  type WatchBill,
} from "@/lib/limitations/legislativeWatch";
import { legislativeWatchQuery } from "./legislativeWatchQueries";

// The dataset's own page in the site describes the Open States bulk dump it was loaded from.
const SOURCE = {
  label: "Open States bulk data (public domain), state_bills",
  href: "/law/legislation",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const stateName = (usps: string) => STATES.find((s) => s.usps === usps)?.name ?? usps;
const SECTION_ID = "legislative-watch";
type StateRow = { state: string; total: number; enacted: number };

const columns: DataColumn<WatchBill>[] = [
  { key: "state", label: "State", value: (b) => b.state },
  {
    key: "bill",
    label: "Bill",
    value: (b) => b.identifier,
    render: (b) => (
      <Link
        to="/law/legislation/state/$id"
        params={{ id: b.id }}
        className="text-primary underline"
      >
        {b.identifier}
      </Link>
    ),
  },
  { key: "title", label: "Title as printed", value: (b) => b.title },
  { key: "outcome", label: "Outcome", value: (b) => OUTCOME_LABEL[b.outcome] },
  { key: "status", label: "Status", value: (b) => b.statusLabel },
  { key: "latest", label: "Latest action", value: (b) => b.latestAction },
  { key: "date", label: "Latest action date", value: (b) => b.latestActionDate },
  { key: "release", label: "Time Limits review", value: () => "Not recorded" },
  {
    key: "source",
    label: "Official page",
    value: (b) => b.sourceUrl,
    render: (b) =>
      b.sourceUrl ? (
        <a href={b.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">
          Legislature
        </a>
      ) : (
        "Not recorded"
      ),
  },
];

export function LegislativeWatchSection() {
  const q = useQuery(legislativeWatchQuery);
  const data = q.data;
  const s = data ? summarizeWatch(data.bills, data.dumpDate) : null;
  const state = q.isPending
    ? "loading"
    : q.isError
      ? "error"
      : s && s.bills > 0
        ? "ready"
        : "empty";
  const asOf = data?.dumpDate ?? undefined;
  const truncated = !!data && data.returned >= data.limit;
  const period = "Current legislative sessions";
  const kpiSource = { source: { label: SOURCE.label, href: SOURCE.href }, period, asOf };
  const top = s?.byState[0];
  const enactedRecent = data
    ? data.bills
        .filter((b) => b.outcome === "enacted")
        .sort((a, b) => (b.latestActionDate ?? "").localeCompare(a.latestActionDate ?? ""))
        .slice(0, 6)
    : [];
  const context = s
    ? buildSectionContext({
        title: "Time limits legislative change watch",
        scope: "Current-session state bills mentioning limitation or repose periods (text match)",
        period,
        source: SOURCE.label,
        figures: [
          { label: "Bills matched", value: s.bills },
          { label: "States with a matched bill", value: s.states },
          { label: "Bills enacted", value: s.enacted },
          { label: "States with an enacted bill", value: s.enactedStates },
          ...s.byState.slice(0, 8).map((x) => ({
            label: `Matched bills in ${stateName(x.state)}`,
            value: x.total,
            note: `${x.enacted} enacted`,
          })),
        ],
      })
    : null;
  return (
    <Section
      id={SECTION_ID}
      title="Legislative change watch"
      description="State bills this session that mention limitation or repose periods. A review queue; it does not change any rule."
      actions={<AskAiButton sectionId={SECTION_ID} context={context} />}
    >
      <KpiGrid columns={4} label="Legislative change watch figures">
        <KpiCard
          as="li"
          label="Bills matched"
          value={s ? fmt(s.bills) : null}
          meta={
            truncated ? "First 500 shown; more may match" : "Title, summary or subject mentions"
          }
          partial="Sessions are in progress; counts grow as bills move."
          state={state === "error" ? "error" : state === "loading" ? "loading" : "ready"}
          onRetry={() => void q.refetch()}
          source={kpiSource}
        />
        <KpiCard
          as="li"
          label="States"
          value={s ? fmt(s.states) : null}
          meta="With at least one matched bill"
          state={state === "error" ? "error" : state === "loading" ? "loading" : "ready"}
          source={kpiSource}
        />
        <KpiCard
          as="li"
          label="Enacted"
          value={s ? fmt(s.enacted) : null}
          meta="Signed or became law, as Open States records"
          state={state === "error" ? "error" : state === "loading" ? "loading" : "ready"}
          source={kpiSource}
        />
        <KpiCard
          as="li"
          label="States with an enactment"
          value={s ? fmt(s.enactedStates) : null}
          meta="Each needs review against the active release"
          state={state === "error" ? "error" : state === "loading" ? "loading" : "ready"}
          source={kpiSource}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={
            top
              ? `${stateName(top.state)} has the most matched bills (${fmt(top.total)})`
              : "Matched bills by state"
          }
          subtitle="Matched bills per state, with how many were enacted · current sessions"
          state={state}
          onRetry={() => void q.refetch()}
          data={
            s
              ? {
                  title: "Matched bills by state",
                  columns: [
                    { key: "state", label: "State", value: (r: StateRow) => stateName(r.state) },
                    {
                      key: "total",
                      label: "Matched bills",
                      align: "right",
                      value: (r: StateRow) => r.total,
                    },
                    {
                      key: "enacted",
                      label: "Enacted",
                      align: "right",
                      value: (r: StateRow) => r.enacted,
                    },
                  ],
                  rows: s.byState,
                  rowKey: (r: StateRow) => r.state,
                  source: kpiSource,
                }
              : undefined
          }
          source={{
            ...kpiSource,
            about: (
              <>
                <p>
                  Phrase search of each bill&apos;s title, summary and subjects for:{" "}
                  {WATCH_PHRASES.join("; ")}. A match is a prompt to review, not a finding that the
                  bill changes a period.
                </p>
                <p className="mt-2">
                  Some matches are about criminal limitation periods or unrelated subjects. Nothing
                  here alters or infers a Time Limits rule; rules change only through a staged,
                  activated release.
                </p>
              </>
            ),
          }}
        >
          {s && (
            <BarList
              ariaLabel="Matched bills by state"
              items={s.byState.slice(0, 12).map((x) => ({
                id: x.state,
                label: stateName(x.state),
                value: x.total,
                display: fmt(x.total),
                note: x.enacted ? `${x.enacted} enacted` : "none enacted",
              }))}
            />
          )}
        </ChartCard>
        <TrendCard
          variant="editorial"
          title={
            s && s.enacted
              ? `${fmt(s.enacted)} matched bills were enacted this session`
              : "Matched bills by month of latest action"
          }
          subtitle="Matched bills by month of their latest recorded action · not the effective date"
          status={
            state === "loading"
              ? { kind: "loading" }
              : state === "error"
                ? { kind: "error", onRetry: () => void q.refetch() }
                : !s || s.byMonth.length < 2
                  ? { kind: "empty", reason: "Not recorded for this period." }
                  : { kind: "ready" }
          }
          sources={[{ label: SOURCE.label, url: SOURCE.href }]}
          period={period}
          {...(asOf ? { asOf } : {})}
          about={
            <p>
              The month is the bill&apos;s latest recorded action, as Open States prints it.
              Effective dates are in each bill&apos;s actions on the legislature&apos;s page.
            </p>
          }
          table={
            s
              ? periodTable(
                  s.byMonth,
                  "month",
                  [
                    { key: "enacted", label: "Enacted" },
                    { key: "other", label: "No final outcome or vetoed" },
                  ],
                  fmt,
                  {
                    caption: "Matched bills by month of latest action",
                    xLabel: "Month",
                    partialKey: "partial",
                    total: true,
                  },
                )
              : undefined
          }
        >
          {s && (
            <TrendColumns
              rows={s.byMonth}
              xKey="month"
              stacked
              series={[
                { key: "enacted", label: "Enacted" },
                { key: "other", label: "No final outcome or vetoed" },
              ]}
              format={fmt}
              partialKey="partial"
              ariaLabel="Matched bills by month of latest action"
            />
          )}
        </TrendCard>
      </div>
      {enactedRecent.length > 0 && (
        <div className="mt-4 rounded-md border border-border p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Recently enacted, to review</h3>
            {data && (
              <DataDrawer
                title="Matched state bills, current sessions"
                description="Text matches for review. Time Limits review status is not recorded for any bill yet."
                columns={columns}
                rows={data.bills}
                rowKey={(b) => b.id}
                source={kpiSource}
                triggerLabel={`View all ${fmt(data.bills.length)}`}
                searchable
                searchLabel="Search bills"
              />
            )}
          </div>
          <ul className="mt-2 divide-y divide-border text-sm">
            {enactedRecent.map((b) => (
              <li key={b.id} className="py-2">
                <p className="font-medium">
                  {stateName(b.state)} ·{" "}
                  <Link
                    to="/law/legislation/state/$id"
                    params={{ id: b.id }}
                    className="text-primary underline"
                  >
                    {b.identifier}
                  </Link>{" "}
                  <span className="font-normal text-muted-foreground">
                    · {b.statusLabel} · {b.latestActionDate ?? "Date not recorded"}
                  </span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{b.title}</p>
                {b.sourceUrl ? (
                  <a
                    href={b.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-primary underline"
                  >
                    Legislature page <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">Official page: Not recorded</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
