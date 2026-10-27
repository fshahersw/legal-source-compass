import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";
import { ChartCard as TrendCard, TrendColumns, periodTable } from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  BarList,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ChartCard,
  DataDrawer,
  EmptyState,
  KpiCard,
  KpiGrid,
  Section,
  SourceFooter,
  StatusPill,
  buildSectionContext,
  type DataColumn,
} from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { OfficialSettlement } from "@/lib/external/enforcementActions.functions";
import { LoadingBlock, StateNote } from "../parts";
import { CourtList } from "./bits";
import { officialSettlementsQuery } from "./actionsView";
import { fmtInt, fmtUsd, hostOf } from "./format";
import {
  DEADLINE_LABEL,
  deadlinesByMonth,
  largestOpenFunds,
  roleLabel,
  roleMix,
  summarize,
  viewRows,
  type SettlementView,
  type Summary,
} from "./officialSettlementsModel";

const SOURCE_LABEL = "Official settlement pages (administrators, courts, agencies)";
const DATASET_HREF = "/data/settlement_claims_official";
const CHART_SOURCE = { label: SOURCE_LABEL, url: DATASET_HREF };

export function OfficialSettlements() {
  const q = useQuery(officialSettlementsQuery);
  if (q.isLoading) return <LoadingBlock label="Loading confirmed settlements" />;
  if (q.isError)
    return (
      <StateNote
        tone="error"
        action={
          <button type="button" onClick={() => void q.refetch()} className="underline">
            Retry
          </button>
        }
      >
        Confirmed settlements could not be loaded.
      </StateNote>
    );
  if (!q.data?.length)
    return <StateNote>No settlement has been confirmed on an official page yet.</StateNote>;
  return <Body rows={q.data} />;
}

function pagesRead(rows: readonly OfficialSettlement[]): string | null {
  const dates = rows.map((r) => r.retrievedAt?.slice(0, 10)).filter((d): d is string => !!d).sort();
  return dates.length ? dates[dates.length - 1]! : null;
}

const About = () => (
  <>
    <p>
      Every fact was read on the official settlement page it links to (administrator, court or
      agency). Dates, amounts and eligibility change: confirm on the page before relying on them.
    </p>
    <p className="mt-2">
      Each dollar figure is typed from its own sentence: settlement fund total, per claimant,
      aggregate cap or other (fees, awards, penalties, agency orders and distribution rounds,
      estimates). The
      headline is the largest fund total; a per-claimant figure is never shown as the settlement
      amount, and figures are never summed.
    </p>
    <p className="mt-2">
      An MDL is named only when a case number on the page is that MDL&apos;s own master docket in
      the MDL registry (for example 2:19-ml-02905 is MDL 2905). Deadline status is computed against
      today.
    </p>
  </>
);

function Body({ rows: raw }: { rows: OfficialSettlement[] }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const rows = useMemo(() => viewRows(raw, today), [raw, today]);
  const s = useMemo(() => summarize(rows), [rows]);
  const read = pagesRead(raw);
  const open = rows.filter((r) => r.state === "within_30_days" || r.state === "upcoming");
  const footer = {
    source: { label: SOURCE_LABEL, href: DATASET_HREF },
    asOf: read ? `pages read by ${read}` : undefined,
    about: <About />,
  };
  const context = buildSectionContext({
    title: "Settlement claim deadlines and amounts",
    scope: "Settlements confirmed on official pages",
    period: `deadline status as of ${today}`,
    source: SOURCE_LABEL,
    figures: [
      { label: "Settlements confirmed on official pages", value: s.total },
      { label: "Claim deadlines still open", value: s.open },
      { label: "Claim deadlines closing within 30 days", value: s.within30 },
      { label: "Claim deadlines already past", value: s.past },
      { label: "Settlements with a settlement fund total on the page", value: s.withFund },
      { label: "Settlements with only per-claimant figures", value: s.perClaimantOnly },
      { label: "Settlements linked to an MDL by case number", value: s.withMdl },
      ...open.slice(0, 8).map((r) => ({
        label: `Deadline: ${r.name}`,
        value: `${r.deadline}${r.fund ? `; fund total ${r.fund.asWritten}` : ""}`,
      })),
    ],
  });
  return (
    <div className="stack-section space-y-8">
      <Section
        id="settlement-deadlines"
        title="Claim deadlines"
        description="Open deadlines first, each read on the settlement's official page."
        actions={
          <AskAiButton
            sectionId="settlement-deadlines"
            context={context}
            questions={[
              "Which claim deadlines close in the next 30 days?",
              "Which open settlements state a fund total, and which only a per-claimant amount?",
            ]}
          />
        }
      >
        <Kpis s={s} today={today} footer={footer} />
        <AiSummary context={context} className="mt-3" />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <NextDeadlines rows={open} today={today} footer={footer} />
          <DeadlineMonths rows={rows} today={today} read={read} />
        </div>
      </Section>
      <Section
        id="settlement-amounts"
        title="Settlement amounts"
        description="Fund totals and per-claimant figures, typed from their own sentence."
        actions={<AllSettlements rows={rows} today={today} footer={footer} />}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <LargestFunds rows={rows} typed={s.typed} footer={footer} />
          <RoleMix rows={rows} typed={s.typed} footer={footer} />
        </div>
      </Section>
    </div>
  );
}

function Kpis({ s, today, footer }: { s: Summary; today: string; footer: Parameters<typeof SourceFooter>[0] }) {
  const notTyped = "Amounts not typed yet";
  return (
    <KpiGrid columns={3} label="Confirmed settlement figures">
      <KpiCard
        as="li"
        label="Claim deadlines still open"
        value={fmtInt(s.open)}
        meta={`Confirmed date on or after ${today}`}
        source={footer}
      />
      <KpiCard
        as="li"
        label="Closing within 30 days"
        value={fmtInt(s.within30)}
        meta={`of ${fmtInt(s.open)} open deadlines`}
      />
      <KpiCard
        as="li"
        label="Deadlines already past"
        value={fmtInt(s.past)}
        meta={`${fmtInt(s.noDeadline)} with no deadline confirmed · ${fmtInt(s.total)} settlements`}
      />
      <KpiCard
        as="li"
        label="Settlement fund total stated"
        value={s.withFund == null ? null : fmtInt(s.withFund)}
        meta={s.withFund == null ? notTyped : `of ${fmtInt(s.total)} confirmed settlements`}
      />
      <KpiCard
        as="li"
        label="Only per-claimant figures"
        value={s.perClaimantOnly == null ? null : fmtInt(s.perClaimantOnly)}
        meta={s.perClaimantOnly == null ? notTyped : "No fund total on the page; never shown as one"}
      />
      <KpiCard
        as="li"
        label="Linked to an MDL"
        value={fmtInt(s.withMdl)}
        meta="Case number on the page is the MDL's master docket"
      />
    </KpiGrid>
  );
}

function stateTone(r: SettlementView) {
  return r.state === "within_30_days" ? "warning" : r.state === "past" ? "neutral" : "info";
}

function daysText(r: SettlementView): string {
  if (r.daysLeft == null) return DEADLINE_LABEL.none;
  if (r.daysLeft < 0) return "Past";
  if (r.daysLeft === 0) return "Closes today";
  return `${fmtInt(r.daysLeft)} day${r.daysLeft === 1 ? "" : "s"} left`;
}

function AmountLine({ r }: { r: SettlementView }) {
  if (r.fund)
    return (
      <span title={r.fund.sentence ?? undefined}>
        Fund total <span className="font-medium text-foreground tabular-nums">{r.fund.asWritten}</span>
      </span>
    );
  if (r.perClaimant.length)
    return (
      <span title={r.perClaimant[0]!.sentence ?? undefined}>
        Per claimant{" "}
        <span className="font-medium text-foreground tabular-nums">
          {r.perClaimant
            .slice(0, 2)
            .map((a) => a.asWritten)
            .join(" / ")}
        </span>
        <span className="text-muted-foreground"> · fund total not recorded</span>
      </span>
    );
  const untyped = r.amounts.filter((a) => a.role == null);
  if (untyped.length)
    return (
      <span title={untyped[0]!.sentence ?? undefined}>
        <span className="font-medium text-foreground tabular-nums">
          {untyped
            .slice(0, 2)
            .map((a) => a.asWritten)
            .join(" / ")}
        </span>
        <span className="text-muted-foreground"> · role not typed yet</span>
      </span>
    );
  return <span>Fund total not recorded</span>;
}

function ClaimLink({ r }: { r: SettlementView }) {
  if (!r.claimUrl) return null;
  return (
    <a
      href={r.claimUrl}
      target="_blank"
      rel="noreferrer"
      title="Claim form linked from the official page"
      className="text-primary hover:underline"
    >
      Claim form
    </a>
  );
}

function MdlChips({ r }: { r: SettlementView }) {
  if (!r.mdls.length) return null;
  return (
    <>
      {r.mdls.map((m) => (
        <Link
          key={m.mdl}
          to="/matters/lens/$mdl"
          params={{ mdl: String(m.mdl) }}
          title={`Case number ${m.caseNumber} on the official page`}
          className="rounded border border-border px-1 py-px text-meta text-foreground hover:bg-muted"
        >
          MDL {m.mdl}
        </Link>
      ))}
    </>
  );
}

function NextDeadlines({
  rows,
  today,
  footer,
}: {
  rows: SettlementView[];
  today: string;
  footer: Parameters<typeof SourceFooter>[0];
}) {
  const shown = rows.slice(0, 8);
  return (
    <Card as="section" className="flex flex-col">
      <CardHeader
        title={
          rows.length
            ? `${fmtInt(rows.length)} claim deadline${rows.length === 1 ? "" : "s"} still open; the next closes ${rows[0]!.deadline}`
            : "No confirmed claim deadline is still open"
        }
        description={`Soonest first, as of ${today}`}
        icon={<CalendarClock className="size-4" aria-hidden />}
      />
      <CardBody className="flex-1">
        {shown.length ? (
          <ul className="m-0 list-none divide-y divide-border p-0">
            {shown.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <a
                    href={r.officialUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-body font-medium text-foreground hover:underline"
                  >
                    {r.name}
                  </a>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
                    <AmountLine r={r} />
                    <MdlChips r={r} />
                    <ClaimLink r={r} />
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block font-mono text-meta text-foreground" title={r.deadlineSentence ?? undefined}>
                    {r.deadline}
                  </span>
                  <StatusPill tone={stateTone(r)}>{daysText(r)}</StatusPill>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title="No open deadline" description="Every confirmed deadline is past." />
        )}
      </CardBody>
      <CardFooter>
        <SourceFooter {...footer} />
      </CardFooter>
    </Card>
  );
}

function DeadlineMonths({ rows, today, read }: { rows: SettlementView[]; today: string; read: string | null }) {
  const months = deadlinesByMonth(rows, today, 6);
  const total = months.reduce((a, m) => a + m.count, 0);
  const busiest = [...months].sort((a, b) => b.count - a.count)[0];
  const title =
    total && busiest
      ? `${busiest.label} has the most open claim deadlines (${fmtInt(busiest.count)})`
      : "Open claim deadlines by month";
  const chartRows = months.map((m) => ({ month: m.label, count: m.count, partial: m.partial }));
  return (
    <TrendCard
      title={title}
      subtitle={`Confirmed claim deadlines per month · settlements · next 6 months from ${today}`}
      status={total ? { kind: "ready" } : { kind: "empty", reason: "No open deadline falls in the next 6 months." }}
      sources={[CHART_SOURCE]}
      {...(read ? { asOf: read } : {})}
      partial="The current month includes days already past; only deadlines on or after today are counted."
      about={<p>Counts settlements whose official page confirms a claim deadline in that month. A month with none shows 0 confirmed deadlines; settlements without a confirmed deadline are not counted.</p>}
      table={periodTable(chartRows, "month", [{ key: "count", label: "Open claim deadlines" }], fmtInt, {
        caption: "Open claim deadlines by month",
        xLabel: "Month",
        partialKey: "partial",
      })}
    >
      <TrendColumns
        rows={chartRows}
        xKey="month"
        series={[{ key: "count", label: "Open claim deadlines" }]}
        format={fmtInt}
        partialKey="partial"
        ariaLabel="Open claim deadlines by month"
      />
    </TrendCard>
  );
}

function LargestFunds({
  rows,
  typed,
  footer,
}: {
  rows: SettlementView[];
  typed: boolean;
  footer: Parameters<typeof SourceFooter>[0];
}) {
  const top = largestOpenFunds(rows, 8);
  const first = top[0];
  return (
    <ChartCard
      title={
        first?.fund
          ? `${first.name} states the largest fund still open for claims, ${first.fund.asWritten}`
          : "Largest settlement funds still open for claims"
      }
      subtitle="Settlement fund total as stated on the official page · US dollars · each settlement on its own, never summed"
      state={!typed ? "empty" : top.length ? "ready" : "empty"}
      emptyText={!typed ? "Amounts are not typed yet." : "No open settlement states a fund total."}
      source={footer}
      data={{
        title: "Open settlements with a fund total",
        rows: top,
        rowKey: (r) => r.id,
        columns: [
          { key: "name", label: "Settlement", value: (r) => r.name },
          { key: "fund", label: "Fund total (as written)", value: (r) => r.fund?.asWritten ?? null },
          { key: "usd", label: "Fund total (USD)", align: "right", value: (r) => r.fund?.valueUsd ?? null },
          { key: "deadline", label: "Claim deadline", value: (r) => r.deadline },
        ],
      }}
    >
      <BarList
        ariaLabel="Largest settlement funds still open for claims"
        items={top.map((r) => ({
          id: r.id,
          label: r.name,
          value: r.fund?.valueUsd ?? null,
          display: r.fund ? fmtUsd(r.fund.valueUsd) : "Not recorded",
          note: `closes ${r.deadline}`,
        }))}
      />
    </ChartCard>
  );
}

function RoleMix({
  rows,
  typed,
  footer,
}: {
  rows: SettlementView[];
  typed: boolean;
  footer: Parameters<typeof SourceFooter>[0];
}) {
  const mix = roleMix(rows);
  const total = mix.reduce((a, m) => a + m.count, 0);
  const top = mix[0];
  return (
    <ChartCard
      title={
        typed && top && total
          ? `${top.label} is the most common confirmed figure: ${fmtInt(top.count)} of ${fmtInt(total)}`
          : "What the confirmed dollar figures are"
      }
      subtitle="Dollar figures confirmed on official pages, by role in their own sentence · count of figures"
      state={!typed ? "empty" : total ? "ready" : "empty"}
      emptyText={!typed ? "Amounts are not typed yet." : "No dollar figure is confirmed."}
      source={footer}
      data={{
        title: "Confirmed dollar figures by role",
        rows: mix,
        rowKey: (m) => m.id,
        columns: [
          { key: "role", label: "Role", value: (m) => m.label },
          { key: "count", label: "Figures", align: "right", value: (m) => m.count },
        ],
      }}
    >
      <BarList
        ariaLabel="Confirmed dollar figures by role"
        items={mix.map((m) => ({ id: m.id, label: m.label, value: m.count, display: fmtInt(m.count) }))}
      />
    </ChartCard>
  );
}

function AllSettlements({
  rows,
  today,
  footer,
}: {
  rows: SettlementView[];
  today: string;
  footer: Parameters<typeof SourceFooter>[0];
}) {
  const columns: DataColumn<SettlementView>[] = [
    {
      key: "name",
      label: "Settlement",
      value: (r) => r.name,
      render: (r) => (
        <a href={r.officialUrl} target="_blank" rel="noreferrer" className="hover:underline">
          {r.name}
        </a>
      ),
    },
    { key: "deadline", label: "Claim deadline", value: (r) => r.deadline },
    { key: "status", label: `Status (as of ${today})`, value: (r) => DEADLINE_LABEL[r.state] },
    { key: "fund", label: "Settlement fund total", value: (r) => r.fund?.asWritten ?? null },
    {
      key: "per",
      label: "Per claimant",
      value: (r) => r.perClaimant.map((a) => a.asWritten).join("; ") || null,
    },
    {
      key: "other",
      label: "Other figures",
      value: (r) =>
        r.amounts
          .filter((a) => a.role !== "fund_total" && a.role !== "per_claimant")
          .map((a) => `${a.asWritten} (${roleLabel(a)})`)
          .join("; ") || null,
    },
    {
      key: "mdl",
      label: "MDL",
      value: (r) => r.mdls.map((m) => `MDL ${m.mdl}`).join("; ") || null,
      render: (r): ReactNode => (r.mdls.length ? <MdlChips r={r} /> : <span className="text-muted-foreground">Not recorded</span>),
    },
    {
      key: "court",
      label: "Court",
      value: (r) => r.courts.map((c) => c.asWritten).join("; ") || null,
      render: (r): ReactNode =>
        r.courts.length ? <CourtList courts={r.courts.slice(0, 2)} /> : <span className="text-muted-foreground">Not recorded</span>,
    },
    { key: "case", label: "Case no.", value: (r) => r.caseNumbers.slice(0, 2).join("; ") || null },
    { key: "site", label: "Official page", value: (r) => r.officialHost ?? hostOf(r.officialUrl) },
    {
      key: "claim",
      label: "Claim form",
      value: (r) => r.claimUrl,
      render: (r): ReactNode =>
        r.claimUrl ? <ClaimLink r={r} /> : <span className="text-muted-foreground">Not recorded</span>,
    },
  ];
  return (
    <DataDrawer
      title="Settlements confirmed on official pages"
      description="Open deadlines first. Every value as stated on the official page."
      rows={rows}
      rowKey={(r) => r.id}
      columns={columns}
      source={footer}
      searchable
      searchLabel="Search settlements"
      trigger={
        <Button variant="outline" size="sm">
          See all {fmtInt(rows.length)}
        </Button>
      }
    />
  );
}
